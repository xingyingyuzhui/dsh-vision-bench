# Vision Agent 查询成本与可观测性优化计划（代码级）

## 1. 基线、判断与范围

实施基线：`2d5b89b`，插件版本 `0.29.28`。反馈来源为 `/Users/qin/DSH/vision-plugin-review-findings.md` 的仿真 Harness 测试；该文件只有运行结果，不能证明测试进程加载了哪个 Git 提交。实施前重查 HEAD、工作树和已装产物身份。

已确认的代码问题：`status.log` 把非 build 事件归为 build；告警 Agent 投影丢 ACK 元数据并误将通信告警 ID 当作 pointId；Agent `status` 仍输出未按会话过滤的轮询 map、日志和任务摘要；`points list` 缺可续查分页；`focus` 无只读入口，timeline 在 Agent status 精简后不可查。无目标参数的告警列表也直接读取全局 alarmState，应纳入同一会话可见性复核。

需要修正反馈中的两项结论：

- `trend limit:5` 在**当前代码**会返回每条序列最多 5 个样本。已用 600 样本经工具→Host 实测 `{limit:5,total:600,returned:5,samples.length:5,hasMore:true}`。报告中的 600 样本来自旧版本；当前只需补投影层防御和已装产物身份验证。
- `status` 可见 connections 少于 `pollingByConnection` 键，不能单凭此证明连接已删除：配置按会话投影，轮询状态在全局层。先判全部共享/私有层是否仍拥有连接；禁止按当前会话视图清除其他会话的运行态。

当前 `points get` 的 32 ID 上限、去重保序、全缺失和预算 `omittedIds` 已有测试；超 32 **拒绝**，不是截断。保留这些契约。`points get/list` 的值隔离和只读内存 claim 不可回退。此次不触碰真实串口、写设备或 Desktop 安装。

## 2. P0：先封住会话可见性与错误归类

### 2.1 `status` 与 `alarm` 的全局运行态按会话投影

现状：`projectModbusForSession` 把全局运行态复制进会话 pack；`src/application/commands/agent-result-project-status-read.mjs::projectStatus` 直接输出 `mb.pollingByConnection`。即使额外键仍被别的私有会话使用，当前 Agent 也不应看到其状态。

建议新增纯函数 `projectVisiblePolling(layeredModbus, sessionId, connections, pollingByConnection)`。在 Host 读取完整分层配置时预先判定每个运行态槽的归属，将可见且唯一的 connectionId 传给 Agent 投影；不能只在投影层依据可见 ID 推断归属。过滤步骤形如：

```js
const visibleIds = new Set(connections.map(c => c.id).filter(cid => uniqueOwnerInLayeredModbus(cid)))
const polling = Object.fromEntries(
  Object.entries(mb.pollingByConnection || {}).filter(([cid]) => visibleIds.has(cid)),
)
```

具体落点：`handlers/project-command-handler.mjs` 已同时持有完整 `workspace.modbus` 和会话 pack，可在此准备 `visiblePollingByConnection` / `visibleAlarmState` / `visibleTasks`，再交给 Agent 投影；`agent-result-project-status-read.mjs` 只负责有界输出。不要让结果投影反向读取磁盘或猜会话归属。

`counts.connections` 仍表示可见的**配置连接数**，不随运行态过滤改变；`counts.alarmsActive` 则改为过滤后的告警数。若两个私有层使用相同 connectionId，全局轮询槽的 owner 不明，当前会话也不展示其状态。不能在这里更改磁盘状态；Host/UI 是否仍需全局态按各自权限保留。后续清理必须审查所有层的归属，不能只看当前 pack。

同一路径还有 `status.log`、`tasks`、`running`：当前 `projectStatus` 取全局短日志与任务集合，其中任务行已有 sessionId，而短日志只有 action/summary，无法可靠归属。先过滤 tasks/running 到当前会话；未归属的历史 log 在 Agent status 中隐藏或标为不可归属的纯计数，不暴露 summary。新日志由 §2.2 增加结构化 session/target 归属后再按权限展示。不能从中文 summary 猜所属会话。

`live-command-handler.mjs` 的 `alarm` 无目标查询直接返回 `pack.alarmState`，该对象也处于全局运行层。对 Agent 先按当前会话**可见且身份唯一**的点/连接过滤过程和通信告警，再让 `projectAlarm` 分页；显式 `alarmId` 同样检查可见性，不能用 ID 单查绕过过滤。共享告警按共享可见，私有同 pointId 的归属若不确定则隐藏值/详情并返回可诊断的 unavailable，不猜 owner。过滤必须先于 `total/nextCursor` 计算。Host/UI 当前需要全局态的路径按原有授权保留，不靠 Agent 输出裁剪替代 Host 校验。

