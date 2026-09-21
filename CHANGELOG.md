# Changelog

## 0.29.24

- 折线图在点位断连/失败后不再用墙钟空点把 X 轴往右拉；轴停在最后一条有效样本。

## 0.29.23

- 串口报文列表从上到下按时间从新到旧；自动滚动跟随顶部新报文。

## 0.29.22

- 协议报文筛选行用「过滤关键字」输入框撑满剩余宽度，重置与上方导出按钮右对齐。

## 0.29.21

- 告警详情去掉「确认表示已知悉，不代表故障恢复。」说明。

## 0.29.20

- 告警页筛选栏与列表之间不再显示确认/复制等通知条。

## 0.29.19

- 操作记录每页最多 50 条，按时间从新到旧。

## 0.29.18

- 操作详情去掉底部「添加到 Agent 输入」和说明，右上角复制改为 AI。

## 0.29.17

- 设置页去掉「页面导航」下的两行说明。

## 0.29.16

- 「重试连接」改为「重试」。
- 运行调试源码预览去掉外层滚动条，只留编辑器一条。
- 「＋连接」留在全部连接页并打开下方连接编辑框。
- 仿真轮询写入串口报文（SIM TX/RX）。

## 0.29.15

- 全部连接：连接为蓝色、断开为红色；端点列用绿灯/红灯表示状态。
- 报文详情：去掉「AI 辅助分析」和顶栏复制，改为右上角 AI；筛选栏「重置」不再被挤成竖排。

## 0.29.14

- 全部连接表操作列：连接/断开合成一个按钮；去掉已连接的禁用按钮。

## 0.29.13

- 报文详情 HEX / Text 框内文字与「复制」按钮垂直居中。

## 0.29.12

- 串口报文筛选下拉从 140px 收到 112px，与告警/操作记录工具条对齐。

## 0.29.11

- 可视化卡片三点菜单按内容收窄（不再固定 218px 宽），右对齐 ⋯ 按钮。

## 0.29.10

- 可视化卡片右上角三个按钮收成 DSH 风格三点菜单（AI / 编辑 / 删除）。数值卡去掉组件内标题和「更新于」时间。Client 体积上限 1 675 000 bytes。

## 0.29.9

- 可视化组件操作栏「让 Agent 分析」改为与上位机点位相同的紧凑 **AI** 按钮。

## 0.29.8

- 折线图数据点改为实心圆（ECharts `symbol: 'circle'`，uPlot 点填充与线同色），不再用默认空心 `emptyCircle`。

## 0.29.7

- 折线图 Y 轴上限对齐 1/2/5×10ⁿ 刻度，不再把 `峰值×1.08` 的原始浮点（如 6.6464）画成轴顶标签。Client 体积上限 1 672 000 bytes。

## 0.29.6

- 编辑组件卡片边框不再只依赖 `--dvb-bdr` 继承：`border` 带字面 fallback，挂到 `document.body` 后类型卡 / 配置卡 / 预览 / 筛选胶囊仍有线框。

## 0.29.5

- 编辑组件弹窗挂到 `document.body` 后仍继承 `--dvb-bdr`，类型卡 / 配置卡 / 预览 / 筛选胶囊线框不再消失。

## 0.29.4

- 编辑组件弹窗挂到 `document.body`，不再被会话区 `container-type` 和底部输入框（z-index 7）盖住。Keil 工程选择器同样处理。

## 0.29.3

- 折线图时间轴在窗口未填满时从第一条样本起算（从左往右长），不再把十几秒数据拉满整轴、把最新点贴在右边缘裁掉。关闭「自动滚动」会钉在起点窗口。Y 轴自动范围给峰值留出余量。

## 0.29.2

- 监控二级 tab 切走再回来时，可视化页保持挂载（`visibility` 隐藏，不用 `display:none`），折线图不再按 140px 占位高度重算 Y 轴。
- 图表等到容器有真实宽高再 `init`；ECharts 与 uPlot 都跟 ResizeObserver。GridStack 关闭 one-column 折叠。

## 0.29.1

- 监控/调试二级 tab 在渲染时再取文案，避免 Host 中文偏好落地前被浏览器临时英文冻结成 Charts / Alarms / Serial Frames / Operation Log。
- Client 体积上限随 locale tick 调至 1 667 000 bytes。

## 0.29.0

结构与测试重构收口（计划 P0–P6）：

- `src/**` 禁止导入根目录 `bench-*`（dependency-cruiser 四条 error）；门面仅保留 ≤80 行 re-export。
- 生产大文件按职责拆分；structure-budget allowlist 清空。
- 测试按领域目录重组，结构/源码断言/包闭包进 `npm run quality`。
- 补齐 ADR-019～023（debug/写点会话所有权、告警模型、verify 真实性、Windows 验收边界）；ADR-024 标 Completed。
- Client 体积上限随模块边界税上调至 1 665 000 bytes。

## 0.28.7

- 修复 `normalizeCwd` 相对路径单测：用 `path.isAbsolute`，不再假设 POSIX `/` 前缀（Windows CI 绿）。

