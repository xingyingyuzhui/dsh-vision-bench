# dsh-vision-bench · Vision 台架

日常开发用的会话工作台。跟 Claw 无关。

- 会话区标签：**调试**、**上位机**；侧栏：点表（监视）、曲线、告警、串口报文、操作记录
- 设置页 **台架**：Keil 绑定 UV4 与可选 Python；Modbus/串口使用内置 Node 运行时；OpenOCD 仍是 0.19 外部兼容绑定。一键 **运行自检**
- 安装后写入用户预设 **Vision模式**（从官方 `standard` 复制，再挂上 `vision_bench`，提示规则由插件 `vision-bench:guidance` 区段提供）
- Agent 需要时自己调用 `vision_bench`，不把现场状态塞进每一轮系统提示
- 编译 / 读点 / 写点 / 烧录进入共享任务与「操作记录」；Agent 发起的操作实时可见
- 连接状态只看真实链路：未连接 / 连接中 / 已连接 / 断开中 / 连接异常
- 只使用绑定路径，不在磁盘上搜索

## Vision模式

插件启动时若还没有 `vision-bench` 预设，会把官方 **标准模式** 复制到 `$DSH_HOME/.agent-presets/vision-bench/`，并加上 agent 平面的本插件行。新会话在设置里选 **Vision模式** 即可。

`vision_bench` 只出现在这个预设里，避免每个 Agent 都多带一套工具。

| action | 作用 |
|---|---|
| `status` | 当前工程、Target、下载包、进行中任务、操作记录 |
| `ls` | 列出工作区内目录和 `.uvprojx`（不含 `.uvmpw`） |
| `select` | 选定工程 |
| `build` | 编译 |
| `map` | 当前 Target 的组、源文件、包含关系和函数名；超出上限时带 `truncated` |
| `read` | 不传 address 则读点表全部段；传入则单次读 |
| `write` | 写线圈 / 保持寄存器：`values` 长度 1 走 FC05/06，大于 1 走 FC15/16；写入后自动回读并报告一致性。**Agent 发起的写点需要用户在界面上批准**（上位机页确认卡，5 分钟内有效），结果以通知回到会话 |
| `manual` | 请求用户完成现场人工操作（上电、接线、按复位等），`text` 必填；用户在调试页点击完成后以通知回到会话 |

## 当前能用

- 设置页绑定 UV4（Keil 编译）与可选 Python（**仅** Keil 工程脚本）。上位机、点表、曲线、告警和串口报文不要求 Python。OpenOCD 烧录在 0.19 仍是外部兼容绑定，0.20.0 才会改为内置运行时
- **调试**：工作区资源管理器选 `.uvprojx`（暂不支持 `.uvmpw` 多工程），选 Target 和输出格式，再编译。失败时编译输出给出错误数、前几条错误原文、阶段和日志路径；「查看完整日志」在应用内打开日志（尾部 256KB，支持搜索）。Agent 失败编译会把 `logFile` / `phase` / `errors` 写入共享任务。右侧「工程」页跟随当前 Session 的工程和 Target；只解析工作区内的 C/H，映射过大时标明截断。`vision_bench map` 返回同一份结构
- **烧录下载**：绑定 OpenOCD 后选调试器（cmsis-dap/stlink/jlink…）和目标芯片（stm32f1x/stm32f4x/nrf52…），一键烧录走 **确认卡**：显示目标、固件、大小和 sha256，批准后才执行 `program verify reset exit`。下载进入 `download` 任务与「操作记录」
- **看总线报文**：每次 Modbus 读/写记录事务报文（hex）。RTU 为 ADU（含 CRC）；TCP 显示协议归一化报文，不是原始 MBAP。「串口报文」侧栏只展示当前或曾经使用过的 **RTU** 通道（TCP 与仿真连接不出现），负责选择串口与筛选查看（设备/方向/功能码/状态/关键字、暂停滚动、清空、复制 Hex、导出 JSONL），**不再负责打开串口**。串口由上位机连接持有，Windows 下 COM 独占，Worker owner 表按物理口互斥；占用返回 `PORT_IN_USE`

- **上位机**：设备 / 连接 / 点位。RTU 串口扫描本机已连接 COM 口。真实读写走插件内置 Node Modbus 运行时（仿真不启动 Worker）。功能码 01/03 可写（FC05/06 单点、FC15/16 批量），02/04 只读。写入后显示 **写前值 → 目标值 → 回读值**。写入超时返回 `WRITE_OUTCOME_UNKNOWN`（结果未知），不要直接重试，先读回再由用户决定。操作流程：创建连接 → 配置 COM/TCP → 连接 → 添加设备与点位 → 启动轮询 → 查看点表 / 监视 / 曲线 / 告警 → 在「串口报文」选当前 RTU 串口查看报文。**启用（参与运行）不等于已连接**；连接 / 断开中不可修改端点参数，先断开再改
- **Windows 无 Python 安装**：从发布 `.tgz` 安装后，未绑定 Python 即可做 Modbus RTU/TCP 主机读写与轮询。Keil 仍需要本机 UV4；0.19 烧录仍需要外部 OpenOCD。macOS 自动测试不能代替 Windows 10/11 实机验收（Windows 验收状态：待验证）
- **点表元数据**：每段可带倍率 / 偏移 / 单位 / 告警上下限；CSV 导入导出（剪贴板往返）批量编辑
- **趋势曲线**：侧栏「曲线」Tab 实时绘制最近 5 分钟多序列折线（手写 canvas，零依赖），图例含当前值与窗口内 min/max
- **阈值告警**：轮询时评估越限，越限/恢复写入「操作记录」并通知当前会话；侧栏「告警」Tab 回看记录
- **多设备**：主机询问控制板，多连接（COM3/COM4 等）并发时各连接事务、报文来源与游标互不串线，每连接独立队列保序
- **从机（未启用）**：本版本不提供 Modbus 从机模式，UI 与 Agent 层均显式拒绝（`ROLE_NOT_SUPPORTED`）；真正的 Slave Server 单独立项
- **会话协作**：Vision 自动服务当前 Session，不再提供手动绑定/解绑；后台 Session 的操作只记录，不抢当前页面焦点。Agent 定位目标时目标短时高亮并在右下角轻提示「Agent 已定位到 …」，可一次性返回原位置
- **右侧栏**：和 Excel 预览一样挂在 `dsh-better-sidebar`。监视（点表）、曲线、告警、串口报文、**操作记录** 均已可用；点表值 / 监视 / 曲线 / 告警共享同一实时值来源，一次轮询同时驱动，不重复占串口

还没做：CAN 监视、验证流程（verify）。

## 安装

前置：本机已能运行 `dsh web`。右侧实时点表还需要已安装 `dsh-better-sidebar`。

```sh
dsh plugin --profile web add github:xingyingyuzhui/dsh-vision-bench
```

本机开发：

```sh
dsh plugin --profile web add link:/abs/path/to/dsh-vision-bench
```

装完重启 `dsh web`。打开 **调试** / **上位机**，或 **设置 → 台架**。新会话选 **Vision模式**。

## 卸载

```sh
dsh plugin --profile web remove dsh-vision-bench
```

绑定写在 `$DSH_HOME/vision-bench/bindings.json`。用户预设 `Vision模式` 不会随卸载删除。

## 开发

改 `bench-*.mjs` / `host.js`，然后：

```sh
npm test
npm run build
```

不要手改生成的 `client.js`。

## License

MIT