同一风险还在 `trend-store.mjs::readTrendSeriesFromPack`：它把会话点位名称套在按裸 pointId 存储的共享 `trend` 样本上。对 Agent 的每个 trend pointId，先用现有 `resolveEffectivePointIdentity(workspace.modbus,pid)` 判断唯一归属并核对当前可见定义；多私有同 ID 或错配时返回空样本及 `dataStatus:'unavailable'`，不带 count、样本时间或其它会话信息，不因显式 sessionId 而放行。安全序列仍正常返回，混合查询不整批失败。此项排在 §5 的 limit 兜底之前，避免把缩小后的跨会话样本误当安全数据。

测试：A、B 各有私有连接、任务、轮询、告警和同 pointId 的趋势记录，A 的 Agent status/alarm/trend 只能看到 A；共享对象可见；同名私有 pointId 不能因裸 ID 匹配泄露，趋势为 unavailable；显式 B 的 alarmId 对 A 不可见；磁盘内容调用前后完全一致；无会话访问分区工作区仍按现有 `SESSION_REQUIRED` 处理。增加过大状态预算裁剪后的字段检查。

### 2.2 修正短日志类型，并处理不可恢复的旧条目

现状：`src/domain/prompt/prompt-log.mjs::normalizeEvent` 只允许 `select-project/build/read`，其它 action 默认 `build`；`recordBenchEvent` 已提供真实的 `alarm`、`alarm-clear`、`focus` 等 action。`mergeLog` 每次再规范化旧行，所以只改写入端仍不足以停止历史行继续被误标。

- 扩充受控 action 集合为实际生产者使用的动作（先 `rg recordBenchEvent` 列举）；未知动作归为 `event`，不得默认 `build`。可在新短日志增加 `schemaVersion:2` 和 `kind`，`action` 保留供现有 UI 消费。
- `recordBenchEvent` 同时给 timeline 和短日志传同一规范化 kind；`compactLog` 和 status 投影保留可用类型。通信告警当前也发 `alarm/alarm-clear`，若要独立 `comm` 类型，先改变生产者的结构化事件；不要从中文 summary 反推。
- 旧短日志里的 `action:'build'` 已失去原始类型，不能自动改成 alarm。对无 v2 标记的旧行标注 `legacyTypeUnverified`，统计时排除或单列；真正的历史 build 也只能作为待核验类型。不能靠字符串搜索批量改磁盘。

测试：真实 `recordBenchEvent` 连写 alarm→alarm-clear→focus→build，读回短日志与 timeline 一致；再执行一次合并，类型不倒退；旧 `build` 行无证据时不被计入可信 build 统计。

## 3. P1：恢复可追溯告警与只读观察入口

### 3.1 告警列表保留必要 ACK 字段，单条详情返回完整审计字段

领域层 `src/domain/modbus/alarm-lifecycle.mjs` 仍保存 `acknowledged/ackedAt/ackedBy/count/durationMs/suppressUntil/pendingSince`；缺失发生在 `src/application/commands/agent-result-project-rest.mjs::projectAlarmRow`。

建议列表每条增加 `acknowledged`、`ackedAt`、`ackedBy`、`count`，并保持 `status/condition/occurredAt/clearedAt`；`alarmId` 单查（同一个入口，已支持）增加 `durationMs/suggestedAt/suggestedBy/taskId/suppressUntil/pendingSince`。`ackedBy` 是现有 actor 文本，不能宣称它一定能标识具体自然人。字段缺失时统一 `0/''/false` 或原有 nullable 约定，避免 Agent 把 `undefined` 当“未确认”。

`projectAlarm` 的分页、预算裁剪与 `returned === Object.keys(alarms).length` 必须同步；单条过大时给可诊断 overrun，不要把已确认时间裁掉又返回 `ok:true`。类型、工具说明、README 的字段契约一起更新。

### 3.2 通信告警不再伪造 `pointId`

`projectAlarmRow` 的 `pointId: alarm.pointId || id` 改为按领域语义取值：通信组/`comm:` ID 返回空字符串，过程告警返回真实 pointId。显式未知类型不盲目把告警 ID 充当点位 ID。`id` 始终仍为 alarmId。对 `alarmId` 单查和列表分别测通信、过程、旧数据；按 pointId 关联点表时通信告警不得命中。

