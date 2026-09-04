# ADR-014: Debug events streaming over Connection RPC cursor long-poll

## Status

Accepted (0.27.0-dev / Phase 0).

## Context

嵌入式运行调试具有高频、异步事件（断点命中、Watchpoint 触发、单步完成、异常中断、控制台日志等）的特点。这与 Vision 原有的常规工作区配置及点位 2 秒轮询（`POLL_MS = 2000`）模式存在本质差异：
1. 若将高频调试事件直接塞入普通 `/state` 轮询，会导致普通轮询报文膨胀、延迟严重（多达 2 秒延迟无法满足调试单步交互需求）；
2. 若为调试单独引入一个 WebSocket Server 或 SSE HTTP 服务，则直接违背了 ADR-012 中“所有前端操作走鉴权 Connection RPC、不另开端口与服务器”的安全与网络契约。

## Decision

1. **常规状态与调试事件解耦**：
   - 常规工作区状态轮询（`state-subscription.mjs`）继续维持 2 秒基准周期，严禁将 call stack、locals、registers、实时 event ring 塞入 `/state` 响应。
   - `/state` 仅允许携带轻量的调试能力与会话摘要状态（如 `debug: { available, active, ownerSessionId }`）。
2. **基于 Connection RPC 的 Cursor Long-poll**：
   - 调试事件传输严格复用 Harness 已鉴权的 Connection RPC 通道（`VISION_RPC_CHANNEL`）。
   - Host 为每个 DebugSession 维护环形事件缓冲区（`DebugEventRing`，带单调递增 cursor），暴露统一的 `debug/events/wait` 端点。
   - 前端通过 `use-debug-events.mjs` 发起带 `cursor` 的 long-poll：有新事件立即返回；无事件挂起等待（上限 20~25s 后返回空并立即轮候）；支持 `AbortSignal` 随时取消。
3. **传输层抽象与可替换性**：
   - Event Stream 内部做面向接口封装，V1 采用成熟可靠的 Cursor RPC Long-poll，未来若 Harness 提供原生的 Typed RPC Stream，可透明替换底层传输实现，UI 视图层无感。

## Consequences

- 调试交互实现毫秒级即时响应，单步与断点命中无 2 秒轮询延迟。
- 维持唯一的 Browser ↔ Host 传输通道，不增加额外的网络端口或协议脆弱面。
- 离开页面或切换会话时，前序 long-poll 请求能够通过 `AbortSignal` 立即释放，不遗留挂起句柄。