## 0.28.6

- 删掉一批源码/CSS 字符串锁和重复 import 检查；行为测和写点/I/O/preset 保险丝保留。

## 0.28.5

- 工程结构页拆成 `use-project-session`（会话/地图/预览）和 `project-toolbar`，workspace 只拼布局。

## 0.28.4

- 合并 8 个单测 debug 文件到主题文件（批准、RPC、事件游标、探针租约）。工程结构图与运行时图共用同一套 fit/zoom 相机 hook。

## 0.28.3

- TemperatureDemo 源码/工程树/调用图/调试会话收到 `src/ui/debug/fixtures/`，工程结构和运行调试页不再内嵌同一份 demo。

## 0.28.2

- Client 第一刀：空间/圆角/描边 token，`Panel`/`Tabs`/`Hint` 原语，运行调试面板改走共用壳。UI 引用 `bench-*` 门面改为 cruiser warn（ADR-024）。

## 0.28.1

- 工程结构树形页：修复 `PROJECT_CSS` 未插值 `data-dsh-vision-bench`，左右栏卡片框丢失。右侧「示例源码 / 文件符号」补上独立卡片框；去掉树下「当前文件」卡片。树形/图谱切换去掉外围框线和工具栏底部分割线，并收紧工具栏上下间距。源码预览标题与函数/跳转收成一行，去掉复制/搜索按钮和标题栏底部分割线，并收紧标题栏与源码卡片之间的间距。去掉「示例源码」「文件符号」左侧箭头。图谱页去掉底部图例、统计和操作提示。缩放条贴在画布右下角，层级锁在图谱内，不再盖住会话输入框。函数详情：标题栏关闭按钮回到右侧，源码片段用真实行号而不再写死 ReadTemperature；调用图谱默认打开焦点函数详情。图谱画布铺满容器、绕视口中心缩放，不再在选中节点或 Resize 时把相机打回 35%。点击函数节点打开详情卡片，不再被画布拖拽吃掉。函数详情把名称、文件和行号收成一行。去掉树形源码预览底栏状态行。图谱工具栏只保留「适应画布」。运行调试页按理想稿对齐：会话条、已暂停状态、源码执行行/断点槽、两条 demo 断点、可折叠事件表。去掉运行调试页顶部会话条（目标名和 GDB/OpenOCD）。

## 0.28.0

Requires DSH `0.1.5-rc.1`. Repair release: native DSH contract, upgrade migration, no long-term framework patches.

- Preset overlay migrates `text → prefix` and the tool row to `dsh-vision-bench/agent`, validates with official `dsh-persona` Config, and copies shipped `standard` on first install.
- Settings preset health uses the same schema/tool-row contract, not YAML parse alone.
- Host stays `connection` + `webServer`. Agent is `./agent` (`dsh-vision-bench-tools`) with required `tools` + `systemPrompt`.
- Default bundle no longer inserts `standing-guard` / `scan-guard`. Those remain an optional sibling `dsh-vision-harness` with an explicit DSH version pin, not a production dependency.
- Debug page still does one state query; event wait parks for Agent-started sessions instead of 1 Hz polling.
- Debug wait/wake require owner session id and workspace cwd. Watch values survive pause/step. Host dispose waits for the same RPC unregister promise. Preset health uses official `dsh-persona` Config.

## 0.27.2

Requires DSH `0.1.5-rc.1`. Preset compatibility and standing-mount isolation.

- Migrate Vision persona `config.text` → `config.prefix` and rewrite the managed tool row to `dsh-vision-bench/agent` (no leftover `role`). Overlay validates with the official `dsh-persona` Config before write.
- First install copies the shipped `standard` preset when `agentPresets.copy` is unavailable, then overlays and validates. Failures are not swallowed as success.
- Failed standing mounts are cached by composition digest: deterministic schema errors remount once per generation; transient errors back off; explicit retry and file changes remount.
- Host RPC registration that resolves after dispose still runs the disposer. Shared debug runtime dispose is identity-checked. Agent guidance is a required `systemPrompt` effect and no longer imports the YAML migrator.
- Debug page keeps one state query, parks on `waitEvents` while idle, and wakes when Agent starts a session. Scan flush snapshots the plugin tree once per dirty batch.

## 0.27.0

Requires DSH 0.1.2-alpha.3. Install from an `npm pack` tarball.

Major stabilization, debug runtime hardening, and verification release (PR-A through PR-F):

- **Debug Runtime Authority & Event Contract (PR-A)**:
  - `DebugRuntime` is now the single authoritative state reducer for embedded debugging.
  - Replaced ad-hoc backend state mutations with strict `DebugBackendEvent` contracts (`backend.running`, `backend.stopped`, `backend.console`, `backend.exited`, `backend.error`).
  - True asynchronous pause and stepping semantics: step/pause actions await genuine native target stop events before reporting completion, eliminating fake synchronous stepping.
  - Canonical event naming shared between Host and UI via `src/shared/debug-events.mjs` (`DEBUG_EVENT_TYPES`), eliminating unverified string checks.
