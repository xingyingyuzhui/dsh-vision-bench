# Windows + STM32 硬件实机链验收记录 (v0.27)

本文档定义了根据稳定性修复计划 Phase 5 (PR-C) 针对 Windows 10 / 11 + STM32 物理硬件调试链的验收规范、记录模版与验证清单。

---

## 1. 测试环境与硬件标识

- **验收日期 (date)**: YYYY-MM-DD
- **测试机型 (machine)**: e.g. Dell XPS 15 / ThinkPad T14
- **操作系统 (Windows version)**: Windows 11 Pro 23H2 (Build 22631.x)
- **OpenOCD 版本 (OpenOCD version)**: Open On-Chip Debugger 0.12.0
- **GDB 版本 (GDB version)**: GNU gdb (Arm GNU Toolchain 13.3.rel1) 14.2
- **调试器型号与序列号 (probe model / serial)**: ST-LINK/V2-1 (Serial: 066EFF525750877267073238)
- **目标单片机 (MCU)**: STM32F407VET6 (Cortex-M4, 168MHz)
- **固件 SHA256 (artifact hash)**: a1b2c3d4e5... (sha256 of fixtures/stm32-debug-smoke/stm32_smoke.axf)
- **验收结论 (result)**: PENDING_PHYSICAL_VERIFICATION / PASS / FAIL

---

## 2. 验收清单与验证记录

### 2.1 会话启动与权限卡 (Start & Approval)

1. **指令下发**: Agent 调用 vision_debug action: start，或前端调用 debug/command op: start。
2. **安全卡弹出**: Agent 请求必须拦截并返回 DEBUG_APPROVAL_REQUIRED，前端渲染审批卡，包含固件路径、SHA256、目标芯片和调试接口。
3. **用户审批**: 用户在界面点击“批准”，带 approvalRequestId 执行启动。
4. **进程生命周期**:
   - 临时 OpenOCD 进程成功启动，绑定回环端口 (如 127.0.0.1:3344)。
   - 临时 GDB 进程成功启动，通过 target extended-remote 连接。
5. **状态流转**: Target 初始 halt，状态进入 paused，上报源码位置 (main.c:13)。

- **验证记录**:
  - [ ] Approval 卡展示正常且 SHA256 与构建一致
  - [ ] 动态 GDB 端口无冲突
  - [ ] OpenOCD / GDB 进程正常拉起且无僵尸进程
  - [ ] 初始状态为 paused

### 2.2 断点控制 (Breakpoint)

1. **打断点**: 在 main.c 函数 update_value (L7) 设置断点。
2. **继续运行**: 下发 run / resume，事件上报 debug.running。
3. **命中停机**: 当计数器达到 1000 触发断点，目标暂停。
4. **事件与位置**: 接收 backend.stopped (reason=breakpoint-hit)，状态更新为 paused，位置精确对齐 main.c:7。

- **验证记录**:
  - [ ] 断点下发成功，GDB 响应 bkpt={number="1"...}
  - [ ] 运行至断点命中且精确停在断点行
  - [ ] Runtime 严格在 native stop 后发射 debug.breakpoint.hit

### 2.3 单步调试 (Step Into / Over / Out)

1. **执行单步**: 下发 step (over / into)。
2. **无伪完成**: Runtime 必须首先将状态置为 running，等待底层 *stopped,reason="end-stepping-range"。
3. **步进完成**: 收到 native stop 后才更新状态为 paused 并发射 debug.step.complete。

- **验证记录**:
  - [ ] Step Over 正确步进到下一源码行
  - [ ] Step Into 正确步入函数内部
  - [ ] 杜绝任何同步 fake 假完成

### 2.4 数据观察点 (Watchpoint)

1. **设置观察点**: 对全局变量 watched 设置写入观察点 (write watchpoint)。
2. **恢复运行**: 下发 run。
3. **写变量触发**: 当 watched++ 执行时，硬件数据断点触发。
4. **事件与数值**: 上报 debug.watchpoint.hit，捕获变更前后数值。

- **验证记录**:
  - [ ] Watchpoint 正确设置在 &watched
  - [ ] 变量被写入时硬件断点正常触发
  - [ ] 能够读取当前最新内存值

### 2.5 运行时检查 (Inspect & Variables)

1. **堆栈检查**: 获取当前 Call Stack 帧（支持限制 top 5）。
2. **局部/全局变量**: 读取局部变量与全局变量当前值。
3. **寄存器与内存**: 读取核心寄存器 (r0-r15, sp, lr, pc, xPSR) 及指定内存块。

- **验证记录**:
  - [ ] Call Stack 正确显示函数调用栈
  - [ ] 变量解析无格式错乱
  - [ ] 寄存器与内存读取值与物理芯片状态一致

### 2.6 快照捕获 (Snapshot & Evidence)

1. **快照采集**: 下发 debug.snapshot。
2. **快照元数据**: 生成的 Snapshot 必须严格携带 firmwareHash、location、stack、locals、timestamp 与 backend。
3. **诊断证据**: 能够作为 debug_snapshot 证据关联至工作区诊断日志。

- **验证记录**:
  - [ ] 快照包含完整上下文且 firmwareHash 严格绑定
  - [ ] 快照可持久化并在日志面板回显

### 2.7 会话清理与租约释放 (Stop & Teardown)

1. **停止调试**: 下发 debug.stop。
2. **进程退出**: GDB 发送 -gdb-exit，OpenOCD 随之优雅终止，杜绝任何孤儿/僵尸进程。
3. **租约与端口**: TargetLeaseManager 释放目标锁，动态回环端口被还回操作系统。
4. **会话状态**: debug/state 返回 active: false。

- **验证记录**:
  - [ ] GDB 与 OpenOCD 进程完全退出
  - [ ] 物理 SWD 接口释放，重新连接无需拔插 USB
  - [ ] 端口正常释放
  - [ ] 租约成功归还，支持后续会话无缝启动
