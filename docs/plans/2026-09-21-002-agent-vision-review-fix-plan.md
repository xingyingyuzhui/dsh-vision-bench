# Vision Agent × 插件迭代：Review 问题修复计划

> 基线：2026-09-21 本地未提交改动，HEAD `5b4101f`。本计划针对已实现的 Agent/插件协作迭代做修复，不替代原始功能计划。修复前先确认工作区状态，保留另一侧已做的改动；每组改动独立提交，便于回退。

## 完成标准与顺序

先修 **A 发布阻断**，再修 **B 读取事实与结果投影**、**C 告警投递**、**D 输入契约**，最后做 **E 集成验收**。A 可以独立合入；B、C 中的缺陷直接影响 Agent 判断，修复前不应发布这一轮功能。

最终必须满足：`lint`、`typecheck`、相关单元/集成测试、`pack:check` 通过；`npm pack --dry-run` 中包含所有运行时 import 的模块。`build:check` 和全量测试现有的非本轮失败应先与 HEAD 对照归因，不把既有问题误记为本轮新增，但发布门槛仍须清零。Web 与 Desktop 使用同一 Host 路径跑隔离仿真场景。

## A. 修复发布阻断（P0）

**改动位置**：`package.json` 的 `files[]`、`src/application/commands/agent-result-projection.mjs`。

1. 将新运行时模块 `src/application/commands/agent-result-projection.mjs`、`src/application/commands/config-drift-refresh.mjs`、`src/interfaces/agent/agent-tool-preflight.mjs` 加入 `files[]`。同时核查 `src/ui/.../viz-card-menu.mjs` 的已有遗漏：如运行时需要，加入清单。以 `scripts/check-package.mjs` 的真实 import 闭包为准，不靠排除测试来通过。
2. 修正投影模块的 JSDoc：`projectStatus(_args, result)` 的注释名与形参一致；`values`、`framesLog`、`trend.series` 等数组显式标为 `any[]` 或定义局部结果类型，消除新增的 6 个隐式 `any`/参数名错误。不要用关闭 `@ts-check` 或放宽 TypeScript 配置绕过。
3. `command-router-handlers.test.mjs` 中的会话隔离用例：此前 `status(sessionId:'s1')` 已 claim 私有拓扑，后续修改若意在同会话，应显式传 `sessionId:'s1'`，再断言 `TARGET_MISMATCH`；另加一个缺 session 的断言，明确应返回 `SESSION_REQUIRED`。这是测试语义修正，不能把生产隔离检查删掉。

**验证**：`npm run typecheck`、`npm run pack:check`、`npm pack --dry-run`、上述定向测试。`frames-model.mjs` 的旧类型错误及其他旧失败单列基线并修到发布检查全绿。

## B. 让 Agent 看到真实、完整且有界的读数（P1）

**改动位置**：`src/application/modbus/read-service.mjs`、`src/application/commands/agent-result-projection.mjs`、必要时 `src/application/commands/handlers/live-command-handler.mjs`。

1. 在 `modbusRead` 每个 `runReadTx` 成功批次中，直接从 `ran.result.details.raw` 构造本次读数，不要从全局 `latest.values` 推测。推荐返回独立的 `readings[]`：

   ```js
   { connectionId, deviceId, function: batch.fc,
     address: batch.address, count: batch.count,
     raw: raw.slice(0, batch.count), frameId: entry?.id || '',
     transactionId: ran.transactionId || '' }
   ```

   失败批次保留 `results[].error`，不要伪造零值。Host/UI 的原有 `values`、`framesLog`、`framesByConnection` 保持兼容；Agent 投影只从 `readings` 取得无点位的 scratch read 结果。单点读保留该点的 `values` 和必要的 `readings`；`all:true` 按本次批次返回，超限时分页或给明确的 `truncated/nextCursor`，不可静默丢数。
2. `projectRead` 不应在没有 pointId 时回传“前 32 条全局 values”；那与请求地址无关。把 `args.function/address/count` 与 `readings` 对齐，至少覆盖 `FC03 @900 count=2` 得到两个实际原始寄存器值的场景。响应里还应保留连接、设备和目标地址，便于 Agent 判断读的是哪台设备。
3. `projectAlarm` 保留诊断所需字段：`condition`、`group`、`pointId`、`connectionId`、当前/触发值、阈值、质量/状态、发生/恢复时间和可用的帧引用。只裁掉大段历史与重复配置。告警超过返回窗口时提供 `total/returned/nextCursor`，并保证 `alarmId` 查询不会被前 40 项截掉。
4. `AGENT_TEXT_CAPS` 目前只是声明，不会约束输出。对 status/read/config/frames/trend/alarm 的生产投影测 UTF-8 字节数；先缩减非关键数组或分页，始终保留 `ok/errorCode/details/commandId/approval`。无法保持预算且保留必要信息时显式标记超限，并提供后续查询入口。`frames` 也必须有服务端上限，不能只接受无限大的 `limit`。

**验证**：仿真 scratch read 断言结构化原始值与模拟 RX 一致；多连接点表时不混入别的连接值；单点读不会携带 500 帧；`alarmId` 能返回完整诊断字段；预算测试覆盖多点、多帧及失败/审批结果。

## C. 修复告警订阅与投递语义（P1）

**改动位置**：`src/application/modbus/poll-alarm-notify.mjs`、`src/application/commands/handlers/live-command-handler.mjs`、`src/infrastructure/host/notify.mjs` 的调用约定。

