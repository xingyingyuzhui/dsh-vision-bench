# Windows 实机验收清单（0.22.0）

本阶段必须在干净 Windows 10/11 + DeepSeek Harness 上执行，**不能用开发目录 link 代替最终 `.tgz`**。

当前仓库状态：macOS 上已完成自动化质量门禁、真实 `system.ping`、配置提交后副作用语义、以及 Node 子进程 HTTP Bridge 测试；**Windows 10/11 上必须用最终 `.tgz` 做 COM 真机验收，未签字不得打 `v0.22.0` 标签**。下列清单供发布前手工执行。

## 8.1 安装

- [ ] 干净 Windows 10
- [ ] 干净 Windows 11
- [ ] 已安装 DeepSeek Harness
- [ ] 未安装 Python
- [ ] 安装 `dsh-vision-bench@0.22.0` 的 `.tgz`
- [ ] 重启 `dsh web`
- [ ] Vision 模式存在
- [ ] 上位机页面正常打开
- [ ] Node Modbus 运行时健康

## 8.2 串口

至少 `COM3` / `COM4`：

- [ ] 串口扫描
- [ ] 同一 COM 不可重复选择
- [ ] COM3/COM4 同时连接
- [ ] 不同 Unit ID / 同地址跨设备隔离
- [ ] 读取 / 写入与回读 / 轮询
- [ ] 串口报文按 COM 筛选
- [ ] 拔出 COM → 连接异常；释放端口；重插可重连
- [ ] Harness 重启后配置保留，不伪装已连接

## 8.3 上位机链路

```text
创建连接 → 配置 COM → 连接 → 添加设备 → 添加点位
→ 读取 → 点击当前值写入 → 开启监视 → 可视化组件
→ 开启告警 → 触发越限 → Agent 定位 → 串口报文核对
```

- [ ] 全流程通过

## 8.4 故障

- [ ] Modbus 超时 / CRC / USB 拔出 / Worker 退出
- [ ] 写入回读不一致 / 结果未知
- [ ] 配置版本冲突 / Agent 写请求过期
- [ ] 无配置草稿卡片；配置修改无需批准
- [ ] Agent 与 UI 共用同一个 I/O Worker，COM 不重复占用
- [ ] Workspace 写入失败 / 旧格式迁移失败
- [ ] 不崩溃 Harness、不串连接、不误报成功、有结构化错误码

## 8.5 OpenOCD（未安装 Python）

- [ ] 未安装 Python时，OpenOCD 烧录确认可正常打开
- [ ] 未安装 Python时，OpenOCD 实机烧录成功
- [ ] OpenOCD 超时可终止整个进程树
- [ ] OpenOCD 路径和固件路径包含空格
- [ ] 取消烧录后无残留 openocd.exe
