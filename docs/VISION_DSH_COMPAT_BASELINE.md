# Vision / DSH 兼容基线（0.29.0）

记录日期：2026-09-19（自 0.28.0 / 2026-09-10 基线修订）。后续每步验收对照本文件，不把空闲低 CPU 单独当成修复成功。跨平台矩阵见 [`ACCEPTANCE_NATIVE_WEB_DESKTOP.md`](./ACCEPTANCE_NATIVE_WEB_DESKTOP.md)。

## 安装与加载

| 项 | 值 |
|---|---|
| DSH CLI（契约钉） | `@deepseek-ai/dsh@0.1.5-rc.1`（`SUPPORTED_DSH_CONTRACT`）；本机开发可对齐 `0.1.6-alpha.1`，**不因此抬钉** |
| 本机 Web profile | `~/.dsh/profiles/web`（开发可用 `link:` / tgz） |
| Desktop 产品安装 | 仅 registry `dsh-vision-bench@<exact>`；`link:` / 本地 tgz 不算产品验收 |
| Vision 加载路径（开发） | `link:/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench` |
| 支持契约 | `SUPPORTED_DSH_CONTRACT = 0.1.5-rc.1` |
| 默认 bundle | 仅 `dsh-vision-bench`。`dsh-vision-harness` 不进入默认安装 |

## 产品拆分

- 宿主：`host.js`，`name: dsh-vision-bench`，顶层 inject **仅** `connection`；UI 走 `POST /api/vision-bench/dispatch`
- Web 兼容：可选 `inject(['webServer'])` 挂旧 `/vision-bench` RPC + Agent HTTP 命令桥（Desktop 不挂）
- Agent：`tools.js`，export `./agent`，`name: dsh-vision-bench-tools`；缺 Host → `HOST_UNAVAILABLE`（不猜 `:3080`）
- 预设：`$DSH_HOME/.agent-presets/vision-bench`，工具行 `dsh-vision-bench/agent`，persona 用 `prefix`
- Desktop 能力：UI / TCP / 仿真可宣称；**完整 RTU native** 待 `serialport` 进入官方 `allowBuilds` 或可选 RTU 包

## 复现动作（隔离 `DSH_HOME`）

使用仿真数据，不接真实硬件。脚本：`scripts/isolated-compat-repro.mjs`。自动化聚合：`node scripts/probes/check-stage5-acceptance.mjs`。

1. 全新 home：从 shipped `standard` 复制并 overlay，官方 Config 通过
2. 旧预设：`text` + 宿主工具行 → 迁移后 Config 通过，二次迁移零变化
3. 健康检查：YAML 能解析但缺 `prefix` 时 `ok: false`
4. 冲突人设：同时存在不同的 `text`/`prefix` 时保留 prefix 并报告

桌面进程级 CPU/内存/Worker 观察仍须在真实 Desktop 上按「打开旧会话、新建、切预设、Debug、上位机、监控、关闭再进」跑 10–15 分钟（**Web XOR Desktop**，勿共用同一真实 `DSH_HOME`）。停止操作后应回到基线附近，不要求 CPU 为 0%。
