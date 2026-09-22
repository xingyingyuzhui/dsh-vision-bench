# Vision Agent × 插件：第三轮 Review 完整修复计划

基线：`b23c08d`，工作树干净。上一轮已完成告警事件 ID、按会话投递、报文缩页、trendKey 与私有点元数据、无目标退订。本计划处理第三轮复现的 4 个缺陷及其调用链；不是重做前两轮实现。

验收基线：lint/typecheck/pack/build 检查通过，单元测试 1440/1443。既有失败为 multi-conn-poll 两项及 frames-virtualizer 一项；本轮不得增加失败。报文快照游标仍按此前决定留待后续，不扩大这轮范围。

## 1. 批量采集在任何 I/O 前验证所有目标归属（P1）

### 已复现

两个私有会话均有 `c1`，分别连接 COM3、COM4。`modbusPoll(...,{connectionId:'c1'})` 返回 `AMBIGUOUS_OWNER`；`modbusPoll(...,{})` 却成功读取 COM3。原因是 `resolvePollSessionOwnership()` 无 cid 分支直接放行，随后 `unionScopedConnections()` 按 ID 去重、保留第一个对象。

### 本轮确定的语义

- 显式 sessionId：只在该会话有效视图内选择连接，逐项验证权限。
- 没有显式 sessionId：从原始共享层和各私有层构造候选归属表；不能先 union 再验证，原始冲突会被 union 隐藏。
- 显式共享层中的连接按现有 share 规则处理；同 ID 的多个私有定义不能仅凭端点相同就自动当作共享。
- 批量请求中任一将被采集的连接有歧义，**整轮返回失败，0 次 I/O、0 次运行态提交、0 次通知**。用户可用显式 sessionId 或单独的无歧义连接重试。先完整预检再采集，不允许读完前几个连接才报错。
- workspace.boundId 只能参与原有默认视图选择，不能作为消除重复私有 ID 的显式授权；必须先检查候选歧义。

### 代码改动

**`src/application/modbus/poll-session-ownership.mjs`**

保留单连接解析器，新增纯函数 `resolvePollTargets(workspace, target)`：

```js
// 成功：每个目标都有确定的配置视图与来源
{ ok: true, targets: [
  { connectionId, sourceSessionId, shared }
] }
// 失败：不返回可执行的部分 targets
{ ok: false, errorCode: 'AMBIGUOUS_OWNER',
  reason: 'ambiguous-owner',
  conflicts: [{ connectionId: 'c1', owners: ['a', 'b'] }] }
```

先枚举原始候选行并建立 `Map<connectionId, owners[]>`，再按明确的 session/share 规则筛选；无 cid 分支不得无条件返回 `shared:true`。保持未分区旧工作区的原有访问行为；显式 session 的旧工作区迁移应走现有 claim/有效视图规则，不能误报无权限。

**`src/application/modbus/polling-service.mjs::modbusPoll()`**

在获取串口/transport、创建帧、写 runtime 之前调用完整目标解析。失败立即返回 `skipped:true` 和 conflicts。成功后按目标的会话 pack 取 connection/device/points，不能继续从跨会话 union pack 中 `find` 第一个同 ID 设备或点。保留既有锁、预算、取消信号及一次 poll 的提交边界；不要递归调用 `modbusPoll()`，避免工作区锁导致全部子调用被跳过。

批量成功时保存 `sourceSessionByConnection`，给每条 committed alarm 关联其实际来源。不能给整个批次统一套上最后一个目标的 sessionId。若共享 runtime 当前无法区分候选中同 ID 的不同点/设备，本轮同样在预检阶段报歧义，不进行 runtime 键迁移。

**`src/application/modbus/poll-alarm-notify.mjs`**

接收逐事件来源或来源映射，`matchingAlarmRecipients` 使用事件对应来源；共享事件仍对所有有权订阅者投递。事件记账只做一次，不能为每个会话重复记录同一告警。

### 回归用例

新增 `test/devices/poll-ownership.test.mjs`：

1. 同 ID、不同端点的两个私有连接：指定 cid 和不指定 cid 都拒绝；交换 sessionConfigs 插入顺序结果不变。
2. 一个正常连接加一个歧义连接：整轮 transport 调用数为 0，磁盘 values/frames/polling 状态不变。
3. 显式 session A/B 分别解析到自己的端点；错误 session 返回目标错误。
4. 两个不同 ID、各有唯一私有归属的连接可批量读取，告警各投其来源会话。
5. 显式共享连接、多会话共享订阅、无 sessionConfigs 的旧工作区、没有绑定会话、存在 boundId 均覆盖。

## 2. 趋势压缩保留最新连续窗口，所有元数据最后计算（P1）

### 已复现

