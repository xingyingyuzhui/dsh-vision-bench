# Vision Agent × 插件：第四轮 Review 修复计划

## 基线与范围

- 代码基线：`043d81c`。本轮审查范围为 `b23c08d..043d81c` 的四个提交。
- 最近实测：lint、typecheck、pack:check、build:check 通过；单测 1462/1465。既有失败为 multi-conn-poll 两项和 frames-virtualizer 一项。完整日志：`/tmp/vision-review4-unit.log`。
- 本文是实施计划；当前只新增本文，不修改生产代码、不创建提交。
- 本轮解决 5 个已复现问题。保留前轮修复、现有 Host 接口、运行期 epoch、三次投递上限和 1s/3s 重试间隔。
- 不做 runtime 存储键迁移，不做报文快照游标，不修改 DSH 官方代码，不将既有三项测试失败混入修复提交。没有真实 Web/Desktop 安装验收证据时，只声明代码与测试通过。

文中的相对路径均以插件根目录 `/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench` 为基准。新增函数名为建议接口，需要与项目类型及模块边界对齐。

## A. 采集前拦截点位运行态键冲突（P1）

### 问题与必须保证的行为

私有会话 A 配置 c1/p，B 配置 c2/p；两个连接均产生报文，结果却只有一条 p。连接归属唯一不代表点位运行态唯一：`changedById`、values、trend、alarmState 仍依赖 pointId，提交还会对配置按 ID 合并。

必须在任何 transport 调用、帧写入、runtime 提交或通知之前拒绝会污染同一个运行态槽位的采集。不能把错误推迟到 commit，也不能简单改 `changedById` 为复合键：只改这一处无法同步解决其余存储及查询契约。

### 修改位置和算法

1. `src/application/modbus/poll-session-ownership.mjs`：保留 `resolvePollTargets()` 的连接归属规则，扩展冲突结果的类型。连接冲突结果向后兼容；点位冲突增加 `entityType`、`entityId`、`owners`、`connectionIds`，外层继续用 `AMBIGUOUS_OWNER` / `ambiguous-owner`。不要把 pointId 塞进 connectionId 字段。
2. 新增 `src/application/modbus/poll-runtime-identity.mjs`，放置纯校验函数 `validatePollRuntimeIdentities(workspace, preparedTargets)`。从原始共享层和 sessionConfigs 建立点位身份索引，禁止先调用 `unionScopedPoints()` 后再检查。身份至少包含来源层、sessionId、connectionId、deviceId、pointId。
3. 同一个共享点从多个有效会话视图出现，按“同一共享定义”归并一次；两个私有定义即使地址/端点相同，也不能被认定为同一共享对象。先按现有 share/有效视图规则排除被覆盖的旧定义，再做身份判断。
4. 对本轮将实际读取的 pointId 检查其运行态槽位。除批次内重复外，还检查其他有效配置是否将不同身份写入同一槽位：当前提交会按全局点表合并，显式 sessionId 或只采集 c2 不能自动修复这一点。相同 pointId 存在不同有效身份时，保守拒绝受影响的采集；完全无关的其他 pointId 冲突不阻断本次调用。
5. 设备 ID 同名先检查实际查找/提交链：跨会话相同 deviceId、但运行态和查找均能通过 connection/session 区分的，不应仅因同名而拒绝。若现有 `modbus-commit.mjs` 中 devices union 或其他按 deviceId 的查找会选择不同设备定义，则对本次受影响设备同样返回结构化冲突。用集成测试确定是否安全，不能靠名称推断。
6. `src/application/modbus/polling-service.mjs`：在完成 B 的目标准备后、创建 transport/取得采集锁前调用校验；失败返回 `ok:false, skipped:true` 和 conflicts，不返回可执行的部分目标。

建议函数契约：

```js
validatePollRuntimeIdentities(workspace, preparedTargets)
// => { ok: true }
// 或 { ok: false, errorCode: 'AMBIGUOUS_OWNER',
//      reason: 'ambiguous-owner', conflicts: [{
//        entityType: 'point', entityId: 'p',
//        owners: ['a', 'b'], connectionIds: ['c1', 'c2'],
//      }] }
```

