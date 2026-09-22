# Vision Agent × 插件协作：代码级迭代计划

> 依据：2026-09-21 的 `session.v3.jsonl 2` 实测，以及 `dsh-vision-bench` 当前 `5b4101f` / `0.29.25` 源码。本文是实施计划，不表示这些改动已完成。原始会话日志只保留在本机，不作为测试 fixture 提交。

## 目标与已证实的边界

两轮测试中，Agent 可以通过真实 Host 完成探活、仿真读点、批量点位增删改、可视化增删及布局更新。三点批量新增只推进一次 `configVersion`，旧版本提交返回 `CONFIG_DRIFT`。原有点位和组件的静态配置在清理前后相同；但版本从 401 推进到 408，任务、事件和一次测试告警通知也留下了记录，不能称为整个工作区“完全还原”。没有测试真实设备写入、Keil/OpenOCD 或硬件调试。

需要解决的可复现问题：

| 现象 | 当前代码根因 | 影响 |
| --- | --- | --- |
| `status.modbus.points=[]`，`points list` 却有 16 个点 | [`handleProjectCommand(status)`](../../src/application/commands/handlers/project-command-handler.mjs) 对 `loadWorkspace().modbus` 直接 `normalizeModbus`；[`pointsOp`](../../src/application/commands/handlers/config-command-handler.mjs) 使用会话有效配置。点位可存于 `sessionConfigs`，顶层为空 | Agent 从两个工具得到矛盾现场，并错误报告 17 个点 |
| `status` 约 358 KB；读一个点的 `read` 约 318 KB | `status` 附上 `framesByConnection`、全部值、告警和时间线；[`modbusRead`](../../src/application/modbus/read-service.mjs) 返回全部 `latest.values` 与最多 500 帧；[`compactAgentResult`](../../src/application/commands/lossless-json.mjs) 只移除 `workspace` | 模型上下文和延迟被历史数据占用，结果溢出到临时文件 |
| `frames/trend/read/alarm` 缺少目标 ID 时逐级报 `TARGET_REQUIRED` | Agent 工具是 54 字段的平铺 Schema，仅全局要求 `action`；[`targetRequired`](../../src/domain/modbus/validation.mjs) 根据连接/设备数逐项校验 | Agent 只能通过失败探测必要参数 |
| `trend(limit=5)` 返回 150 个样本 | [`handleLiveCommand(trend)`](../../src/application/commands/handlers/live-command-handler.mjs) 没传 `limit`；[`readTrendSeries`](../../src/application/modbus/trend-store.mjs) 固定截取 `TREND_KEEP=600` | 调用者无法控制上下文体积 |
| `monitorEnabled`、`trendEnabled` 被相互改写 | [`applyPointPatch`](../../src/domain/modbus/point-patch.mjs) 把 `trendEnabled` 当 `monitorEnabled` 的旧别名；工具 Schema 却让它们看起来是两个开关 | Agent 误判字段独立，提交后发生意料之外的连带变化 |
| 测试点删除后，越限通知仍启动一轮 Agent | [`emitCommittedAlarmTransitions`](../../src/application/modbus/poll-alarm-notify.mjs) 把告警交给 [`notifyBenchEvent`](../../src/infrastructure/host/notify.mjs)，后者以 `role:user` 调用 `agent.followup` | 迟到的通知打断会话，Agent 先猜测“孤儿告警”再查询纠正 |

现有 [`config-mutation-service`](../../src/application/config/config-mutation-service.mjs) **已经禁止普通 UI 配置修改 followup Agent**。旧日志里的布局拖动通知不能当成当前待修的同一个问题；这项行为应加回归测试保持住。

## PR 1：先修会话视图与事实一致性（P0）