1. `recheckAlarmCurrent(home,cwd,item)` 增加目标 `sessionId`，由已匹配的 watch、Agent focus 或待处理命令提供；读取 `loadWorkspace` 后通过 `modbusForSession(workspace, sessionId)` 查私有点位与共享运行态告警。无 session 且工作区已分区时不得退回顶层 `ws.modbus.points` 猜测，也不得向绑定的其他会话投递。先确定投递目标，再做 live recheck。
2. `alarmEventMeta` 中的 `alarm.id` 是告警/点位的稳定 ID，不能优先当事件 ID。优先使用真正的 `item.eventId`/`alarm.eventId`；缺失时由 **cwd + sessionId + connectionId + pointId + kind + transition timestamp 或 commit 序号** 生成单次状态迁移 ID。相同事件的重复回调只投递一次；清除后再次触发的新事件必须投递。不要仅靠 `Date.now()` 在读取时现造去重键。
3. 将 `agentAlarmWatchByCwd` 改成 `cwd + sessionId` 的作用域；记录 `createdAt/expiresAt`，限定有效期，并在 `watch:false`、会话结束或过期时清理。`alarm watch` 返回实际订阅对象的 session、目标、有效期，便于 Agent 确认。`alarmId` 单独输入在多连接工作区必须先解析到唯一目标；前置校验和 Host 的 `resolveTarget` 必须遵守同一规则，不能一个放行、一个再报 `TARGET_REQUIRED`。`live-command-handler.mjs` 的 `else if (alarmId...)` 目前永远不可达，应合并到有效分支。
4. 投递状态至少分 `pending/delivered`。`notifyBenchEvent` 返回 `{ok:true}` 后才标记 delivered 和增加 `notified`；`{ok:false}` 或异常允许有界重试，并防止并发重复投递。事件账本按 TTL/LRU 清理。明确通知失败的记录与重试上限，避免静默吞掉错误形成“已经通知”的假象。
5. `shouldNotifyAgentOfProcessAlarm` 对运行任务/人工请求的兜底匹配要绑定同一 session 与相关连接/点位；不应因为工作区里有任意 Agent 任务，就把无关点位告警送过去。继续保留日志记账；已删除/恢复的告警仅为历史事件，不作为当前故障唤醒 Agent。

**验证**：私有点 `p1` 的有效 watch 能通知；另一 session/连接不能收到；同一点两次独立触发能通知两次，重复回调只通知一次；通知 `{ok:false}` 后不计成功并可重试；删点或告警恢复后零当前告警通知；watch 过期后零通知。相关用例放入 `test/agent/alarm-notify-gate.test.mjs`，使用注入的时钟/通知函数避免真实等待。

## D. 消除配置字段的静默冲突（P1）

**改动位置**：`src/domain/modbus/point-patch.mjs`、`src/application/config/config-point-mutations.mjs`、`src/interfaces/agent/agent-tool-preflight.mjs`。

1. 抽出 `validateMonitorAlias(input)` 纯函数，供 `applyPointPatch` 和 `points.add` 在 `normalizePointV3(raw)` 前共同调用。同一次请求同时给 `monitorEnabled` 与 `trendEnabled` 且布尔语义相反，返回 `FIELD_CONFLICT`；同值双字段及单独旧别名继续兼容。
2. 批量 add/update 先在临时 `points` 数组完成全部验证，再统一 `finishPoints`；任何一项冲突时整个批次失败且 `configVersion` 不增加。检查 `point-service.mjs` 等非 `config-point-mutations` 入口是否也接收同一两字段，确保 Agent、UI 和导入路径行为一致。
3. Agent preflight 与 Host `resolveTarget` 的前置条件对齐。特别是 `alarmId`、`trendKey` 是否能唯一定位必须由实际索引判定；无法判定时直接返回带 `missingFields` 的结构化错误。`CONFIG_DRIFT` 的 `refresh` 提示保留，但回归用例需要确认 Agent 先重读、再重算变更，不把 `actualVersion` 当重试凭证。

**验证**：`points.add` 和 `points.update` 对冲突双字段均失败，版本及点表不变；三点批量其中一个冲突时原子失败；旧别名输入仍可用；多连接 `alarmId` 不再出现“预检通过、Host 报缺 ID”。

## E. 集成验收与基线归因

1. 对当前 7 个 `test:unit` 失败逐项记录 HEAD 对照结果。本轮新增的包清单、会话测试失败必须修复；`multi-conn-poll`、`frames-virtualizer-real-effects` 等先确认是否为既有失败，再决定本轮修还是单列阻断项。不能通过跳过测试掩盖。
2. `test/agent/sim-cooperation-scenario.test.mjs` 覆盖：私有 session status/points 一致 → 批量加点 → scratch 与单点读 → 版本漂移后重读 → 删点 → 静态配置对比 → 告警订阅与停止。断言 Agent 结果中的实际数值、数量、版本和通知去向，而不只断言 `ok:true`。
3. 运行 `npm run lint`、`npm run typecheck`、定向测试、`npm run test:unit`、`npm run build:check`、`npm run pack:check`，再做 Web/Desktop 仿真冒烟。构建产物 `client.js` 的过期问题按仓库既定构建流程更新或解释差异；不要把与 UI 源码无关的构建失败无声忽略。

## 建议的变更拆分

| 变更 | 主要文件 | 可合入条件 |
| --- | --- | --- |
| A 发布/类型 | `package.json`、`agent-result-projection.mjs`、会话测试 | 类型、包检查、定向测试通过 |
| B 读取/投影 | `read-service.mjs`、`agent-result-projection.mjs` | scratch 值准确、结果有界、告警详情完整 |
| C 告警 | `poll-alarm-notify.mjs`、`live-command-handler.mjs` | session 隔离、事件级幂等、成功投递计数 |
| D 配置契约 | `point-patch.mjs`、`config-point-mutations.mjs`、preflight | add/update 一致、批量原子性 |
| E 验收 | 仿真用例与构建/包清单 | 全量检查及 Web/Desktop 冒烟通过 |
