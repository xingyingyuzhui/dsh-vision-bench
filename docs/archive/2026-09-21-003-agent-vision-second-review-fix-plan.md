# Vision Agent × 插件：第二轮 Review 修复计划

> 基线：2026-09-21 工作树中已落地但未提交的 A–E 修复。当前 `lint`、`typecheck`、`pack:check`、`build:check` 通过；`test:unit` 为 1426/1429，余下 3 项已在 HEAD 隔离副本复现。本计划只处理第二轮 review 新发现的行为缺陷，不把那 3 项基线失败混入这轮改动。

## 建议实施顺序

先修 **1 告警事件身份**，再修 **2 多会话投递与失败重试**，随后并行处理 **3 报文分页**、**4 趋势目标/会话视图**，最后修 **5 取消订阅** 并完成端到端验收。每组有独立测试和提交；不要先拆当前 A/B/C/D commit 再把已知缺陷留在待发布分支。

## 1. 每次告警迁移生成独立事件 ID（P1）

**问题**：`poll-alarm-notify.mjs` 的 `alarmEventMeta()` 用 `alarm.firstAt` 优先组成 fallback ID；`alarm-evaluate.mjs` 在抑制窗口内恢复后再次触发会复用 `firstAt`。实测两次 `fired` 的事件 ID 相同，第二次被 delivery ledger 丢掉。

**改动**：

- 在 `src/application/modbus/modbus-commit.mjs` 为每条**已成功提交**的 `alarms.fired` 添加 `eventId`，使用 `randomUUID()` 或同等唯一 ID。一次已提交迁移只生成一次，后续给所有订阅者及重试都沿用同一个 ID。不要把稳定的 `alarm.id` 或可能复用的 `firstAt` 当事件 ID。
- `src/application/modbus/poll-alarm-notify.mjs::alarmEventMeta()` 优先读 `item.eventId`。仅为旧调用/合成测试保留 fallback，并将 `alarm.lastAt` 放在 `alarm.firstAt` 前；当没有可验证的迁移时间时生成一个新的事件 ID，避免把不同事件永久合并。返回 `eventAt` 应是本次迁移时间，而非首次越限时间。
- 不改变 `alarmState` 的点位键及 UI 对 `firstAt` 的展示语义。`eventId` 是通知/幂等身份，不是告警对象身份。

**测试**：在 `test/agent/alarm-notify-gate.test.mjs` 用真实 `evaluateAlarms` 或 `commitPollResult` 走 `越限 → 恢复 → 抑制窗口内再次越限`，断言两次 `fired` 均有不同 `eventId`，重复投递同一 `fired` 仍只通知一次。覆盖同一毫秒内两次迁移，不能仅靠 `lastAt` 通过。

## 2. 每个会话独立匹配、投递和重试（P1）

**问题**：`shouldNotifyAgentOfProcessAlarm()` 遍历 watch 后立即 `return`；两个会话订阅同一共享点位时只有第一个收到。`beginDeliveryAttempt()` 对 `pending` 再次返回 `proceed:true`，可并发重复投递；`{ok:false}` 只在同一事件再次被调用时才重试，但真实 `fired` 通常只出现一次。

**改动**：

