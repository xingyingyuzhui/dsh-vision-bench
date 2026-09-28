# Vision 证据引用会话隔离与查询错误修复计划

## 1. 基线与问题边界

实施基线 `b447bd2`，`build-info.json` 对应源码 SHA `646679b`、`buildId=1dd5640c…`，工作树审查时干净。此计划是 016 查询契约迭代后的增量修复。设置页“共享到工作区”按已定产品契约只控制**连接/设备、点位、可视化配置**；它不负责给工作区级 timeline、task、focus、调试运行态做授权。不能通过扩大/关闭共享开关来修复下面的查询绕行。

已用隔离工作区复现：共享全关，A 的 `points list` 仅见 `pa`；A 的 `evidence` 却返回 B 的时间线 ID `b-event`。`src/application/modbus/evidence-service.mjs::buildEvidenceRefs` 直接读全局首条 timeline 和最新 build task，并用顶层 `normalizeModbus(workspace.modbus)` 取点位。这既泄露别人的 ID/时间，也会漏掉 A 自己保存在私有层的点位。该函数还被 `status`、`alarm` 的 Host 原始响应调用；Agent 对这两个动作的最终投影目前不输出 evidence，但 Host/UI 仍持有原始字段，不能只在 Agent 文本投影补过滤。

另两条确定的写路径问题：`handlers/evidence-command-handler.mjs` 在没有 `evidence[]` 的查询中仍调用 `ensureWorkspaceClaimed`，可把 legacy 拓扑落盘归属 A 而不涨版本；`journal-store.mjs::appendEvidence` 对 `kind=log/build` 等非严格类型只检查“有 ID”，不验证目标会话。我复现 A 将 B 的 `log:b-event` 追加到了仍归 B 所有的全局 `focus.evidence`，返回 `ok:true`。UI 的 `postEvidence` 请求体又没有 `sessionId`，在分区工作区不能依赖 Host 猜当前会话。

同一漏洞还有另一条写入口：`focus-service.mjs::requestFocus` 直接截取 `body.evidence`，随后以 `origin.sessionId || body.sessionId` 写入全局 focus；既能绕开 `appendEvidence` 校验，也能覆盖别的会话的焦点。读取侧的 `vision-rpc-workspace.mjs::sessionWorkspaceView` 只投影 modbus，`project-command-handler.mjs::status` 直接带回 `workspace.focus`，`ui/common/focus-store.mjs` 又原样展示历史 evidence。修复必须同时覆盖 focus 写入与所有会话可见的 focus 读取。

查询字段尚有两项次级问题：`view=compact` 被正确判为 `INVALID_FIELD`，顶层错误却错误地称“view 不适用于 points 查询”；数字 `cursor:42` 通过共享校验后被点位/时间线服务当作空游标，静默回到第一页。`points list` 默认 20、最大 50 已实现，`status.log` 隐藏无归属短日志也是现有安全契约，不列为缺陷。

## 2. 必须守住的语义

| 数据 / 操作 | 授权规则 |
|---|---|
| 配置引用 `point/connection/device/visualization` | 按 `projectModbusForSession` 的当前会话有效视图；共享类别可见，私有类别只给主人。不能用顶层 union 或名称推断归属。 |
| `build/log` 引用 | 只给结构化 `sessionId === origin.sessionId` 的 task/event；历史无归属记录不因同 cwd、时间或摘要相似而推断为本会话。 |
| `debug_snapshot` 引用 | 同时核对 `ownerSessionId` 与规范化 `workspaceCwd`；没有可验证 owner 就不输出/不追加。 |
| `evidence` 无 `evidence[]` 或空数组 | 纯查询；不得持久化 claim、写 focus、增加 configVersion 或改变订阅/UI。 |
| `evidence[]` 非空 | 显式追加；所有项在同一工作区版本/会话视图下先验证，通过后原子写；一项失败整批不写。 |
| 分区工作区缺 `sessionId` | Agent 与 UI 证据读写均 `SESSION_REQUIRED`，不能退回全局引用。未分区旧调用可保留现有单工作区兼容。 |
| `focus` 已归 B 所有 | A 追加必须 `SESSION_MISMATCH`，B 的 request/evidence 不变；无 owner 时 A 可建立自己的 evidence owner，但不得伪造焦点 request。 |
| A 发起 `focus`，当前 focus 已归 B | 本轮同样返回 `SESSION_MISMATCH`，不允许隐式抢占；`source=user` 或请求体 `sessionId` 不是可绕过的授权。以后若需要主动切换，须另设明确的用户接管操作，原子清空 B 的 evidence/prev 后再建立 A 的焦点。 |
| 历史 `focus.evidence` | 每次向某会话输出前逐条按当前来源解析；带 owner 的行也不能只信该字段，旧无 owner 行只能在来源可独立证明归属时显示。不可验证、已淘汰、跨会话、同名歧义的行隐藏，磁盘原文不改。 |

