# ADR-016: Authoritative DebugRuntime State and Backend Event Contract

## Status

Accepted (0.27.0-dev / PR-A).

## Context

在之前的调试体系设计中，后端（如 GdbBackend、KeilSimBackend）各自维护内部状态，并通过不可靠的自拟事件名称与前端通信。这导致了三个核心缺陷：
1. **状态多权威冲突**：Backend 与 Runtime 各自保留 state，当目标硬件发生异步 halt 时，Runtime 状态与 Backend 内部状态脱节。
2. **假同步单步/暂停**：单步与暂停指令发出后，立即发出假的完成事件，导致 UI 与 Agent 在单步尚未完成前就错误读取寄存器与局部变量。
3. **事件命名分叉**：GDB 发送 `debug.stopped`，UI 期望 `paused`，Runtime 发送 `debug.paused`，导致状态机混乱。

## Decision

1. **Backend 仅输出原生事实，Runtime 决定产品语义**：
   - 调试后端必须实现统一的 `DebugBackendContract`，仅通过 `subscribe(listener)` 输出底层事实：`backend.running`、`backend.stopped`、`backend.console`、`backend.exited`、`backend.error`。
   - 后端绝对禁止直接发出 `debug.breakpoint.hit`、`debug.step.complete` 等应用层事件。
2. **DebugRuntime 作为唯一状态权威**：
   - 调试会话的权威状态机（`idle` -> `starting` -> `ready` -> `running` -> `paused` -> `stopping`）完全由 `DebugRuntime` 集中收敛。
   - 所有执行动作（`pause`、`step`）记录 `pendingExecution`，必须等待真实的 `backend.stopped` 事件到达后，由 Runtime reducer 派发真正的语义事件（如 `debug.paused`、`debug.step.complete`）。
3. **统一 Canonical Event 常量**：
   - 共享 `DEBUG_EVENT_TYPES`（`src/shared/debug-events.mjs`），Host 与 UI 均引用权威常量，禁止手写裸字符串判断。

## Consequences

- 彻底消除了目标单步/暂停时的假完成现象，UI 与 Agent 读取到的断点命中与调用栈永远与物理/模拟核心状态一致。
- 后端实现高度轻量化，只需专注于进程拉起和二进制/MI 协议交互。
