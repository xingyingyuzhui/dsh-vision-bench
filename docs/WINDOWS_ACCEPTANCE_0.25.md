# Windows 实机验收清单（0.25.x）

状态：**尚未真机验收**。macOS 自动化质量门禁不能代替 Windows 10/11 实机 COM / OpenOCD 签字。未在真机完成下列清单前，不得把 Windows 验收勾成已完成，也不得因此打发布标签。

本清单覆盖 0.25 原生三工作区、二级 Tab、GridStack、ECharts、CodeMirror 与缩放布局。CAN/DBC、远程 Runner、多设备拓扑与 Keil 替代不在本轮范围。

## 安装与工作区

- [ ] 干净 Windows 10
- [ ] 干净 Windows 11
- [ ] 已安装 DeepSeek Harness
- [ ] 安装 `dsh-vision-bench` 的 `.tgz`（不要用开发目录 `link` 代替）
- [ ] 重启 `dsh web`
- [ ] 三个原生工作区可打开：调试 / 上位机 / 监控

## 二级 Tab

- [ ] 调试：工作台 / 工程结构
- [ ] 监控：可视化 / 告警 / 串口报文 / 操作记录
- [ ] 同 cwd 两个 Session 互不串扰（导航、状态轮询、Agent Focus）

## GridStack 与图表

- [ ] 可视化组件可拖拽
- [ ] 可视化组件可缩放
- [ ] Agent `visualization op=layout` 后当前 Session 页面位置同步
- [ ] ECharts 曲线图
- [ ] ECharts 柱状图
- [ ] 无 ECharts 时 uPlot / CSS fallback 仍可读

## CodeMirror

- [ ] 中文路径工程文件可预览
- [ ] 编译错误定位到文件和行
- [ ] 目标行滚动进入视口并高亮
- [ ] 未进入工程结构时不跑 Map / 不创建编辑器

## 显示与布局

- [ ] Windows 缩放 100%
- [ ] Windows 缩放 125%
- [ ] Windows 缩放 150%
- [ ] 窄屏上下布局可用

## 串口

- [ ] COM 独占：同一物理口不可被两个连接同时打开
- [ ] 监控→串口报文可查看当前 RTU 通道报文

## 明确未做

- Windows 真机 COM / OpenOCD 签字（本文件保持未验收）
- CAN/DBC、远程 Runner、多设备拓扑
- Keil 替代方案
- 新增更多图表类型