本轮**不改变**设置开关的配置共享语义，也不把整个 UI 工作区日志页改为会话私有；`snapshot(...).journal` 的工作区展示是另一个产品边界。只要输出的是“当前会话可用的证据引用”，就必须执行上述规则。旧磁盘上已经混入的 `focus.evidence` 不自动删、不按父级 focus owner 猜每条来源；展示或再次使用前按来源校验，不可验证的旧行隐藏并可在诊断中计数。

## 3. P0：引用生成改为会话视图

将 `buildEvidenceRefs(home,cwd)` 改为接收**可信来源**的 `sessionId`（来自 command origin / 页面 props，不从请求的证据对象里取），并拆出可纯测的 `collectVisibleEvidenceRefs({workspace,pack,sessionId,cwd,debugRef})`。`buildEvidenceRefs` 用 `loadSessionViewForRead` 做 legacy 内存 claim，分区且无 sid 时返回 `SESSION_REQUIRED`；已有 handler 持有同一 workspace/pack 时直接传同一快照，避免二次读盘形成版本/可见性不一致。

- `point`：从会话投影 `pack.points` 选前 5；跨层同名且 runtime 归属不明时只给可见配置标识，不附运行值或其他会话端点。
- `build`：在 tasks 内先按 sessionId 过滤再取最新 build；`log`：在 timeline 内先按 sessionId 过滤再取首条。ID、时间不能在过滤前暴露。无归属 legacy 行默认不可见。
- `debug_snapshot`：现有 `getSharedDebugRuntime().findSession()` 返回的 `DebugSessionView` **不含 `snapshots`**，当前代码读 `activeSession.snapshots` 实际无法产出快照引用。本轮修好这条已有但失效的分支：给 registry/runtime 增加只返回最新快照必要元数据的只读 `latestOwnedSnapshotRef({ownerSessionId,workspaceCwd})` 与 `resolveOwnedSnapshotRef({ownerSessionId,workspaceCwd,debugSessionId,snapshotId})`，在 registry 内先验 owner/cwd 再读原始 session 的 snapshots；勿把整个调试状态暴露给证据服务。`verify-service.mjs` 的 `evidenceBuilder` 同步改成 `(cwd,ownerSessionId)`，输出走相同可见性校验；验证过程通过 `debugRuntime.command({debugSessionId,ownerSessionId}, snapshot)` 新建的快照，须能被该查询 API 解析，别人的快照不可混入 verify 结果。
- 修改三处生产调用：`handlers/evidence-command-handler.mjs`、`handlers/project-command-handler.mjs` 的 status、`handlers/live-command-handler.mjs` 的 alarm。保持 Agent status/alarm 现有瘦身投影；Host/UI 有 session 的原始响应也只带该会话引用。新模块加入 `package.json files`，删除 `evidence-service.mjs` 中已失效的宽泛 import，不抬 structure-budget 白名单。

先写红测：共享关闭 A/B 点、A/B timeline 与 tasks，A 既不能见 B ID/时间，也能见自己的 `pa`；共享打开只影响配置引用，不打开 B 的日志；调试会话属于 B 时 A 无快照，B 可见最新快照；分区无 sid 失败；status/alarm/evidence 三个 Host 出口一致。包括同名私有 pointId、legacy 无归属事件、反向插入顺序。

## 4. P0：把证据查看与追加分开，并补会话身份

`handleEvidenceCommand` 先辨别输入：`evidence` 缺省/`[]` 为只读 list；非数组、数组含非法项返回 `INVALID_FIELD`，不能默默当 list。只读分支调用第 3 节的会话引用服务，**不调用** `ensureWorkspaceClaimed`。`kind/id` 是全局 schema 为其他 action 暴露的字段，`action=evidence` 顶层传它们时返回 `INVALID_FIELD`，提示使用 `timeline.list` 查事件或 `evidence:[{kind,id,...}]` 追加；不让调用方误以为完成了按 ID 查询。

先对跟踪中的 Agent preset、工具说明、文档和调用测试检索顶层 `kind/id` 用法；当前检索只见 `evidence:[{kind,id,...}]` 的追加示例，未见 `action=evidence` 顶层用法。若实施时发现遗留提示词，先同批改为明确的 list/append 契约，再启用拒绝；验收补真实 Harness 的错误提示样例。