### 3.3 增加只读 `focus.get` 与分页 `timeline.list`

现有 `focus` 动作进入 `requestFocus`，无参数时走目标校验，不是 getter。建议保留 `focus` 修改语义，新增明确只读动作（例如 `focus.get`、`timeline.list`）并登记在命令路由、Agent schema/预检、投影、类型和工具说明。执行时用 `loadWorkspace` + 内存会话投影，不调用 `ensureWorkspaceClaimed`，不写盘、不改变 UI 焦点或订阅。

`focus.get` 仅返回当前会话拥有的当前请求摘要：`active/sessionId/request{kind,connectionId,deviceId,pointId,frameId,trendKey,alarmId,visualizationId,at,by}/badgeOnly`。若焦点属于其他会话，返回 `active:false,request:null`。`prev/tempWatchIds/evidence` 如有需求单独定义权限，不能顺手倾倒。

`timeline.list` 基于已有 `workspace.timeline`，默认 20、最多 50 条；输出 `id/at/kind/source/sessionId/taskId/ok/summary`。**先过滤授权事件，再排序分页，再预算裁剪**。当前事件含 sessionId；旧 `sessionId:''` 的非可证明共享事件默认不向 Agent 展示，也不从 summary 推断归属。系统告警生产者目前常以空 sessionId 记录；要让 Agent 看见，先给新事件增加结构化 `connectionId/pointId` 和可证明的 owner，再按归属显示，不打开历史全局事件。

时间线保留上限是 120（重大事件可额外保留），因此游标用可定位的事件 `id` 加受限查询条件；下一页锚点被环形淘汰时返回 `CURSOR_EXPIRED`，提示从第一页重读，不默默跳页。`status` 只保留少量摘要；任务详情、timeline 不恢复为大包。

测试覆盖 A/B 会话互不可见、当前会话焦点与事件可见、legacy 未归属隐藏、空/过期游标、同时追加新事件时不重叠、完全无磁盘/UI 副作用；工具→Host→投影端到端验证。

## 4. P1：`points list` 可续查分页与低成本视图

现状：`src/application/modbus/point-service.mjs::pointsOp` 的 list 分支返回全部可见点；`agent-result-projection.mjs::projectList` 超 16 KiB 后仅截数组，缺少可续查游标。16 点约 11 KB 是一次实测，160 点不能线性外推为实际 Agent 单包 110 KB，因为投影会提前裁剪；实际风险是剩余点位不可可靠遍历。

在 `handleConfigCommand` 透传 `limit/cursor/view`，由只读 list 服务完成**配置分页**：

- 保留现有 `connectionId/deviceId` 过滤和 `valueStatus` 安全选择。先从同一会话快照取可见点，再按 `[connectionId,deviceId,id]` 做确定排序。比较器固定，不依赖系统 locale。
- `view:'full'|'summary'`。默认 full 保持旧调用的字段；summary 返回 `id/name/connectionId/deviceId/valueStatus`，用于发现标识符；summary 不返回 raw/value，且必须说明其状态不是读数。完整配置/读数按 get 单查或小批查询。
- Agent list 默认页 `limit:20`、最大 50；非 Agent 的既有调用默认保持旧行为，显式分页按新契约。返回 `total/returned/nextCursor/truncated/configVersion/view`，`returned === points.length`；`total` 是过滤后的可见配置点数，不计其它会话。
- 游标包含版本、最后一个排序键以及会话/过滤器/view 指纹；每次都重新按**真实 origin.sessionId** 过滤并校验游标，不能让 cursor 自带的 session 改变授权。配置版本改变返回 `CONFIG_DRIFT` + `refresh`；运行值更新不改变配置页边界。
- Agent 预算收缩时**只移除整条尾部点位，并把 nextCursor 设为最后实际返回的点**。如果连单条 full 行都超预算，明确失败并提示 summary/get；不返回空 `ok:true` 页或沿用未裁剪的 cursor。`valueStatus` 对每条返回点必有。

测试用 160+ 点、不同会话相同 pointId、过滤器变化、反向插入顺序、页面之间运行值更新/配置版本变化、预算强制裁剪，逐页拼接恰好等于可见集合（无重叠/跳过）；list 前后 claim/configVersion/values 不变。用真实 Agent 出口比较 summary/full 的字节数与最终 token（token 只在真实 Harness 可测）。

## 5. P2：`trend limit` 防御与成本验收

