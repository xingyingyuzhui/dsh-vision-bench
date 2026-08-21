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
| `ls` | 列出工作区内目录和 `.uvprojx` |
| `select` | 选定工程 |
| `build` | 编译 |
| `read` | 不传 address 则读点表全部段；传入则单次读 |

## 当前能用

- 设置页绑定 Python / UV4 / OpenOCD（绝对路径）
- **调试**：工作区资源管理器选 `.uvprojx`，选 Target 和输出格式，再编译；有任务时才显示任务列表
- **上位机**：设备 / 连接 / 寄存器段。RTU 串口扫描本机已连接 COM 口，下拉选择。真读需要绑定 Python（`pymodbus`，RTU 再加 `pyserial`）；仿真不需要
- **多设备**：主机询问控制板；从机在本机 TCP 监听。可用「主从示例」一键仿真双机
- **右侧栏**：和 Excel 预览一样挂在 `dsh-better-sidebar`。监视打开「点表」Tab；曲线、告警先占位

还没做：写点、烧录、串口/CAN 监视、OpenOCD。

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
