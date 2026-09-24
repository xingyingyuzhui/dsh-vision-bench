# Vision / DSH 兼容基线（0.29.28）

记录日期：2026-09-23（自 0.29.0 / 2026-09-19 基线修订。契约钉依据静态契约核对 + lab 安装；Desktop 复验待做（见 011 §7））。后续每步验收对照本文件，不把空闲低 CPU 单独当成修复成功。跨平台矩阵见 [`ACCEPTANCE_NATIVE_WEB_DESKTOP.md`](./ACCEPTANCE_NATIVE_WEB_DESKTOP.md)。

## 安装与加载

| 项 | 值 |
|---|---|
| DSH CLI（契约钉） | `@deepseek-ai/dsh@0.1.7-alpha.2`（`SUPPORTED_DSH_CONTRACT`；静态契约核对 + lab 安装；Desktop 复验待做（见 011 §7））；`0.1.5-rc.1`–`0.1.6` 走旧目录契约仍受支持 |
| 本机 Web profile | `~/.dsh/profiles/web`（开发可用 `link:` / tgz） |
| Desktop 产品安装 | 仅 registry `dsh-vision-bench@<exact>`；`link:` / 本地 tgz 不算产品验收 |
| Vision 加载路径（开发） | `link:/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench` |
| 支持契约 | `SUPPORTED_DSH_CONTRACT = 0.1.7-alpha.2`（预设双轨：≤0.1.6 目录式，0.1.7+ 声明式） |
| 默认 bundle | 仅 `dsh-vision-bench`。`dsh-vision-harness` 不进入默认安装 |

## 产品拆分

- 宿主：`host.js`，`name: dsh-vision-bench`，顶层 inject **仅** `connection`；UI 走 `POST /api/vision-bench/dispatch`
- Web 兼容：可选 `inject(['webServer'])` 挂旧 `/vision-bench` RPC + Agent HTTP 命令桥（Desktop 不挂）
- Agent：`tools.js`，export `./agent`，`name: dsh-vision-bench-tools`；缺 Host → `HOST_UNAVAILABLE`（不猜 `:3080`）
- 预设（双轨）：0.1.7+ 由宿主经 `agentPresets.register()` 注册声明 `{ id: vision-bench, name: Vision模式, plugins: standard 快照 + dsh-vision-bench/agent }`；≤0.1.6 写 `$DSH_HOME/.agent-presets/vision-bench`（工具行 `dsh-vision-bench/agent`，persona 用 `prefix`）
- Desktop 能力：UI / TCP / 仿真可宣称；**完整 RTU native** 待 `serialport` 进入官方 `allowBuilds` 或可选 RTU 包

## Agent HTTP 命令桥（D-1）

命令桥等同用户权限，不另走人工批准。`src/interfaces/http/vision-command-routes.mjs` 的 `source` / `confirm` 语义不改：经桥进入的命令与用户侧命令同一权限。

- **仅 Web 模式。** 桥挂在 `inject(['webServer'])` 的 Web 兼容层（`POST /dsh-vision-bench/command`）。Desktop Host 顶层只有 `connection`，不挂这条桥。
- **凭密钥访问。** 请求须带 `x-dsh-vision-capability`，与 Host 签发的密钥一致，并限制 loopback。
- **密钥留在进程环境（D-1，保持现状）。** 密钥放在 `process.env.VISION_BENCH_CAPABILITY`（`host.js` 签发）。Keil、OpenOCD、GDB 子进程在信任边界内，可以继承该环境变量。

## Agent 预设契约（0.1.7 声明式）

DSH 0.1.7 起目录式预设（`$DSH_HOME/.agent-presets/<id>/`）**不再被读取**，预设是 Cordis 组合里的 `@deepseek-ai/dsh-agent-preset` 声明（registry 服务 `agentPresets`，公开 API `register(definition)`）。要点：

- **自包含**：registry 的 `list()/resolve()` 只回展示元数据，`agentPresets.copy` 已移除 → 声明必须重述完整子插件清单。清单由 `scripts/gen-standard-preset-snapshot.mjs` 从钉住 tag 的 `packages/bundle/web-app/presets/standard.patch.yml` 生成（`--check` 作漂移门）；`!!js process.platform` 行在注册时以纯布尔落地。
- **能力探测**：`agentPresets.register` 存在且无 `copy` → 声明式；否则沿用目录 seed，零回归。
- **迁移**：声明通过 roster 校验（`list()` 行无 `broken`）后，旧目录整体改名备份到 `$DSH_HOME/.agent-presets/.vision-bench.backup.<ISO>`；归属标记（`.dsh-vision-bench`）缺失或外来目录**不动**。激活失败时保留旧目录作为恢复数据。
- **同 id**：`vision-bench` 与旧会话记录的预设身份一致；id 被外部声明占用时让位（`external-declaration`），不抢占。
- **健康检查**：Settings → Vision 的 `presetHealth` 在声明式下报 `via` / roster 诊断 / 迁移警告，`nextStep` 给声明重建指引。

## 复现动作（隔离 `DSH_HOME`）

使用仿真数据，不接真实硬件。脚本：`scripts/isolated-compat-repro.mjs`。自动化聚合：`node scripts/probes/check-stage5-acceptance.mjs`。

1. 全新 home：从 shipped `standard` 复制并 overlay，官方 Config 通过
2. 旧预设：`text` + 宿主工具行 → 迁移后 Config 通过，二次迁移零变化
3. 健康检查：YAML 能解析但缺 `prefix` 时 `ok: false`
4. 冲突人设：同时存在不同的 `text`/`prefix` 时保留 prefix 并报告

桌面进程级 CPU/内存/Worker 观察仍须在真实 Desktop 上按「打开旧会话、新建、切预设、Debug、上位机、监控、关闭再进」跑 10–15 分钟（**Web XOR Desktop**，勿共用同一真实 `DSH_HOME`）。停止操作后应回到基线附近，不要求 CPU 为 0%。
