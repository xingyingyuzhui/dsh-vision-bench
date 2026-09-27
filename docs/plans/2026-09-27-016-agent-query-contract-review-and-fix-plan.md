# Vision Agent 第三轮只读实测复核与修复计划

## 1. 基线与结论

审查基线：`bb67176`，工作树审查开始时干净；插件版本 `0.29.28`。`build-info.json` 的 `gitSha=79d8768`、`buildId=eb337abca092b553…` 与本轮 Harness 报告一致。当前 HEAD 比该 SHA 多一条只刷新构建信息的提交，因此 `gitSha` 不是“当前 HEAD 必须完全相等”的断言；内容指纹才是同版本实验构建的可靠标识。此处无需再修版本识别逻辑。报告中的 pid 更换仅证明 Host 进程重启。

这轮七次调用的只读结果与主要代码路径相符，但“七个调用全通”应表述为六个成功查询加一个符合预期的 `frames` 缺参错误；`vision_debug status` 属另一工具。报告把 A-12 归为“`points list` 没有默认 limit”与代码不符：Agent 默认 **20**、最大 **50**；总数 16 时返回全部 16 是正常行为。已用 25 点复核默认返回 20 且带 `nextCursor`。`status.log=[]/logHiddenCount=8` 是保护无会话归属短日志的既定设计；`timeline.list` 是可归属事件的查询入口，不应恢复全局日志文本。

仍有三项确定的接口缺陷，以及两项相邻读路径问题：

| 优先级 | 发现 | 影响 |
|---|---|---|
| P1 | 公开工具 schema 缺 `cursor` 与 `view` | Agent 无法按 `nextCursor` 续查 `points list`/`timeline.list`，也不能请求 `summary` |
| P1 | `alarm` 超预算裁剪后沿用裁剪前游标 | 翻页跳过未返回的告警；100 条、请求 40、只保留 10 时下一页从 40 开始 |
| P1 | `frames` 读路径调用持久化 legacy claim | 成功的只读报文查询在旧工作区可改动磁盘拓扑 |
| P2 | `timeline.list` 不走 Agent 16 KiB 输出预算 | 50 条、每条 180 个中文字符可返回约 33 KiB |
| P2 | `points list` 在分页前计算全部点位的运行值 | 请求 3 条仍对整个可见点表做身份/值投影，点位多时成本不随 limit 缩减 |

`configVersion:444→448` 和 `c1.enabled=false` 与两次人工更新在时间上相符，但单凭只读快照不能证明每次更新造成的版本增量或关闭原因；追因要核对结构化配置提交事件和前后配置。当前没有证据把它列为回归。

## 2. P1：公开工具参数与 Host 查询契约对齐

`src/interfaces/agent/vision-bench-tool.mjs` 的 `parameters.additionalProperties=false`，却没有 `cursor`、`view` 属性。Host 已在 `handlers/config-command-handler.mjs` 将二者转给点位列表，`agent-observe-queries.mjs` 也消费 `cursor`；现有分页测试调用 `runVisionBench`，绕开了真实工具 schema，因此没有发现此断层。`offset` 虽已公开，却不被点位/时间线读取为游标，不能代替 `cursor`。

实施：

1. 在 `visionBenchTool().parameters.properties` 加 `cursor:{type:'string'}`，描述它只用于支持游标的查询；加 `view:{type:'string',enum:['full','summary']}`，说明适用于 `points op=list`，默认 `full`，`summary` 不含运行值。保留当前 `offset` 给 `frames`/`alarm` 的数字偏移分页。
2. 同步工具描述：`points list` Agent 默认 20/最大 50；`timeline.list` 默认 20/最大 50，按 `nextCursor` 续查；`status.log` 隐藏无归属日志，`logHiddenCount` 不是可直接读取的日志条数；`focus.get` 与 `timeline.list` 是只读动作。修正 `status` 描述中“任务时间线”暗示全量事件的措辞，以及 `limit` 字段只提 frames/trend 的过时说明。
3. 不新增 `points list` 默认 limit：`points-list-page.mjs` 已实现。不要为了 A-12 再做一次分页改造。

测试必须从 `visionBenchTool(home).parameters` 取 schema，并经真实工具 `execute`/Host 路径完成 **45 点三页**与 **>20 条时间线两页**；确认 schema 允许 `view/cursor` 且拒绝其他未知字段，跨会话/过滤条件/配置版本的游标仍被拒绝或提示刷新。单测只调用内部函数不足以验收 Agent 可用性。

## 3. P1：告警预算分页保持无漏页

