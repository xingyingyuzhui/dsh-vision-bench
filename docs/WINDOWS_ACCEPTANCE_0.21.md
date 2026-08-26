# Windows 实机验收清单（阶段 8）

本阶段必须在干净 Windows 10/11 + DeepSeek Harness 上执行，**不能用开发目录 link 代替最终 `.tgz`**。

## 8.1 安装

- [ ] 干净 Windows 10
- [ ] 干净 Windows 11
- [ ] 已安装 DeepSeek Harness
- [ ] 未安装 Python
- [ ] 安装 `dsh-vision-bench@0.21.0` 的 `.tgz`
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
- [ ] 配置版本漂移 / Agent 写请求过期
- [ ] Workspace 写入失败 / 旧格式迁移失败
- [ ] 不崩溃 Harness、不串连接、不误报成功、有结构化错误码
