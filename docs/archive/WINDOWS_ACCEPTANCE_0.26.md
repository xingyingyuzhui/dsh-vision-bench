# Windows 实机验收清单（0.26.x）

状态：**尚未真机验收**。macOS 自动化质量门禁不能代替 Windows 10/11 实机 COM / OpenOCD 签字。未在真机完成下列清单前，不得把 Windows 验收勾成已完成，也不得因此打发布标签。

本清单覆盖 DSH 0.1.2-alpha.3 上的 Vision 0.26.0：原生三工作区、`useWorkspaces` cwd、`viewRequest` 导航、locale/notice 契约、loopback HTTP 防护。CAN/DBC、远程 Runner、多设备拓扑与 Keil 替代不在本轮范围。

## 安装与工作区

- [ ] 干净 Windows 10
- [ ] 干净 Windows 11
- [ ] 已安装 DeepSeek Harness 0.1.2-alpha.3
- [ ] 安装 `dsh-vision-bench` 的 `.tgz`（不要用开发目录 `link` 代替）
- [ ] 重启 `dsh web`
- [ ] 三个原生工作区可打开：调试 / 上位机 / 监控
- [ ] 每页显示当前 workspace path，而不是空白或上一 Session 数据

## alpha.3 集成

- [ ] 新建 Session 后三个原生 Tab 都能拿到正确 cwd
- [ ] Session A/B 快速切换不串状态
- [ ] 跨页跳转走原生 Tab（上位机 ↔ 监控 ↔ 调试），不依赖已删除的 `slots.select`
- [ ] 用户主动切页时 Agent 不抢焦点
- [ ] 中文 locale 正常
- [ ] 未登录 / 非 loopback 请求不能读 Vision 状态

## 二级 Tab

- [ ] 调试：工作台 / 工程结构 / 运行调试
- [ ] 监控：可视化 / 告警 / 串口报文 / 操作记录
- [ ] 同 cwd 两个 Session 互不串扰（导航、状态轮询、Agent Focus）

## 调试与仿真链（本轮未验收）

- [ ] OpenOCD / GDB 硬件调试链路（启动、单步、断点、观察点、变量查看）
- [ ] Keil UVSOCK 仿真调试链路（无实体硬件运行模拟）
- [ ] `vision_debug` Agent 专属工具与会话隔离调用
- [ ] 调试诊断快照创建与证据绑定

## 闭环验证（Verify）

- [ ] 场景断言自动化评估（debug.expression, modbus.point, no.exception, no.alarm, range）
- [ ] PASS/FAIL 自动化判断与 Evidence 写入操作记录

## 设备链（本轮未验收）

- [ ] 串口枚举
- [ ] Modbus RTU 读点
- [ ] Modbus 受控写点
- [ ] OpenOCD 烧录确认卡

## 显示与布局

- [ ] Windows 缩放 100%
- [ ] Windows 缩放 125% / 150%