`src/application/commands/agent-result-project-rest.mjs::projectAlarm` 先按 `pageOffset+pageLimit` 生成 `nextCursor`，超预算时把 `alarms` 缩成前 10 条，却用 `p.nextCursor || String(keep.length)`；当旧游标非空时会跳过预算丢弃的行。复现：100 条、每条 `ackedBy` 较长、`limit:40`，第一页只返回 `p000…p009`，但 `nextCursor='40'`，第二页从 `p040` 起。

实施：

1. 将“形成候选页 → 预算试算 → 写最终元数据”合在同一个分页函数中。优先试 `k=page.length…1`，保留连续前缀 `slice(0,k)`；对每个候选计算 `returned=k`、`nextCursor=(pageOffset+k<total ? String(pageOffset+k) : null)`、`truncated=(k<page.length || nextCursor!==null)`，第一个满足 `alarmBytes` 的候选才返回。勿复用裁剪前游标。
2. `alarmId` 单查走独立分支，不合成列表游标。单条超过预算时返回明确的 `overrun`/错误和 `alarmId`，不得给 `ok:true`、`returned:0`、无可续查游标的伪成功；关键 ACK/发生/清除字段的保留顺序要写进测试。
3. 继续保持会话可见性先于分页；`returned===Object.keys(alarms).length`，`total` 是授权后的总数。若未来要保证告警集合持续增删时跨页快照一致，需要额外的稳定锚点/修订号，不把本次“预算不漏页”表述为快照分页。

测试：正常页、预算缩页、中间 `offset`、末页、单条过大、`alarmId` 详情；对静态 100 条逐页拼接检查 **恰好 100 个不同 ID**，而不只断言 `nextCursor` 非空。利用真实较长字段构造预算压力，不依赖把 cap 常量调低。

## 4. P1：报文查询保持真正只读

`src/application/modbus/frame-service.mjs::listFrames` 目前调用 `ensureWorkspaceClaimedSync`。该函数在 `workspace-session-view.mjs` 对 legacy 私有拓扑调用 `saveWorkspace`，移动首次会话 claim 而不增加 `configVersion`。本轮 `frames` 缺参在 Agent preflight 就返回，**没有执行此读路径**，所以七次实测不能证明成功报文查询无副作用。

实施：将 `listFrames` 改用已有 `loadSessionViewForRead(home,cwd,origin.sessionId)`，和 `points list/get`、`focus.get`、`timeline.list` 一致。先在分区工作区且缺 `sessionId` 时明确返回 `SESSION_REQUIRED`；不能让无会话 caller 退回任意私有层。保留现有目标校验、最新端 `offset` 语义、frameId 单查、stale 提示。完成后若 `ensureWorkspaceClaimedSync` 已无生产引用再删除，否则保留并注明仅写路径可用。

测试：构造未 claim 的 legacy 工作区和 A/B 两个会话；A 成功 `frames` 列表和 `frameId` 单查前后比较原始 workspace 字节/拓扑、`configVersion`；A 的只读预览不抢占 B 的首次写入 claim；已分区无 session 拒绝。真实帧 ring 的读取不应产生 `saveWorkspace`。

## 5. P2：时间线输出预算与可续查性

`timelineList` 在 Host 侧按会话过滤、按事件 ID 做游标，且在锚点淘汰时返回 `CURSOR_EXPIRED`，这部分设计正确。`agent-result-projection.mjs` 对 `timeline.list` 仅移除 `workspace`，未调用预算器；中文摘要按字符裁到 180，50 条仍可能超过 16 KiB。已构造 50 条常规长度 ID、180 字中文摘要，投影输出约 33 KiB，`truncated:false`。

实施：为时间线单列 `projectTimelineList`，逐条在完整事件边界缩页，保留最新端连续前缀；当留下 `k` 条时 `returned=k`、`nextCursor=events[k-1].id`（若后面还有事件），`truncated=true`。Host 原本 `nextCursor` 为 null 但预算缩页时，也要用最后实际保留的事件 ID；不可沿用未裁剪页的锚点。单事件过大时返回可诊断 overrun，不能静默丢事件或越权扩展页。`summary` 的 Unicode 裁剪方式可顺带核对，但不靠缩短摘要替代总预算。

测试 50 条中文长摘要，逐页聚合无重叠/跳过；追加新事件后旧游标仍定位原事件；锚点淘汰得到 `CURSOR_EXPIRED`；每页低于 `listBytes`，除明确 overrun 外 `returned===events.length`。此项与 §2 的 schema 修复一起端到端验收，否则投影有游标但 Agent 仍无法传回。

## 6. P2：点位列表只为选中的页取值