1. 在 `src/application/modbus/poll-alarm-notify.mjs` 新增 `matchingAlarmRecipients(home,cwd,item,sourceSessionId)`，返回按 `sessionId` 去重的数组，而非单个 gate。保留当前 watch、focus、待处理命令的匹配条件；同一 session 多个理由只发一次，显式 watch 优先。每个 recipient 调用 `recheckAlarmCurrent(...,recipient.sessionId)`；不属于该会话点表的事件不投递。
2. 从 `src/application/modbus/polling-service.mjs` 把已有的 `targetSessionId` 传给 `emitCommittedAlarmTransitions(...,{sourceSessionId})`。有明确来源时只匹配该私有会话和有权看到该点的共享订阅者；无来源的共享点可发给所有匹配 watch。对 `sessionConfigs` 中重复 point/connection ID 且无法判定归属的事件，记录 `ambiguous-owner` 并停止 Agent 通知，不能凭 watch 插入顺序猜会话。这个保护不要求本轮重构整个共享 runtime 键空间。
3. 在 `src/application/modbus/alarm-notify-registry.mjs` 把 delivery ledger 的键改成 **`eventId + sessionId`**。状态至少为 `pending/queued/delivered/exhausted`；`pending` 期间的第二次 claim 返回 `proceed:false`。完成时只把本 recipient 标记 delivered，不影响其他会话。
4. `emitCommittedAlarmTransitions()` 收到 `{ok:false}` 或异常时将本 recipient 的通知任务放进有界重试队列，使用如 `1s/3s/10s` 的退避和最多 3 次尝试。每次重试前重新检查 watch 是否有效、会话是否仍存在、点位与告警是否仍 active；恢复或删除时取消。成功才增加 `notified`；最终失败记可诊断事件/计数。重试任务保留相同 `eventId`，插件卸载时清理计时器与队列（`host.js` 的 dispose 路径）。
5. `notifyBenchEvent()` 返回值不变；队列只消费明确的 `{ok:true}`。内存队列的进程重启丢失应在文档写明；若未来要求跨重启保证投递，再引入持久 outbox，不在这轮临时扩张存储模型。

**测试**：两个 session 订阅同一共享点，分别收到一次；同一 session 的 watch+focus 仍只收到一次；私有点只投来源 session；并发重复 `emit` 时一次投递；第一次 `{ok:false}` 后不靠重复 `fired` 也能在注入时钟推进后重试成功；重试前恢复/删点/退订则零额外通知；卸载无残留定时器。

## 3. 报文压缩后分页契约必须对应实际返回内容（P1）

**问题**：`src/application/commands/agent-result-project-rest.mjs::projectFrames()` 先算 `returned/nextCursor`，超预算又把 `frames` 从 100 条切到前 10 条，却不重算元数据。实测 `frames.length=10`、`returned=100`、`nextCursor="100"`，下次调用跳过 90 条。

**改动**：

- 保持 `src/application/modbus/frame-service.mjs::listFrames()` 当前“`offset` 是从最新端往前数”的语义。投影若需缩页，保留当前页的**末尾连续 k 条**（`frames.slice(-k)`），使 `offset+k` 恰好对应下一批更旧报文；不能使用 `slice(0,k)`。
- 在 `projectFrames()` 中先选定满足 `AGENT_TEXT_CAPS.framesBytes` 的最大 `k`（最多 100；可从最大页长递减，报文上限小），**再**生成 `returned=k`、`nextCursor=String(offset+k)`、`truncated`。`returned === frames.length` 必须成为不变量；`nextCursor` 必须能以 `offset=Number(nextCursor)` 继续读取。若单条报文自身超过预算，保留 `frameId`、目标与 `overrun`，提示用 `frameId` 单查，不把 `ok:true` 的空报文集伪装成完整页。
- 若要保证采集持续追加时跨页不重叠，补 `beforeFrameId` 或快照游标：`listFrames` 先定位该 ID，再取更旧的连续页；ID 被 500 帧 ring 淘汰时返回 `CURSOR_EXPIRED`，要求重新从最新页读取。不要把可变列表上的 `offset` 宣称为稳定历史快照。

**测试**：200 条报文、每条约 300B，请求 `limit=100`；检查 `returned===frames.length`、首尾 ID 连续、第二页从第一页面最旧 ID 的前一条继续、合并后无遗漏/重复；另测巨大单帧、ring 淘汰和采集期间新增帧。

## 4. `trendKey` 真正限定点位，并使用会话有效点表（P1）

**问题**：`live-command-handler.mjs` 验证 `trendKey` 后丢弃解析出的 pointId，`scopeIds` 回退为前 8 个开启监视的点。实测请求 `c1:d1:p1` 返回 `p1`、`p2`。`readTrendSeries()` 又用顶层 `normalizeModbus(loadWorkspace().modbus)` 查询点位元数据，私有会话的名称/单位退化为 ID/空串。

**改动**：