- **Host Launch Spec & Session Ownership (PR-B)**:
  - Host resolves immutable `ResolvedDebugLaunchSpec` based on workspace, Keil target, build artifact hash, OpenOCD profile, and probe serial. Agent parameters simplified to `{ action: "start" }`.
  - Removed insecure boolean `payload.approved = true`; debug startup enforces expirable `approvalRequestId` tickets tied to artifact sha256. Stale tickets are rejected with `APPROVAL_STALE`.
  - Target lease identity hardened to physical probe identity (`probeSerial`) rather than workspace directory.
  - Replaced fixed GDB port 3333 with dynamic loopback port allocation (`allocateLoopbackPort`).
- **Windows + STM32 Hardware Smoke Fixture (PR-C)**:
  - Added dedicated minimal STM32 test fixture in `fixtures/stm32-debug-smoke/` (`main.c`, `system_stm32.c`, `openocd.cfg`, `stm32_smoke.axf`).
  - Added formal Windows acceptance checklist template in `docs/WINDOWS_ACCEPTANCE_0.27.md`.
- **Keil UVSC Binary Protocol & Simulator Rewrite (PR-D)**:
  - Replaced legacy mock JSON protocol with genuine 16-byte fixed-header UVSC binary framing (`0x43535655`).
  - Added managed background `UV4DebugProcess` capable of dynamically spawning UV4 without user GUI interaction.
  - Implemented request-response matching and asynchronous event routing (`UV_DBG_CALLBACK`, `UV_ASYNC_MSG`, `UV_DBG_CMD_OUTPUT`).
- **ProgramModel AST & Archify Boundary Decoupling (PR-E)**:
  - Introduced Lezer/Tree-sitter C AST source analyzer (`tree-sitter-c-analyzer.mjs`) with `confidence: 'ast'`.
  - Demoted regex analyzer to heuristic analyzer (`heuristic-c-source-analyzer.mjs`) with `confidence: 'heuristic'`.
  - Decoupled graph traversal algorithms (`findUpstream`, `findDownstream`, `findCausalPath`) into `src/domain/program/graph-analysis.mjs`.
  - Added `runtime-correlation-service.mjs` to map runtime execution locations to ProgramModel function nodes, callers, callees, variable dependencies, and nearest conditions.
- **Verify Productization & Live Telemetry (PR-F)**:
  - Added `TelemetryReader` abstraction reading from live value stores rather than static workspace layout.
  - Removed 2-second hardcoded clamp on `stable-for-duration`; supports dynamic sampling and unconstrained durations bounded by scenario timeouts.
  - Added cancellation support via AbortSignal and distinguished result statuses (`pass`, `fail`, `error`, `timeout`, `cancelled`).
  - Enriched evidence binding firmware hash, artifact sha256, debug session ID, target identity, and telemetry sample series.
  - Exposed `verify` action directly in `vision_debug` agent tool and RPC handler.
  - Added architectural decision records: ADR-016, ADR-017, ADR-018.


Requires DSH 0.1.2-alpha.3. Install from an `npm pack` tarball.

Security and integration fixes (no new product features):

- Browser business operations use authenticated `connection.rpc` on `/vision-bench`; loopback Origin no longer substitutes for capability on the Agent HTTP bridge (`POST /dsh-vision-bench/command` only).
- Agent focus requests are preserved when Vision pages are not mounted; `viewRequest` is not dropped while workspace cwd is still loading.
- Project workspace state is isolated by session, cwd, Keil project, and target; stale map/file responses are rejected.
- Project graph layout, truncation hints, keyboard navigation, and `/` search shortcut guards are corrected.
- `npm run test:full` and `npm run pack:check` pass.

Windows serial / Modbus / OpenOCD device-chain acceptance remains **not** signed off. See `docs/archive/WINDOWS_ACCEPTANCE_0.26.md`.

## 0.26.0

Requires DSH 0.1.2-alpha.3. Install from an `npm pack` tarball. This is an integration migration, not a visualization schema change.

Breaking Harness integration:

- Session workspace path comes from `useWorkspaces` items by `sessionId`. `useSessions` is gone.
- Cross-tab navigation uses `openView` + `dvb1:` focus tokens and `viewRequest`. `slots.select` is gone.
- Client inject is `slots` + `locale` + `connection` (authenticated RPC).
- Plugin notices include a `randomUUID` `id` and the alpha.3 `source` contract.
- Browser Host calls no longer use a static `X-DSH-Vision-Bench` header. Loopback Origin is required; Agent HTTP uses a process-lifetime capability. Official Typert Remote is not available to this thin-JS plugin (ADR-012).
- Vision preset changes apply to **new sessions**. Open sessions keep their generation.

Windows serial / Modbus / OpenOCD device-chain acceptance is **not** signed off. See `docs/archive/WINDOWS_ACCEPTANCE_0.26.md`.

Profile risk (not Vision bugs): `dsh-excel-panel` 0.6.1 and `@omdsh-dev/dsh-genui` 0.8.4 may still fail on alpha.3. Isolation Profile + Vision tarball is the compatibility evidence.