1. 在 `src/application/commands/handlers/project-command-handler.mjs` 的 `status` 分支，对有效 `sessionId` 先调用 `ensureWorkspaceClaimed(home,cwd,sessionId)`，再用 `modbusForSession(workspace,sessionId)` 构造 `modbus`。无会话且未分区的旧工作区保持原路径；已分区但缺 `sessionId` 时返回 `SESSION_REQUIRED`，不得读取其他会话的私有拓扑。`status` 顶层新增 `configVersion`，保留原嵌套字段一个兼容周期。
2. 在 `test/agent/tool-schema.test.mjs` 与 `test/config/scope-wiring.test.mjs` 加**先 claim、再 status/points list** 的同会话用例，以及另一会话隔离用例。断言两种读法的点位 ID 集合、连接/设备 ID 集合和版本一致；原 16 点场景不得再报告 0 点。
3. Agent 口径写进 `src/infrastructure/harness/guidance.mjs`：数量、状态和“已恢复”必须取工具返回的实际字段；配置对象清理与版本/历史回滚分开描述。`CONFIG_DRIFT` 后必须重新调用对应 `list/get`，不能只用错误里的 `actualVersion` 直接重试。

**验收**：同一 session 的 `status` 与 `points list` 都返回 16 点；别的 session 看不到私有点；Agent 的测试摘要不把 16 写成 17；版本冲突调用链中确实出现重新读取。

## PR 2：为 Agent 提供短结果，不改 UI/Host 的完整返回（P0）

在 `src/application/commands/` 新增 `agent-result-projection.mjs`，由 `vision-bench-tool.mjs` 的生产 `execute` 在 `dispatchVisionCommand` 之后、`finalizeAgentCommandResult` 之前调用。现有 `runVisionBench` 是许多业务测试使用的辅助入口，默认保留完整结果；投影另做纯函数测试，并用工具 `execute` 的集成测试覆盖生产路径。**只压缩 Agent 可见结果**；UI RPC/Fetch 和 Host 原始结果先不变，避免破坏页面对全量快照的依赖。

建议投影契约：

```js
projectAgentResult(args, result) // 保留 ok/action/commandId/errorCode/error/details
// status: configVersion、当前工程、连接/设备摘要、数量、任务摘要；不带历史帧和值数组
// read: taskId、simulated、results、请求点的 values、此次 framesLog 的 frameId/transactionId
// config: previousConfigVersion、nextConfigVersion、changedIds、affected*、postCommitWarnings
// frames/trend: 按显式 limit 截取，返回 total/returned/nextCursor（如适用）
```

`read` 单点结果按 `args.pointId` / 本次批次筛选；`framesByConnection` 仍留在 Host 日志和专用 `frames` 查询，不随每次读点重复返回。`status` 只返回连接状态和数量，不把 `pack.framesByConnection`、`pack.values`、`alarmState` 全量灌给模型；对应详情仍可通过 `points/frames/alarm` 查询。配置提交只给改动对象的摘要和 ID，不能再回吐全部点位/连接/设备。保留 `commandId`、错误详情和审批结果，不能为了减小体积截掉安全信息。

同步在 `handleLiveCommand(trend)` 把受限的 `limit` 传入 `readTrendSeries`，在 `trend-store.mjs` 对每条 `series.samples` 截取；返回 `count`（总样本数）和 `returned`（本次样本数）。明确 `limit` 是**每条序列的样本数**，例如 5 必须最多返回 5 条；默认值为 Agent 小窗口，Host/UI 可继续使用现有完整趋势接口。

在 `test/commands/lossless-json.test.mjs`、`test/agent/tool-schema.test.mjs` 和 `test/domain/trend.test.mjs` 加有 16 点、8 连接和 500 帧的 fixture，断言单点 `read` 不含 `framesByConnection` 且仅有目标值；`status` 不暴露私有层与历史帧；`trend(limit=5)` 每序列最多 5 样本。设明确的 Agent 文本上限：常规 `status` ≤16 KiB、单点 `read` ≤8 KiB、三点配置提交 ≤8 KiB，超过时由分页/引用补取，不静默截断。

## PR 3：整理工具契约和点位字段（P1）

