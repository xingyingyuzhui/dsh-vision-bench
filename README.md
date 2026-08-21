# dsh-vision-bench · Vision 台架

日常开发用的会话工作台。跟 Claw 无关。

- 会话区两个标签：**调试**、**上位机**
- 设置页 **台架**：绑定本机 Python / Keil UV4 / OpenOCD
- 安装后写入用户预设 **台架模式**（从官方 `standard` 复制，再挂上 `vision_bench`）
- Agent 需要时自己调用 `vision_bench`，不把现场状态塞进每一轮系统提示
- 编译 / 读点进入共享任务和时间线；调试页轮询，能看到 Agent 发起的编译
- 只使用绑定路径，不在磁盘上搜索

## 台架模式

插件启动时若还没有 `vision-bench` 预设，会把官方 **标准模式** 复制到 `$DSH_HOME/.agent-presets/vision-bench/`，并加上 agent 平面的本插件行。新会话在设置里选 **台架模式** 即可。

`vision_bench` 只出现在这个预设里，避免每个 Agent 都多带一套工具。

| action | 作用 |
|---|---|
| `status` | 当前工程、Target、下载包、进行中任务、时间线 |
| `ls` | 列出工作区内目录和 `.uvprojx`（不含 `.uvmpw`） |
| `select` | 选定工程 |
| `build` | 编译 |
| `map` | 当前 Target 的组、源文件、包含关系和函数名；超出上限时带 `truncated` |
| `read` | 不传 address 则读点表全部段；传入则单次读 |
| `write` | 写线圈 / 保持寄存器：`values` 长度 1 走 FC05/06，大于 1 走 FC15/16；写入后自动回读并报告一致性。高影响操作，只按用户明确给出的地址和值执行 |

## 当前能用

- 设置页绑定 Python / UV4 / OpenOCD（绝对路径）
- **调试**：工作区资源管理器选 `.uvprojx`（暂不支持 `.uvmpw` 多工程），选 Target 和输出格式，再编译。失败时编译输出给出错误数、前几条错误原文、阶段和日志路径；「查看完整日志」在应用内打开日志（尾部 256KB，支持搜索）。Agent 失败编译会把 `logFile` / `phase` / `errors` 写入共享任务。右侧「工程」页跟随当前 Session 的工程和 Target；只解析工作区内的 C/H，映射过大时标明截断。`vision_bench map` 返回同一份结构
- **烧录下载**：绑定 OpenOCD 后选调试器（cmsis-dap/stlink/jlink…）和目标芯片（stm32f1x/stm32f4x/nrf52…），一键烧录走 **确认卡**：显示目标、固件、大小和 sha256，批准后才执行 `program verify reset exit`。下载进入 `download` 任务和时间线
- **串口日志**：选串口和波特率打开监视，实时时间戳行、关键字过滤、error/warn 高亮、暂停滚动、复制给 Agent；服务端保留最近 2000 行

- **上位机**：设备 / 连接 / 寄存器段。RTU 串口扫描本机已连接 COM 口，下拉选择。真读真写需要绑定 Python（`pymodbus`，RTU 再加 `pyserial`）；仿真不需要。功能码下拉标注可写性：01 线圈、03 保持寄存器可写（FC05/06 单点、FC15/16 批量），02/04 只读。段表行内「写入」打开写入面板：地址限段内、线圈 ON/OFF 或寄存器值、批量逗号分隔，确认后显示 **写前值 → 目标值 → 回读值**。侧栏点表可写点位行内 ✎ 直接单点写
- **点表元数据**：每段可带倍率 / 偏移 / 单位 / 告警上下限；CSV 导入导出（剪贴板往返）批量编辑
- **趋势曲线**：侧栏「曲线」Tab 实时绘制最近 5 分钟多序列折线（手写 canvas，零依赖），图例含当前值与窗口内 min/max
- **阈值告警**：轮询时评估越限，越限/恢复写入时间线并通知绑定会话；侧栏「告警」Tab 回看记录
- **从机**：本机 TCP 监听支持 FC01–06/15/16；对仿真从机写入会自动退出仿真并持久化写入值；越界地址回异常码
- **多设备**：主机询问控制板；从机在本机 TCP 监听。可用「主从示例」一键仿真双机
- **会话绑定与通知**：调试页「通知绑定 · 绑定本会话」后，编译失败、写点失败或 Agent 发起的任务完成会以 notice 进入绑定会话（`agent.followup`，不可用时退回 `steer`）。`vision_bench status` 返回 `session.isBound`。任务类型注册表已预留 `download` / `verify`；时间线分级保留（重要事件优先）
- **右侧栏**：和 Excel 预览一样挂在 `dsh-better-sidebar`。监视打开「点表」Tab，曲线、告警已可用

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

装完重启 `dsh web`。打开 **调试** / **上位机**，或 **设置 → 台架**。新会话选 **台架模式**。

## 卸载

```sh
dsh plugin --profile web remove dsh-vision-bench
```

绑定写在 `$DSH_HOME/vision-bench/bindings.json`。用户预设 `台架模式` 不会随卸载删除。

## 开发

改 `bench-*.mjs` / `host.js`，然后：

```sh
npm test
npm run build
```

不要手改生成的 `client.js`。

## License

MIT