### 回归测试

新增 `test/devices/poll-runtime-identity.test.mjs`，使用模拟 transport 和独立 workspace：

- c1/p + c2/p：整批失败；交换 sessionConfigs 插入顺序仍失败；transport 调用数为 0。
- 一个安全点加一个冲突点：仍整轮 0 I/O；values、trend、alarmState、frames、pollingByConnection 前后相同，通知调用为 0。
- 显式 session 或单连接只选中冲突点的一方：不能通过全局 commit 串到另一方；本轮采用明确拒绝策略。
- 单独读取无关、安全的点不被其他未涉及的重复 ID 阻断。
- c1/p1 + c2/p2 成功，fixture 使用不同地址/返回值，断言两条值、各自 connectionId/deviceId、趋势及告警归属，不能只断言 ok。
- 同一共享点重复可见仍能采集；同名 deviceId 配不同连接覆盖实际查找与 commit 路径。

验收：不出现“成功采集两条、只留下一个逻辑点”的结果；拒绝发生在 I/O 前。

## B. 批次有效性不再依赖第一个会话（P1）

### 问题

`polling-service.mjs:160–163` 先取 `packForTarget(targets[0])`，再用它的 `points.length` 判断整个批次。A 有连接无点位、B 有有效点位时，B 被提前返回阻断。

### 修改方式

在 `polling-service.mjs` 提前准备全部目标；必要时提取 `poll-target-preparation.mjs`，避免继续扩大服务文件：

```js
// 每个目标使用自己的有效视图；数组中的对象不得写回配置。
const preparedTargets = resolved.targets.map(target => {
  const pack = packForTarget(target)
  const connection = pack.connections.find(c => c.id === target.connectionId)
  const points = pack.points.filter(p => (p.connectionId || p.connId) === target.connectionId)
  return { ...target, pack, connection, points }
})
```

- 按既有连接 enabled、设备启用及采集点规则建立执行集合；复用现有过滤和 `planScopedReadBatches` 逻辑，不能另写一套监视点语义。
- 删除首个 pack 的无点位提前返回。无可用连接、全部无点位、当前没有符合采集条件的点分别沿用既有契约；只有整批确实没有点位时才返回“无点位”。
- 空连接与有效连接混合时，有效连接继续执行；空连接沿用现有轮询时间戳更新行为，不发起读取。
- 每个 transport 请求的 connection/device/points 均取该目标的 pack。values、pollingByConnection 等工作区级运行态从工作区级规范化视图初始化，不通过首个会话代替整个批次。
- 保留工作区锁、取消信号、预算、一次 commit 边界；不要递归调用 modbusPoll。
- 单连接和批量入口复用同一准备路径；不借本轮改变 enabled 或手动采集的业务语义。

### 回归测试

新增 `test/devices/poll-empty-targets.test.mjs`：A 空/B 有点、A 有点/B 空、空连接 disabled、全空、显式指定空连接、显式指定有效连接。交换插入顺序后有效连接的读取结果一致。对混合批次断言 transport 只读有效点，结果与单独读取该目标一致，元数据没有丢掉其他连接。

实施顺序：先完成 B，再接入 A 的预检；B 不负责放宽前轮连接归属检查。

## C. 首次投递逐个重验订阅（P2）

### 问题与边界

`matchingAlarmRecipients()` 的返回值是快照。A 的通知在等待期间 B 退订，循环随后仍向 B 发起首次发送。epoch 只能判定运行期是否有效，不能代替订阅授权。

已发出的外部通知无法靠本地退订撤回。本轮保证的是：退订后不再发起尚未发送的通知，不生成旧订阅重试；已在途成功通知可按实际结果记账，不能谎报为已撤回。

### 修改位置

`src/application/modbus/poll-alarm-notify.mjs::emitCommittedAlarmTransitions()` 的 recipient 循环，在 `beginDeliveryAttempt()` 之前按顺序检查：