1. 在 `src/interfaces/agent/vision-bench-tool.mjs` 把操作前置条件写到对应参数与动作说明：`frames/trend/alarm` 带 `connectionId`，`read/write` 带稳定的 `connectionId + deviceId`；缺失时由一个 Agent 入口校验器一次返回 `missingFields[]` 和安全的下一步提示。Host 保留现有多目标歧义保护，不能靠活动 UI 焦点替 Agent 选设备。对于旧调用可先返回结构化错误，不改变 Host/UI 兼容路径。
2. 只推荐 Agent 使用 `connectionId`、`expectedConfigVersion`、`monitorEnabled` 作为规范字段；`connId`、`configVersion`、`trendEnabled` 保留为兼容输入，但在 Schema 中标记别名与优先级。`focus` 会改变 UI，`evidence[]` 会追加日志，不能继续把两者一概写成“只读”。`visualization get` 的缺 ID 默认行为也要明确。
3. `src/domain/modbus/point-patch.mjs` 保持旧单字段 `trendEnabled` 别名语义；当同一次请求同时提供相反的 `monitorEnabled` 与 `trendEnabled` 时，返回 `FIELD_CONFLICT`，不要静默覆盖。返回点位仍带旧字段供 UI 兼容，一个后续主版本再考虑删除。更新 `test/config/point-patch-semantics.test.mjs` 和工具 Schema 测试，覆盖单别名、同值双字段、冲突双字段、批量原子失败。
4. 对 `CONFIG_DRIFT` 返回增加机器可读的 `refresh` 提示（例如 `{action:'points',op:'list'}` 或 `{action:'visualization',op:'get',visualizationId}`）。这只是提示，Host 仍需以版本锁校验写入。Agent 评估用例必须证明它先重读、再重算变更；不应把 `actualVersion` 当成重试凭证。

**验收**：正常点位/帧查询不经过一串 `TARGET_REQUIRED`；冲突开关字段明确失败且版本不变；旧别名单独使用仍可用；版本漂移后不会盲目重放旧删除。

## PR 4：告警投递与仿真验收（P1）

1. `src/application/modbus/poll-alarm-notify.mjs` 继续写入事件/时间线，但不要把每条过程量告警无条件包装成新用户请求。给通知增加 `eventId`、`pointId`、`connectionId`、`eventAt`、`commandId/testRunId`（若有）与当前状态；只有用户明确要求 Agent 监控、或存在相关待完成 Agent 命令时才调用 `notifyBenchEvent`。投递前复核点位和告警状态；已经删除/恢复的事件标为**历史事件**，不得当成当前故障。
2. 保留写点拒绝、端点漂移、编译/烧录失败、人工操作完成等需要 Agent 后续处理的通知，按来源 session/command 关联；常规 UI 拖拽、点位开关仍不得唤醒 Agent。不要用相同文案去重：应以 `eventId` 或 `commandId` 做幂等关联。
3. 从本次日志抽取**合成**的仿真场景到 `test/agent/`、`test/devices/poll-alarm-commit.test.mjs` 或 `scripts/probes/`：无工程但有私有连接/点位 → 只读查询 → 三点批量新增 → 更新 → 组件布局 → 故意版本漂移 → 重读 → 删除 → 清理检查。基线与末态比较静态点位/组件对象和告警键；另报告 `configVersion`、任务与历史记录的预期增长。默认测试点 `alarmEnabled:false`；专门测告警时使用隔离仿真工作区。

**验收**：Web 与 Desktop 的 M1 仿真路径均通过；普通 UI 改配置 0 次额外 Agent 回合；已删除测试点不会在 Agent 对话中被报告成“当前告警”；测试结论准确区分静态配置恢复与历史保留。真实串口、真实设备写入和固件调试仍按现有 M2 硬件验收单独进行，不能用仿真通过宣称完成。

## 实施顺序和回退

推荐 `PR 1 → PR 2 → PR 3 → PR 4`，每个 PR 保持 Host 唯一状态所有者和 Web/Desktop 同一业务路径。PR 1 修正事实来源；PR 2 限制模型上下文；PR 3 减少试错和静默改写；PR 4 消除迟到通知造成的误判。先运行受影响的单元/集成测试，再运行 `npm run quality`；Agent 对话评估使用隔离仿真工作区，不用真实硬件和用户当前配置作为 fixture。若压缩投影影响旧 Agent 解析，只回退 Agent 视图这一层，Host/UI 的完整业务结果不随之回退。