非空追加分支以 `origin.sessionId` 调用带授权的 `appendEvidence`；引用列表应在提交成功后按同一会话重新取得，失败时不返回全局引用。`commandId/action` 仍由既有 envelope 补齐。`evidence[]` 是写操作，若以后接入重试/幂等，不能在发送后失败时声称未执行。

UI 的 `src/ui/common/agent-reference.mjs::postEvidence` 以末尾可选参数 `{sessionId}` 扩展现有签名并放入请求体，保留旧未分区调用兼容；五个调用点（HMI、报文、告警、日志、可视化）从已有 `pageSessionId(props)` 或其等价作用域传入。`src/interfaces/rpc/vision-rpc-router.mjs` 的 `evidence` 分支消费该 sid；分区工作区无 sid 不从 `workspace.session.boundId`、focus owner、首个 sessionConfigs 行猜测。UI RPC 的 sessionId 是本地协作作用域标识，不把它宣传成对不受信客户端的独立身份认证。对 helper 用 fake post 做参数断言，页面结构测试用 `react-unit`；无必要不加 HappyDOM。

## 5. P0：追加时验证真实来源与焦点归属

`journal-store.mjs` 已 449 行，建议把 `appendEvidence` 的验证/原子追加抽到 `src/application/modbus/evidence-append-service.mjs`，旧 `journal-store.mjs` 保留 re-export，避免现有调用方断裂。新模块不得反向 import `journal-store.mjs`；读取与追加共用的纯授权判断可再抽 `evidence-scope.mjs`，避免循环依赖。服务用 `workspaceRepository(home).update(cwd, null, updater)`，在同一锁内从最新 workspace 建会话视图、检查 configVersion/目标/owner，并合并最后 20 条；不可在锁外 `loadWorkspace` 验完再用旧 `ws.focus` 调 `saveWorkspaceAsync`。

按 kind 建受控分派：`point/frame/alarm/trend/visualization/connection/device` 必须在当前会话有效配置和相应运行数据中解析；`alarm` 复用会话可见性函数，frame 限定可见且唯一的 connection；同名私有 ID 不因为显式 sid 就绕开全局运行槽歧义。`build/log` 必须在当前会话的 task/timeline 查到对应 ID，**不得**沿用现在的 `isStrict=false` 放行；`debug_snapshot` 要用 owner/cwd 和 snapshot ID 双重校验。未知 kind 返回 `INVALID_FIELD`，不可仅凭任意 ID 入库。隐藏/不存在/已经从有界 timeline 或 tasks 淘汰时统一返回不泄露其他会话详情的 `TARGET_MISMATCH`，文案写“记录不存在、已过期或当前会话不可见”；没有持久 tombstone 就不能准确声称 `EXPIRED`，不新增过期码。版本变化返回 `CONFIG_DRIFT`。未分区时只对**完全无 sessionId 的旧调用**允许使用无归属事件；一旦调用携带 sid，即使未分区也必须 `event.sessionId===sid`，不能引用无归属或别的会话的记录。无 sid 的调用也不能引用有归属记录。

焦点写入前核对 `focus.sessionId`：有主且不等于 sid → `SESSION_MISMATCH`；无主且有 sid → 把本次 evidence owner 标为 sid，保持 request 不变；分区无 sid → `SESSION_REQUIRED`。给新 evidence 行保留受控 `sessionId`，同步 `normalizeFocusState` 以便以后读时逐条校验；旧无 owner 行不自动改写。拒绝时 `focus`、configVersion、磁盘文件逐字节不变。批量验证必须全过才保存，不能前几条成功后第 N 条失败却部分写入。

`requestFocus` 也必须调用这套批量证据解析器。将目标解析、版本检查、现有 focus owner 检查、`body.evidence` 全量验证与保存放入同一个 repository update 临界区；在任何可能落盘的 legacy claim 之前完成拒绝判断，拒绝时 0 写盘。把 `requestFocus(home,cwd,body,origin)` 的身份与业务 body 分开：Agent 入口传 Host command origin，UI RPC 入口显式传页面的 session scope；移除函数内部 `origin.sessionId || body.sessionId` 的再次回退。两种入口都不允许通过 `source:'user'` 隐式覆盖别人的 owner。若当前焦点归 B，A 的 focus 请求一律失败且 request/evidence/prev 不变。新焦点成功时仅保存已验证、带受控 sid 的 evidence。这里的 UI RPC sessionId 仍只是本地页面作用域，不是对恶意本机 RPC 客户端的强认证；不要把隔离测试宣传成跨信任边界安全证明。