```js
if (!isAlarmRuntimeCurrent(runtimeToken)) return counters
if (!recipientStillAuthorized(home, cwd, item, recipient)) continue
const live = recheckAlarmCurrent(home, cwd, item, recipient.sessionId)
if (!live.current) continue
const attempt = beginDeliveryAttempt(meta.eventId, recipient.sessionId)
if (!attempt.proceed) continue
// 这些检查与 deliverNotify 发起之间不能新增 await。
```

- 不为失效授权创建 pending ledger、占用次数或排队。
- 复用 subscriptionId，覆盖退订后重订相同目标、切换 pointIds/connectionId、TTL 到期；语义等价续期保留原行为。
- 保留 await 后 epoch 检查和失败后授权复查。不能因为补了发送前检查就删掉发送后保护。
- C 与 D 共用授权函数；后续扩展授权不应出现首次/重试两套规则。

### 回归测试

新增 `test/agent/alarm-notify-initial-authorization.test.mjs`，使用 deferred promise 控制 A 的发送：

1. A/B 订阅共享点；A pending 时 B 退订，释放 A 后调用列表只有 A；B 无 pending ledger/重试。
2. B 改订其他点、TTL 到期、退订后重订原点：旧 recipient 均不发送。
3. B 只做同目标有效续期：仍正常发送一次。
4. A 已在途后自身退订：成功可正常记账，失败不入重试；不声称能撤回外部已接收通知。
5. await 期间 dispose/restart：原生命周期测试继续通过，旧结果不能写入新运行期。

禁止用实际 sleep 等待超时；采用现有 clock/timer hooks。

## D. focus 授权绑定原会话及请求身份（P2）

### 问题

`alarm-notify-match.mjs::recipientStillAuthorized()` 的 agent-focus 分支只看当前 request 是否仍匹配点位。focus 从 A 转到 B、点位相同时，旧 A 授权仍返回 true。

### 修改方式

- 在 `alarm-notify-match.mjs` 提取同一套 `focusRecipientSession(workspace)`、`focusMatchesAlarm(request, item)`、`focusAuthorizationId(focus, resolvedSessionId)`，供匹配和重验共用。
- session 解析沿用当前规则：显式 `focus.sessionId` 优先，缺省才回退 `workspace.session.boundId`，统一规范化。显式 focus 会话不能被 boundId 覆盖。
- recipient 创建时保存 authId；重验同时要求 `req.by === 'agent'`、当前 session 等于 recipient.sessionId、目标匹配、authId 等于原始 authId。不能仅验证 `focus:p1`。
- 身份建议用稳定字段数组的 JSON 序列化，包含 session、request.at、request.version、kind 和完整目标字段（connection/device/point/alarm/frame/trend 等）。避免用可能含分隔符的字符串拼接。重验函数不得生成 Date.now()、随机 ID 或写 workspace。
- `focus-store.mjs` 已保留 at/version；先复用这些已持久化字段。此方案定义为“同一会话、同一规范化请求”的授权，不承诺区分完全相同字段的重复请求。若产品后续要求每次重复请求都撤销旧授权，再单独引入持久化 generation，不在本轮顺带迁移。
- 原 focus 失效后，即使同会话存在 watch 或其他任务也不能给旧重试换授权；仍检查原 reason。维持原重试终止、清队列和次数上限机制。

### 回归测试

在独立 `test/agent/alarm-notify-focus-authorization.test.mjs` 覆盖：

- A 首次投递失败入队；focus 转 B 同一点；推进虚拟时间，A 不再投递，原任务终止。
- A→B→A 期间产生新 at/version，请求不同，旧 authId 不复活。
- 同一 session 但 connection/device 改变、pointId 相同：拒绝旧授权。
- request 未变：允许重试；用户 focus、清空 focus：拒绝。
- 显式 focus.sessionId 不受 boundId 改变影响；没有显式 session 时 boundId 切换会使旧授权失效。
- 不仅直接测布尔函数，还通过 emit → enqueue → runDueAlarmNotifyRetries 验证真实投递次数、ledger 和队列结局。

## E. 趋势非空页的最小保留数与完整预算（P2）

### 问题

`agent-result-project-rest.mjs::projectTrend()` 允许 keep=0 通过预算。已复现原始一个样本，但返回 ok:true、returned:0、hasMore:true、oldestReturnedAt:null，没有 overrun。循环还在测完字节后追加 truncated，预算判定没有覆盖最终对象。