`point-service.mjs` 的 list 分支先对 `list` 做 `compactPointRowForQuery`，再调用 `pagePointsList`。页大小限制了输出，不限制身份解析/运行值投影成本。建议拆 `pagePointDefinitions`：先对当前会话可见**配置点**排序、校验 cursor、选出页，再对页内点调用 `compactPointRowForQuery`；`summary` 也只计算页内必要的 `valueStatus`。保持排序键 `[connectionId,deviceId,id]`、过滤后的 `total`、`configVersion` 指纹、`CONFIG_DRIFT` 行为与预算收缩游标不变。

测试 160+ 点、limit 3/20/50，断言全部页 ID 与旧实现一致，分页过程中运行值变化不影响配置页边界；用注入计数或轻量 profiler 证明身份/值选择次数随 `returned` 而不是 `total` 增长。此优化不改变 Host/UI 非 Agent 不分页调用的返回内容。

## 7. 交付顺序与验收

建议按可独立回滚的四组提交：

1. `fix(agent): expose query cursors and summary view`（§2）；
2. `fix(alarm): preserve cursor continuity after budget shrink`（§3）；
3. `fix(frames): avoid persistent claim on read`（§4）；
4. `fix(agent): bound timeline pages and page point values lazily`（§5–6，可拆为两提交）。

每组先补能在当前 HEAD 失败的复现测试，再实现并跑针对性测试。最终执行 `lint`、`typecheck`、`deps:check`、`structure:check`、`assertions:check`、`pack:check`、`build:check`、`test:unit`、`git diff --check`；记录既有三项测试基线失败，不能把旧失败计为本轮新回归，也不能只凭局部绿测宣布全量通过。新增生产模块加入 `package.json files`，不扩大结构预算白名单。

真实 Harness 复验先记录 `pluginVersion/buildId/gitSha`、Host pid、测试前后 workspace 指纹。至少完成：45 点 `summary` 跨页、50 条中文时间线跨页、100 告警预算跨页、legacy 工作区成功 `frames` 查询无磁盘变化、两会话互不可见；`frames` 缺参应明确列为**预期错误响应**。Web/Desktop 已装产物分别复核，代码测试不代替安装验收；不做硬件写入来验证只读修复。

## 8. 实施决策（2026-09-27 补充）

1. **不适用参数明确拒绝。** `cursor` 仅用于 `points op=list` 和 `timeline.list`；`view` 仅用于 `points op=list`。例如 `frames+cursor`、`alarm+view`、`points op=get+view` 返回 `ok:false,errorCode:'INVALID_FIELD'`，给出 `details.field/action/supportedBy` 和可操作 `hint`。Agent preflight 可提前报同形错误，Host 分发仍须独立校验；沿用 envelope 保留 `commandId`。不静默忽略，也不让 `offset` 假扮点位/时间线游标。先检查现有直连调用是否误传这些字段，并调整调用方。
2. **单条超预算用精确失败。** 新增 `RESULT_TOO_LARGE`（当前错误码表没有适合此语义的码），统一形状为 `ok:false,errorCode:'RESULT_TOO_LARGE',overrun:true,truncated:true,retryable:false,returned:0`，并保留 `commandId/action/total`。告警含 `alarmId`，时间线含 `eventId`；ID 自身若极端过长，返回可容纳的诊断指纹，不让错误体再次超预算。失败时 `nextCursor:null`，表示本页**未消费**该条，不能假装可以跳页。文案明确“单条记录超过 Agent 输出上限，当前查询无法完整返回；请到 Vision UI 查看/导出该记录”，不要建议重复同一请求或用更小 `limit`。`alarmId` 详情同样失败，不裁掉审计字段后声称成功。常规缩页仍返回 `ok:true`，按最后实际返回条目重算游标。
3. **A-12 不立项。** Agent 默认 `limit:20`、最大 50；16 个点全量返回符合契约，只补 schema/说明与 25/45 点端到端用例。
4. **隐藏短日志保持。** `status.log=[]` 且 `logHiddenCount=8` 不变。`timeline.list` 只展示有当前会话归属的结构化事件；不能宣称它能读回那 8 条无归属旧短日志，`logHiddenCount` 也不是未读计数。
5. **版本和轮询状态暂不立项。** `444→448` 与 `pollingByConnection.c1.enabled=false` 是观察值，不等于 `connections.c1.enabled=false`，更不能仅凭时间相邻归因于两次人工更新。若后续发现无提交却涨版本或无停轮询命令却关闭，再用结构化事件与配置前后快照单独复现。
6. **Web 与 Desktop 都做 lab 验收。** 虽无 UI 改动，Agent schema/Host 查询属于双端接口；两边使用相同新构建并分别记录 `buildId`、实际跨页结果、错误契约和磁盘不变性。Desktop lab 证据不冒充正式商店/产品安装证明；本轮不做硬件写入。