Host 已在 `src/application/commands/handlers/live-command-handler.mjs` 解析 limit，并由 `src/application/modbus/trend-store.mjs::readTrendSeries` 对每条序列 `slice(-limit)`；Agent 缺省 limit 为 60。当前 `projectTrend` 只把 limit 写入响应，预算以内会透传一个异常 Host 的超额数组。

投影层增加纯粹的上限守卫：`effectiveLimit` 非空时，对每条 `samples` 取最新连续后缀 `slice(-effectiveLimit)`，然后再执行现有预算收缩；`count` 保留窗口总数，`returned/samples.length/hasMore/oldestReturnedAt` 全部由最后留下的样本重算。多序列每条独立限量；不能取 `slice(0, k)`；`limit:0/负数/非数` 沿用 Host 校验/缺省语义，不能出现 `slice(-0)` 返回全量。单条样本超过预算时沿用现有至少 1 个最新样本的 overrun 契约。

测试：实际 Host 600 样本请求 limit5→5；造一个 Host 返回 600 且 payload limit5，投影仍只给 5；多序列计数和分页 `end=oldestReturnedAt-1` 连续；省略 limit→Agent 默认不超过 60。核对安装产物后再判断报告 A-9 是否可在真实 Harness 复现。

## 6. P2：运行产物身份，不用 PID 推断代码版本

`system.ping` 当前读取 package.json 的 `version`，同版本多次本地迭代只返回相同版本；pid 表示进程身份，不能证明代码内容。正式发行时递增 semver；开发/实验室构建增加可核验 `buildId`。

在打包流程生成随产物发布的 `build-info.json`：`pluginVersion`、`buildId`（对排序后的**实际发布运行文件**的路径+内容计算 SHA-256，排除自身）、可选 `gitSha`、`builtAt`。运行时只读此文件，禁止从已装环境调用 git；`system.ping.data` 增加 `buildId`，不删除现有 version/clientInstanceId。增加 `scripts/check-build-info.mjs` 对当前发布文件验证摘要，新文件进入 package.json files；`pack:check` 和 Web/Desktop 实验室验收检查身份一致。不要把 `builtAt` 当代码哈希，也不要对带时间戳 tarball 求不可重现的哈希。

验收：改一个发布运行文件，build:check/pack:check 发现旧 buildId；重建后通过；两个相同内容包 ID 相同，改动内容后 ID 改变；本地 tool→Host `system.ping` 和已装 Web/Desktop 读到相同 pluginVersion/buildId。Desktop 身份证据按现有 `AGENTS.md` 的实验室/正式产品安装区分。

## 7. 依赖、提交与门禁

建议以下独立提交，每组先在旧实现复现失败，再修到通过：

1. `fix(agent): scope status and alarm runtime views`（§2.1）；
2. `fix(journal): classify new events without build fallback`（§2.2）；
3. `fix(alarm): preserve audit fields and point identity`（§3.1–3.2）；
4. `feat(agent): add scoped focus and timeline queries`（§3.3）；
5. `feat(points): paginate list with stable cursors and summary view`（§4）；
6. `fix(trend): enforce per-series limit at agent projection`（§5）；
7. `chore(build): expose reproducible plugin build identity`（§6）。

若 §2 的会话泄露复现成立，应先于其余功能上线。§3.3 依赖结构化 owner，不能以旧全局日志代替。§4 的 cursor 在预算投影后重算，不能只改 Host 分页。新生产模块同步 package.json files、类型检查文件清单和 dependency 规则；不扩大 structure-budget 白名单。现有 `points get/list` 值隔离、`omittedIds`、只读 claim、Host commandId 和幂等语义保持不变。

每组跑针对性测试，合并前跑 `lint/typecheck/deps:check/pack:check/build:check/structure:check/assertions:check/test:unit`、`git diff --check`。安全回归矩阵必须包含：两个私有会话与共享层、Agent 和 UI 读路径、未知/历史事件、ACK 详情、32 个以上列表跨页、趋势多序列、过预算与运行值持续追加。真实 Harness 验收先记录 version/buildId/产物指纹，再测只读场景；没有此证据不得把代码通过说成安装通过。

交付报告同时列：实际响应字节数、`total/returned/nextCursor` 不变量、逐页去重结果、不同会话看见的键集合、测试前后 workspace 指纹、版本与 buildId。token 成本来自真实模型计数；没有时只报 UTF-8 字节数，不使用“字符数÷3.5”宣布精确节省。