8 条曲线各 600 样本，超预算后实际返回 40 样本，`trend.returned` 仍为 4800。`slice(0,5)` 保留每条曲线最旧的 5 个样本，给出的 `end=oldestReturnedAt-1` 又跳到更旧位置，丢失的新样本无法沿该翻页路径取回。

### 代码改动

**`src/application/commands/agent-result-project-rest.mjs::projectTrend()`**

移除 shrink 回调中的 `slice(0,5)`，将选样与组装响应拆成两个局部纯函数：

```js
function buildSeriesPage(series, keep) {
  const samples = keep > 0 ? series.samples.slice(-keep) : []
  return {
    ...series,
    samples,
    returned: samples.length,
    hasMore: series.count > samples.length,
    oldestReturnedAt: samples.length ? samples[0][0] : null,
  }
}
// 最终页确定后计算，禁止沿用压缩前 returned
trend.returned = sum(series.map(s => s.samples.length))
trend.total = sum(series.map(s => s.count))
trend.limit = effectiveRequestedLimit
```

`slice(-0)` 会返回全部数组，必须显式处理 keep=0。`count/total` 保留时间窗内总量，`returned` 表示本次实际给 Agent 的样本数；`hasMore` 按最终 samples 重算，不固定写 true。

先生成完整候选页；超过预算时逐步减少每条序列的保留数，始终保留连续后缀。最大 8 条序列、每条最多 600 个历史样本，可用逐步缩小或二分确定预算内页长。预算应计算包含元数据的完整响应。所有序列至少保留一个样本仍放不下时，返回显式 overrun 和缩小 pointIds 的提示，不能把空样本包装为正常完成页。

**`src/application/modbus/trend-store.mjs` / 工具说明**

维持按时间升序返回样本；下一页单点使用 `end=oldestReturnedAt-1`，沿用原 start。明确该规则依赖毫秒时间戳和当前样本窗口。多序列分别翻页，不用某一条序列的边界过滤全部序列。`hasMore:false` 时不生成下一步提示。

### 回归用例

在 `test/agent/agent-result-projection-bounds.test.mjs` 覆盖 8×600、单点、空序列、不等长序列、未超预算及元数据本身超预算。必须断言：

- `trend.returned === sum(series.samples.length)`。
- 每条 returned 等于数组长度，最后一个样本是原请求窗口最新样本。
- `oldestReturnedAt` 等于实际返回首样本时间。
- 按返回边界取第二页，静态 fixture 拼接后连续、无遗漏无重复。
- 通过真实 handler + projection 路径测试，不仅给投影函数喂手工对象。

## 3. 重试绑定订阅身份，发送前重新核验目标（P2）

### 已复现

订阅 c1/p1，告警第一次通知失败进入队列；随后将订阅切成 c2/p2，旧 p1 通知仍重试成功。`guardsPass()` 只检查存在某个 watch，没有核对其 connectionId/pointIds。

### 代码改动

**`src/application/modbus/alarm-notify-registry.mjs`**

watch 增加 `subscriptionId`。新订阅、退订后重新订阅、目标集合改变时生成新 ID；同一有效订阅仅续期且目标完全一致时可保留 ID。比较 pointIds 时先去重排序，不能因数组顺序改变误判新订阅。

退订必须要求非空 sessionId；禁止把缺失 sessionId 转成 undefined 后交给“清除全部会话”的底层 API。

**`src/application/modbus/alarm-notify-match.mjs`**

匹配结果带上用于授权的身份：显式订阅为 subscriptionId；focus/待处理命令为对应请求或 commandId。抽取 `recipientStillAuthorized(workspace,item,recipient)`，统一复用目标匹配、会话可见性及来源限制，避免初次投递与重试采用两套判断。

**`src/application/modbus/alarm-notify-retry.mjs`**

任务保存 recipient 授权快照、sourceSessionId 和原事件目标。发送前必须满足：

1. session 仍有效，来源/私有归属仍允许该 recipient。
2. watch 的 subscriptionId 与任务一致，且当前 connectionId/pointIds 仍覆盖原事件。
3. 告警仍有效；恢复、删除、禁用或授权失效时取消。

从 focus/待处理命令产生的初次通知，其重试应验证原 focus/命令仍有效，不应强制要求额外 watch。不能在旧 watch 失效后自动改用同会话另一个授权理由继续发送旧任务。

**`src/application/commands/handlers/live-command-handler.mjs`**

目标发生变化时取消本会话旧订阅关联的任务；保留其他会话。退订先撤销身份再取消任务。重试 guard 是最终保护，不能仅靠调用取消 API，因为旧通知可能仍在 await 中。

### 回归用例

新增 `test/agent/alarm-notify-retry-authorization.test.mjs`：用真实 workspace/recheck，先令 notify 返回 false，再改订阅再推进假时钟。覆盖跨连接、同连接换点、目标集合缩小、纯续期、取消后同目标重订阅、另一会话不受影响。旧任务通知次数不增加；纯续期可继续重试。另测合法 focus/命令失败后的重试。

