# ADR-017: Host-Resolved Debug Launch Spec, Target Lease, and Explicit Approval

## Status

Accepted (0.27.0-dev / PR-B).

## Context

在调试启动设计中，曾试图让 Agent 自行指定底层绝对路径（如 `gdbBin`、`openocdBin`、`artifactPath`、`probeSerial`、固定调试端口 `3333`）。这违反了分层职责并带来安全隐患：
1. Agent 不属于 Host 环境，不应感知本地文件系统路径与物理探针序列号。
2. 客户端或 Agent 通过简单的 `{ "approved": true }` 布尔值即可绕过人类操作审批。
3. 多个会话共用固定端口（`3333`）会导致端口冲突与探针互锁失败。

## Decision

1. **Host 负责不可变 Launch Spec 解析**：
   - 新增 `debug-launch-spec-service.mjs`，根据当前工作区、Keil 工程、固件二进制哈希、OpenOCD Profile 与硬件探针，解析出不可变的 `ResolvedDebugLaunchSpec`。
   - Agent 发起调试仅需提供 `{ action: "start", backend?: "gdb-openocd" }`，无需也不允许传递主机物理路径。
2. **强制显式审批票据（Approval Ticket）**：
   - 调试启动必须首先生成具有过期时间的 `Approval Ticket`，并绑定当前会话、工作区及固件哈希。
   - 严禁通过 `payload.approved = true` 绕过审批。如果固件重新编译（SHA-256 改变），已签发的票据自动失效（`APPROVAL_STALE`）。
3. **物理探针级别的 Target Lease 与动态回环端口**：
   - 目标锁不再按工作区路径互斥，而是按硬件身份（`probeSerial` / 物理接口）加锁，杜绝两套工程同时争用同一探针。
   - GDB 与 OpenOCD 之间通过 `allocateLoopbackPort` 动态分配未占用的临时本地端口，实现会话间端口隔离。

## Consequences

- 调试会话安全与隔离性得到严格保证，支持并发安全与多探针环境。
- Agent 工具定义极大简化，消除了幻觉带来的文件路径错误。