- `handleLiveCommand(trend)` 保存 `resolveTarget()` 结果：`resolvedPointId = rt.pointId`；`scopeIds = trendKey ? [resolvedPointId] : pointIds.length ? pointIds : ...`。`connectionId` 也使用 `rt.connectionId`，不得在只给 `trendKey` 时回退到当前活动连接。若同时提供 `pointIds`，与 key 不一致直接 `TARGET_MISMATCH`。
- 将 `src/application/modbus/trend-store.mjs::readTrendSeries()` 改为可接收当前会话 `pack`，或新增 `readTrendSeriesFromPack(pack,opts)` 纯函数；`live-command-handler` 传已经取得的 `modbusForSession(workspace,origin.sessionId)`。保持旧的 `(home,cwd,opts)` 兼容入口供 UI 使用。趋势样本仍读共享 runtime，但名称/连接/设备/单位及点位有效性以会话点表为准。
- `projectTrend()` 不再返回无法直接使用的 `nextCursor:'older'`。对每条 series 返回 `hasMore` 和 `oldestReturnedAt`；Agent 要翻旧样本时单点调用 `pointIds:[id], end:oldestReturnedAt-1`。若保留 `nextCursor`，必须让工具 Schema/Host 真正接受并解析它，且多序列使用每点独立游标。

**测试**：两个监视点+两个连接、私有 session：只给 `trendKey` 恰返回指定点；`name/unit/connectionId/deviceId` 与该 session 点表一致；不暴露其他 session 私有点；分页不会重复或跳过样本。

## 5. 取消订阅应只需要当前会话（P2）

**问题**：`src/interfaces/agent/agent-tool-preflight.mjs` 对所有 `alarm` 都要求 `connectionId`；`{action:'alarm',watch:false}` 在 `clearAgentAlarmWatch(cwd,sessionId)` 前被拒绝。当前测试只覆盖了直接调用 registry 或带 connectionId 的退订。

**改动**：

- 在 preflight 最前面识别 `action==='alarm' && (watch===false || followup===false)`，只要求有效 Agent session 与 cwd，不再要求 `connectionId/alarmId`。对 `watch:true` 继续执行目标校验。
- `live-command-handler.mjs` 在退订分支**先按当前 session 清除 watch 并返回 `{ok:true,action:'alarm',subscription:{cleared:true,sessionId}}`**，不先调用 `resolveTarget` 或读取告警列表；重复取消仍返回成功。若用户同时给 `watch:true` 和 `followup:false` 等矛盾开关，返回 `FIELD_CONFLICT`，避免歧义。
- `vision-bench-tool.mjs` Schema/说明明确：`alarm watch:false` 取消本会话订阅，不需要目标 ID。

**测试**：通过生产 `visionBenchTool(...).execute` 调用退订，不带连接 ID 也成功；会话 A 退订不清会话 B；重复退订幂等；矛盾开关明确失败。继续保留 Host/UI 路径的权限与会话隔离。

## 交付门禁与提交划分

| 提交 | 主要文件 | 必过验证 |
| --- | --- | --- |
| 告警事件身份 | `modbus-commit.mjs`、`poll-alarm-notify.mjs` | 恢复再触发产生两个事件，同一事件幂等 |
| 多会话投递/重试 | `poll-alarm-notify.mjs`、`alarm-notify-registry.mjs`、`polling-service.mjs`、`host.js` | 两会话各收一次；失败自动重试；卸载清理 |
| 报文分页 | `agent-result-project-rest.mjs`、`frame-service.mjs`（若加稳定游标） | 连续翻页无漏/重，元数据与内容一致 |
| 趋势目标与会话 | `live-command-handler.mjs`、`trend-store.mjs`、投影/Schema | `trendKey` 只查一个点，私有点元数据正确 |
| 退订契约 | `agent-tool-preflight.mjs`、`live-command-handler.mjs`、工具说明 | 无连接 ID 退订成功且不影响其他会话 |

每组先运行相应定向测试，最终运行 `lint`、`typecheck`、`pack:check`、`build:check`、全量单测及 Web/Desktop 隔离仿真。全量单测的 3 个 HEAD 基线失败继续单列，不通过修改断言或跳过测试来掩盖。合入前还应让 `git diff --check` 通过；当前 `poll-alarm-notify.mjs` 尾部有一个多余空行。