### 修改方式

保留 `buildSeriesPage()` / `assembleTrendResult()`，调整候选页生成和缩页循环：

```js
const maxKeep = Math.max(0, ...full.map(s => s.samples.length))
const minKeep = maxKeep > 0 ? 1 : 0
for (let keep = maxKeep; keep >= minKeep; keep--) {
  const rows = full.map(s => buildSeriesPage(s, keep))
  const page = assembleTrendResult(rows, effectiveLimit, trend, result)
  const candidate = rows.some(s => s.hasMore)
    ? { ...page, truncated: true }
    : page
  if (utf8ByteLength(candidate) <= cap) return candidate
}
// 非空序列至少留一个最新样本；现有 overrun + hint 分支。
```

- 源数据全空时允许 keep=0；非空输入不能为了预算变成普通空成功页。
- 元数据 + 每条非空序列一个最新样本仍放不下时，返回显式 overrun/truncated/hint；保留该最小证据。本轮沿用现有 overrun 允许超过普通 cap 的契约，不把它宣称为严格预算内响应。
- 所有计数、hasMore、oldestReturnedAt 从最终 samples 计算。保留最新连续后缀；各序列独立使用自己的时间边界翻页。
- effectiveLimit 优先有效 args.limit，其次有效 trend.limit；两者均无有效值时省略。不要因 args 未传而抹掉 Host 已确定的 limit。
- 提示应建议缩小 pointIds/元数据；已经只有一个样本时，“降低 limit”不保证有效，不应作为唯一修复建议。

### 回归测试

扩充 `test/agent/agent-trend-projection-bounds.test.mjs`：

- 构造“空元数据页刚好放得下、一个样本放不下”的边界，断言 overrun:true 且仍有样本；不能只测元数据本身已超预算。
- 构造追加 truncated 前后跨越 cap 的候选，断言最终正常页 utf8ByteLength <= cap；使用中文/emoji 覆盖字节与字符数差异。
- 真正空序列正常返回 0；混合空/非空保留每条非空序列的最新样本；元数据本身超预算进入 overrun。
- args 未给 limit、Host trend.limit 已给时保持元数据；显式有效 limit 优先。
- 原 8×600、连续分页、不同长度及真实 handler + projection 用例全部继续通过。

## 提交顺序、验证及交付

建议顺序 B → A → D → C → E，每组生产改动与对应回归测试放在同一提交；已有四个提交不重拆、不改写。提交本身在后续实施任务范围内进行，本文不执行提交。

建议提交标题：

1. `fix(poll): prepare all targets before checking point availability`
2. `fix(poll): reject conflicting runtime point identities before I/O`
3. `fix(alarms): bind focus retries to session and request identity`
4. `fix(alarms): recheck authorization before initial delivery`
5. `fix(trend): prevent empty successful pages under byte pressure`

新增模块若被生产入口引用，按现有机制更新 package files/typecheck 清单；不扩大 structure-budget 白名单。新增测试按行为独立拆分，不能把现有 300 多行通知套件堆成大文件。

每组先让对应复现测试在修复前失败，再完成修复及必要的相关回归。集成完成后运行：

```sh
npm run lint --silent
npm run typecheck --silent
npm run pack:check --silent
npm run build:check --silent
npm run test:unit --silent
git diff --check
```

验收证据必须包含：

- 五组修复各自的文件、提交及行为变化；确实执行过的测试结果。
- A 的 0 I/O/0 runtime 变更证据，B 的顺序无关结果。
- C/D 的实际通知调用列表、最终 ledger/队列状态，不能只给 helper 返回值。
- E 的最终序列长度、计数、边界时间、UTF-8 字节数和 overrun 状态。
- 全量测试的新总数及失败详情。允许保留已知 3 项基线失败，但若错误类型或堆栈变化，必须重新对照基线，不能仅凭同名测试判定无关。

完成条件：五个复现均被行为测试覆盖且通过；没有新增测试失败；全部静态/打包门禁通过；未引入运行态键迁移或跨会话隐式授权。
