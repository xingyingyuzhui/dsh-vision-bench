# ADR-013: Debug runtime boundary and process isolation

## Status

Accepted (0.27.0-dev / Phase 0).

## Context

Vision 模式计划将调试能力从静态的 Keil 编译/烧录与 Modbus 上位机监控，演进为支持真实的嵌入式断点、单步、Watchpoint、寄存器/局部变量查看及程序快照分析的 AI 原生调试体系。

在增加嵌入式调试能力（GDB、OpenOCD、Keil Simulator）时，存在两种错误的架构诱惑：
1. 启动一个独立的 Debug Backend Server（如独立 Express/WebSocket 长期常驻服务），造成服务治理与端口冲突；
2. 允许前端 Browser 或外部 Agent 直接调用 GDB/OpenOCD CLI，甚至在 Client 侧管理调试会话与断点状态。

依据 ADR-001（Modular Monolith）、ADR-004（State Ownership）与 ADR-012（Remote Transport），Host Cordis 树必须是全部运行时能力的唯一宿主，且产品状态必须具备严格的所有权边界。

## Decision

1. **DebugRuntime 作为 Host 内部服务**：
   - 调试运行时必须作为现有 Host 插件内部的 application / infrastructure 能力实现（`src/application/debug/` 与 `src/infrastructure/debug/`）。
   - 严禁新增独立的 Web/WebSocket/Fastify 长期后台服务，不占用独立外部服务端口。
2. **调试子进程为 Session-scoped 临时子进程**：
   - GDB（`arm-none-eabi-gdb`）、OpenOCD、UV4 仅作为生命周期严格绑定到 DebugSession 的短期可回收子进程。
   - 插件空闲（idle）时无任何调试子进程常驻；当调试会话停止、超时、中止（AbortSignal）或插件卸载时，强制清理并终止进程树（kill process tree），绝不产生孤儿进程。
3. **Host 保持唯一权威状态所有者**：
   - Host 是 `DebugSession`、`Breakpoint`、`Watchpoint`、`TargetLease`、`DebugSnapshot` 的唯一状态所有者（owner）。
   - Browser UI 与 Agent 严禁直接控制调试器进程或直连原始 MI/UVSOCK 协议，只能通过经过鉴权与校验的 Host 服务发起结构化指令。
4. **后端演进节奏**：
   - V1 硬件调试后端严格采用 `GDB/MI + OpenOCD`。
   - Keil Simulator（UVSOCK）后端延后至 V1 稳定后（Phase 12）再作为第二个 Backend 接入，不在此前分叉上层抽象。

## Consequences

- 进程模型保持纯净：只有 Harness Host 持有长期状态，外部调试工具纯粹作为临时工作单元。
- 调试会话严格隔离：支持多会话租约互斥（`DEBUG_TARGET_BUSY`），杜绝跨会话越权操作。
- 架构一致性得到维护，不破坏已有的打包与插件运行形态。
