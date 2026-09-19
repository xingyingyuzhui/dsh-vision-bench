# ADR-014: Debug events streaming over Connection cursor long-poll

## Status

Accepted (0.27.0-dev / Phase 0). Amended (0.29.0): long-poll rides the shared Fetch dispatch carrier (ADR-012); idle pages with chat identity hang on `waitForOwnerSession` instead of short-polling.

## Context

嵌入式运行调试具有高频、异步事件（断点命中、Watchpoint 触发、单步完成、异常中断、控制台日志等）的特点。这与 Vision 原有的常规工作区配置及点位 2 秒轮询（`POLL_MS = 2000`）模式存在本质差异：

1. 若将高频调试事件直接塞入普通 `/state` 轮询，会导致普通轮询报文膨胀、延迟严重（多达 2 秒延迟无法满足调试单步交互需求）；
2. 若为调试单独引入 WebSocket / SSE 端口，则违背 ADR-012「不另开端口与服务器」的契约。

## Decision

1. **常规状态与调试事件解耦**：
   - 常规工作区状态轮询（`state-subscription.mjs`）继续维持 2 秒基准周期，严禁将 call stack、locals、registers、实时 event ring 塞入 `/state` 响应。
   - `/state` 仅允许携带轻量的调试能力与会话摘要。
2. **Cursor long-poll（语义不变，载体迁移）**：
   - 逻辑端点仍为 `debug/events/wait`（环形缓冲 + 单调 cursor）。
   - **产品路径**：UI 经 `POST /api/vision-bench/dispatch`（Fetch）调用该端点；Web 兼容期也可经 `/vision-bench` RPC。
   - 有新事件立即返回；无事件挂起（上限约 20–25s）；支持 `AbortSignal` 取消。
3. **空闲与失败预算**：
   - 无 chat `sessionId`/`cwd` → **零请求**。
   - 有会话身份但尚无 debug session → 调用 `debug/events/wait`；Host 进入 `waitForOwnerSession`（单次挂起约 20–25s，超时再挂起；禁止 1Hz 短轮询）。
   - Agent/用户创建 debug session 后 wait 以 `woke` 返回；UI 刷新 state 后进入正常事件等待。
   - Session `closed` 后清理本地状态，回到 owner-session 发现（允许下一次 Agent 启动被页面发现）。
   - 连续传输失败按 1s→2s→4s→8s→16s 退避，达到 `DEBUG_WAIT_FAILURE_BUDGET` 后停止并展示重试入口，**不**触发插件树重载。
   - 离开页面或切换会话/工作区时，`AbortSignal` 立即取消挂起 wait。
4. **可替换性**：V1 为 cursor long-poll；若未来 Harness 提供 Typed Stream，可换底层而不改 UI 视图契约。

## Consequences

- 调试交互保持低延迟，且 Desktop/Web 共用同一 Fetch 载体。
- Runtime 页在「有身份、无 debug session」时仅保留一条长挂起，CPU/日志保持安静。
- Agent 新建或再次启动的 debug session 可被已打开的页面发现，无需依赖 `active` remount。
- 离开页面或切换会话时，`AbortSignal` 释放挂起 wait。