读取也复用同一**纯**解析器，增加 `projectVisibleFocus(workspace,sessionId,scope)`，接入 `vision-rpc-workspace.mjs::sessionWorkspaceView`、`workspace-session-view.mjs::workspaceViewForSession` 和 `project-command-handler.mjs::status` 等输出边界，再由 UI `focus-store` 接收过滤后的内容。B 的 focus 对 A 返回空焦点；同 owner 的旧 evidence 逐条解析，不能验证的行过滤并只报告数量，不返回 id/时间。不得只在 UI 组件里过滤，因为 RPC/Host 原始结果仍可读取。红测要从旧磁盘 fixture 构造无 owner/伪 owner/B 的证据，分别覆盖 Host status、RPC snapshot、UI focus store；验证纯读取不改磁盘。

红测至少覆盖：A 追加 B 的 log/build/debug snapshot、A 向 B focus 写证据、同 ID 双私有点、跨连接 frame/alarm、空会话、错误版本、批次第二条失败、并发两次追加无丢失；合法单会话 point/frame/alarm/trend/viz/connection/device 及 UI copy-ref 仍成功。当前已确认的复现是 `A append log:b-event → ok:true，B focus.evidence 多一条`，修后必须变为失败且文件不变。

## 6. P1：查询字段错误语义与游标类型

`agent-query-fields.mjs` 将“不支持该字段”和“取值非法”都走 `invalidField()`，统一写“字段不适用于当前查询”。拆成 `unsupportedField()`、`invalidValue()`、`invalidType()`，保留 `INVALID_FIELD` 与 `details.field/action/supportedBy`；`view=compact` 的顶层 `error` 改为“view 取值无效：compact；合法值 full / summary”，`details.reason='INVALID_VALUE'`、`allowedValues=['full','summary']`。过长输入只回显有界片段，避免错误响应本身超预算。

`cursor` 仅 `undefined` 或 `''` 表示第一页；提供了非字符串、纯空白字符串就返回 `INVALID_FIELD`，不调用点位/时间线服务。Agent 的 `view` 提供了非字符串（包括 `[]`、显式 `null`）也返回 `INVALID_FIELD`；非 Agent 的 UI/内部调用仍沿用现有宽松解析，不因本轮新增拒绝。Agent preflight 与 Host 的 Agent 来源共用同一校验，Host 是权威出口；保留 `commandId`。测试从 `visionBenchTool.execute` 和 `executeVisionCommand` 两条入口跑 `compact`、`cursor:42`、空白游标、`view:[]`、`view:null`，再测 UI/内部 null 兼容，断言 Agent 非法游标不重读第一页；合法 `cursor` 继续跨页无漏项。A-12 不改默认 limit。

## 7. 提交、门禁与验收

建议拆为四组，每组先让复现测试在当前 HEAD 失败，再实现到绿：

1. `fix(evidence): scope generated references to the caller session`（第 3 节）；
2. `fix(evidence): keep listing read-only and pass UI session identity`（第 4 节）；
3. `fix(evidence): authorize and atomically append owned references`（第 5 节）；
4. `fix(agent): distinguish invalid query values and reject malformed cursors`（第 6 节）。

针对性测试后执行 `lint`、`typecheck`、`deps:check`、`structure:check`、`assertions:check`、`pack:check`、`build:check`、`test:unit`、`git diff --check`；新增生产文件进入包文件清单。上轮全量报告为 **1690 项全绿**，本轮按 **0 失败**立基线，实施前在 016 HEAD 重跑并记录准确总数；任何失败都须归因，不再引用已经过时的“三项已知基线失败”。不得只用 `buildEvidenceRefs` 纯函数测试代替 tool→Host→投影、UI post→RPC→store 的端到端测试。

016 当前分支比 `origin/main` 本地超前 8 个提交。先独立推送并确认 016 的远端 SHA 与全绿基线，再在此 HEAD 上形成 017 的四组修复提交；不要把两轮未审的更改合成一次推送。此处只规定交付顺序，不代替实际推送授权或验收。

lab 验收在 Web 与 Desktop 分别记录 `pluginVersion/buildId/gitSha`，用两个同 cwd 会话测试共享全关/只共享连接/全共享：A 的点位和证据引用集合、B 的集合、跨会话追加拒绝、旧工作区纯查询前后 `config.json/runtime.json` 指纹、合法 UI“让 Agent 分析”证据写入及焦点归属。`status.log` 仍隐藏无归属旧短日志；`timeline.list` 仍只给当前会话事件。无需真实串口或硬件写入。Desktop lab 结果不冒充正式产品安装证明。
