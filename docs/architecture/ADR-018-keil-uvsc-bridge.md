# ADR-018: Keil UVSC Binary Protocol and Managed UV4 Debug Process

## Status

Accepted (0.27.0-dev / PR-D).

## Context

早期实现中为 Keil 仿真器后端设计了一个伪造的自定义 JSON 通信层（带 10 字节自定义头），与真实的 Keil µVision UVSOCK / UVSC C ABI 规范完全不兼容。此外，原实现假定用户已在外部手动启动并配置好 Keil，无法支持由 Agent 全自动启动仿真调试的预期工作流。

## Decision

1. **真实 16 字节二进制报文帧（UVSC Framing）**：
   - 彻底废除假冒的 JSON 协议，实现标准 16 字节定长头部（Magic `0x43535655` "UVSC"、Length、MsgId、Opcode、Status），搭配小端序二进制与 UTF-8/ANSI 字符串编解码。
   - 完整支持请求-响应匹配机制与异步推送事件（如 `UV_DBG_CALLBACK`、`UV_ASYNC_MSG`、`UV_DBG_CMD_OUTPUT`）。
2. **托管 UV4 调试进程（Managed UV4 Process）**：
   - 实现 `UV4DebugProcess`：在调试启动时，插件自动拉起最小化的后台 `UV4.exe` 核心进程，并配置专用动态 UVSOCK 端口。
   - 用户无需手动打开 Keil 界面，会话结束时自动安全终止该进程，确保无残留僵尸进程。
3. **能力协商（Capabilities Negotiation）**：
   - Backend 暴露 `capabilities()`，显式声明对断点、寄存器、内存读写和信号脚本（Signal Function）的支持边界，供 UI 与 Agent 自适应判断。

## Consequences

- 仿真器后端与硬件调试后端在 `DebugRuntime` 视角下保持统一的 `DebugBackendContract`。
- 为基于 Keil 仿真器的全自动免插线闭环测试提供了标准通信桥梁。