## 4. 初次投递和重试共用生命周期，dispose 后不能复活（P2）

### 已复现

重试正在 `await deliverNotify()` 时执行 dispose；返回 false 后代码继续 `markQueued()` + `scheduleNext()`，队列与 ledger 又各出现一项。只清理当前 Map 和 timer 无法阻止已挂起的 Promise 后续执行。

### 代码改动

**运行态身份**

由 registry 或一个小型 runtime 模块持有单调递增 epoch 和 active 标记。Host 当前有效 lease 启动时调用 `startAlarmNotifyRuntime()`；dispose 先使当前 epoch 失效，再取消任务、清计时器、清 ledger/watch。沿用 host.js 已有 stale-dispose 保护，旧 lease 不得终止新 runtime。

```js
const token = captureAlarmRuntimeToken()
if (!isAlarmRuntimeCurrent(token)) return
const result = await deliverNotify(...)
if (!isAlarmRuntimeCurrent(token) || task.cancelled) return
// 此处之后才允许 markDelivered / markQueued / scheduleNext
```

上面的检查同时加入 `poll-alarm-notify.mjs` 的**初次投递**和 `alarm-notify-retry.mjs` 的重试。仅在重试函数加检查不够：初次通知也可能在 dispose 后返回失败并创建新队列。初次 emit 捕获 token 后，每个异步记账/投递边界返回都需检查，防止继续处理后续 recipients。

**任务生命周期**

任务增加 `runtimeEpoch/cancelled/state`。queued 和 in-flight 任务都必须可定位：计时器开始执行时不要让任务从所有索引消失。取消先标记 cancelled 再清 timer；pending 完成后的分支必须观察该标志，不得覆盖为 delivered/queued。新订阅的新任务不能被旧 Promise 的完成回调删除，删除前校验 Map 中仍是同一任务对象。

建议状态：`queued → pending → delivered | queued | exhausted`，以及任意未结束状态 `→ cancelled`。业务取消与耗尽次数分开记；dispose 失效后的回调直接退出，不重新创建任何 ledger 条目。已经被 Harness 接收的 followup 无法撤回，取消保证是停止尚未发出的任务及后续重试。

**一致的调度入口**

每个任务自行携带 guards；定时器和 `runDueAlarmNotifyRetries()` 使用同一执行入口，不让测试入口传一个 guards 对象覆盖所有任务。手动推进任务前取消对应 timer，避免后续重复触发。生产与测试共用注入时钟。

尝试次数以 ledger 为单一事实来源：本轮明确最多 **3 次总投递（首次 + 2 次重试）**，延迟为 1s、3s。当前 `[1s,3s,10s]` 与总次数和索引不一致，一并修正注释/数组/测试；无需额外加入第 4 次投递。

### 回归用例

新增 `test/agent/alarm-notify-lifecycle.test.mjs`，用 deferred Promise 控制 await 返回位置：

- 初次投递、重试投递分别在 pending 时 dispose，再返回 false/true/抛错：queue、timer、ledger 均不复活。
- dispose 后重新 start 并创建新任务，旧 Promise 完成不影响新任务。
- pending 时退订/换目标，不再重排任务；取消某会话不影响其他会话。
- 同一任务的定时器和手动推进并发触发，只执行一次。
- 总投递次数恰为 3，首次重试 1s、第二次 3s；成功后无剩余 timer。

## 提交与最终验收

| 提交 | 范围 | 核心通过条件 |
| --- | --- | --- |
| 1 | 批量采集预检、每连接来源 | 歧义批次零 I/O，唯一归属批量正常 |
| 2 | 趋势样本预算与翻页 | 保留最新连续窗口，计数与内容一致 |
| 3 | 订阅身份、授权重检、取消 | 换目标后旧通知不再发送 |
| 4 | runtime epoch、pending 取消、统一调度 | dispose 后所有异步返回都不复活 |

提交 3/4 应连同各自测试完成再整体验收。新增运行时模块同步加入 package.json files；按现有结构预算拆分测试，不提高阈值来容纳大文件。保留此前提交历史，不需要再制造一个基线 commit。

每组先跑相关定向测试；最终跑 `git diff --check`、lint、typecheck、pack:check、build:check、test:unit。检查范围内新增用例全部通过，全量失败不得超过已确认的 3 个基线项；若失败清单变化，逐项归因。Web/Desktop 使用隔离仿真工作区验证共享/私有多会话、切换订阅、退订、持续采集趋势及插件重载。没有真实硬件验收时不宣称真实串口场景已验证。

最终交付说明列出：4 个提交、修复前后复现结果、测试统计、已知的实时 offset 分页/内存重试队列限制，以及单列的 3 项历史测试失败。
