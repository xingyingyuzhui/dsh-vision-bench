# Vision 原生接入 DSH Web / Desktop：分阶段迁移计划

> 状态：阶段 0 实施中（2026-09-17）。核对日期：2026-09-17。Vision 源码基线：`dsh-vision-bench@0.29.0`；DSH 目标基线：`dsh-v0.1.6-alpha.1`（本机 `dsh --version`）。§8 实施默认已填；每次 DSH 升级都要重新跑本文的契约门禁。

## 执行口径（2026-09-17）

本轮先交付 **M1：官方 Desktop 无端口 UI + Agent 同 Host 调用 + TCP/仿真**；Windows 真串口/RTU、Keil/OpenOCD 真机验收列为 **M2 硬件验收**。M1 不能称“完整硬件兼容”，下方的“完成定义”是 M1+M2 的最终目标。此前“真机先不搞”的约束在本轮仍有效。

| 决策 | 执行口径 |
| --- | --- |
| B0：Desktop 基线 | 本机运行的是 `/Users/qin/DSH/deepseek-harness-desktop-official/release/DeepSeek Harness.app`，应用版本 `0.1.6-alpha.1`，源仓当前 commit `0d1f500` 且本地打包文件有修改；它是**未签名的本地构建**，`LOCAL_BUILD.md` 说明绕过了 native payload smoke。可用于阶段 0 探针，不能代表未改动的官方发布物最终验收。`/Applications/DSH Desktop.app` 是另一份 `2.0.0` 应用，内嵌 DSH `0.1.0-rc.6`，不得混用为本轮官方样本。最终发布验收须使用可追溯的官方 Desktop 构建/发行包并记录源码与运行时指纹。 |
| 探针失败策略 | B1/B2 失败就暂停依赖它的 Desktop 迁移阶段，保留 Web 当前可用版本；记录复现并寻求上游公开接口/修复。允许 Web 独立维护，不做“Desktop 通过 Web 端口临时桥接”的双轨产品方案。 |
| Web Agent 桥 | 保留为 **Web 专用、显式启用**的兼容适配器，直至 B2 证明不再需要；本轮先删除默认 `127.0.0.1:3080` 猜测。Desktop 不加载桥。 |
| 旧 RPC 兼容期 | 按当前 `0.29.0` 版本线，目标是 `0.30.0` 同时提供新入口与 Web 旧 RPC、`0.31.0` 移除旧 RPC。若治理先占用 `0.30.0`，迁移版和移除版各顺延一个 minor；移除还以已验证无旧客户端调用为门禁。旧 RPC 必须位于 Web 专用薄适配器，否则同一 Host 仍会要求 `webServer`，Desktop 无法启动。 |
| 新入口形状 | 阶段 1 先用一个 `/api/vision-bench/dispatch` 精确 Fetch 路由 + endpoint 白名单；只有实测出流式/体积限制才拆专用路径。 |
| DSH 契约版本 | 先实测再改 `SUPPORTED_DSH_CONTRACT`；不得仅因本机 CLI 是 `0.1.6-alpha.1` 就把常量改为 `0.1.6-alpha.1+`。记录实测最低支持版本与构建指纹。 |
| Desktop 安装 | 产品验收只认 Desktop 管理器可安装的 registry `name@version` 精确版本；本地 `tgz`/`link` 只算开发、探针及打包检查证据。 |
| 与治理工作的顺序 | **并行，但隔离代码。** 当前 bench 位于 `feat/governance-p0-p5`，比 `main` 多 13 个提交；阶段 0 探针放单独工作树/迁移分支，不夹进治理提交。P4/P6/P7 可继续；阶段 1 触及 `host.js`/Client 的实质改动待治理接口稳定后从最新基线接续。 |
| 探针位置 | bench 内 `scripts/probes/desktop-connection/`，作为可复现的开发探针，不进生产包 `files`。阶段 0 先在桌面 DevTools 看 `location.origin` 与一次相对路径请求，再做可重复脚本/测试。官方源码应用页是 `dsh-app://app/index.html`，相对 `/api/...` 应解析到 `dsh-app://app/api/...`，仍以运行时实测为准。 |
| 安全与取消 | Web 的认证、Host/Origin 拦截交给 Connection；Vision 负责 endpoint 白名单、schema、业务授权，不再叠第二套 Cookie/Origin 认证。`debug/events/wait` 取消到达 `request.signal` 是阶段 1 必过回归，不延到阶段 4。 |
| 测试重排 | 阶段 2 允许单独提交 `runVisionBench()` 测试 fixture 迁移，按场景分批，保留审批/错误码断言；不把大量机械测试修改混入生产分发器改动。 |

## 1. 目标与完成定义

Vision 在官方 DSH Web 和 Desktop 中使用同一套业务服务、数据模型、权限及设备操作规则。浏览器和桌面渲染进程只通过 DSH Connection 提供的载体访问 Host；Desktop 不要求 `webServer`、端口或本地 HTTP 服务。Agent 工具仍由独立的 `dsh-vision-bench-tools` fiber 提供，所有持久化、调试状态和硬件 I/O 由唯一 Host 拥有。安装、更新、预设迁移和异常恢复都要按官方 Desktop 的实际边界验证。

“完成”须同时满足：

1. 同一发布版本能在隔离的 Web 与官方 Desktop profile 安装、激活、使用、卸载和重装；没有私有 DSH 方法、内部补丁或源码相对路径依赖。
2. Web 与 Desktop 的 UI、Agent 工具进入同一 Host 拥有的应用服务与状态；Agent 不会在 Host 缺席时自行写盘或打开设备。现有 UI Router 和 Agent 命令 Dispatcher 可保留不同入口，不强行合并成一个函数。
3. Desktop 不监听 Vision 端口；Web 的任何外部进程桥接都明确限于 Web，且保留已有的鉴权、超时与错误码约束。
4. 无硬件和有硬件的验收分开记录。M1 只承诺 UI、Agent Host 路径与 TCP/仿真；必须实际验证 Windows 串口/Modbus RTU 才能完成 M2 并宣称 Windows 硬件兼容，模拟器通过不能代替它。
5. 插件激活、切换会话、Debug 空闲、关闭及重启后，CPU 和内存能回到测得的基线附近，无持续重载、重复注册、无限重试或日志风暴。

## 2. 当前事实与真正的缺口

| 边界 | 当前实现 | 迁移含义 |
| --- | --- | --- |
| 前端业务调用 | [`src/ui/client/client-entry.mjs`](../../src/ui/client/client-entry.mjs) 使用 `ctx.connection.rpc.call`；路径映射在 `src/shared/vision-rpc-contract.mjs` | UI 已经通过 Connection，不需要重写页面或全套业务请求。只需调整传输适配层及其契约。 |
| Host | [`host.js`](../../host.js) 注入 `connection`、`webServer`；注册 `/vision-bench` RPC，并额外挂一个 `/dsh-vision-bench/command` HTTP 路由 | Desktop 没有 `webServer`，Host 目前无法原样启动。 |
| Agent | [`tools.js`](../../tools.js) 是独立 loader 名称和 `/agent` 入口，仅注入 `tools`、`systemPrompt` | 角色拆分已经完成；重点验证跨 fiber 能否稳定拿到 Host，而不是再拆一个同功能包。 |
| Agent→Host | [`vision-host-client.mjs`](../../src/infrastructure/host/vision-host-client.mjs) 先试进程内句柄；未设置 `requireHost` 时可直接调用 `executeHostCommand`；否则使用 HTTP 回退。正式 `vision_bench`、`vision_debug` 工具均传 `requireHost: true` | 正式工具目前不会走本地执行分支；但通用入口的隐式执行仍可能被其他调用者误用，且 Desktop 无端口，HTTP 回退不能作为通用方案。按调用点收紧，不应误称当前 Agent 已双重写入。 |
| 预设与契约 | 现有 `prefix` + `/agent` 迁移已完成；`SUPPORTED_DSH_CONTRACT` 仍写 `0.1.5-rc.1` | 先更新验证矩阵，再决定最低支持版本；不要只改版本常量。 |
| 设备依赖 | `serialport@13.0.0` 和 `modbus-serial@8.0.25` 属于发布依赖 | 官方 Desktop 对 native build 有 allowlist；串口能力是否能安装和运行是独立发布门禁。 |

现有 [ADR-004](../architecture/ADR-004-agent-host-state-ownership.md) 已确定 Host 独占状态与 I/O；[ADR-012](../architecture/ADR-012-remote-transport.md) 已确定浏览器业务走 Connection RPC，单个 HTTP 路由只服务进程外 Agent。迁移应延续这些约束，而不是重建第二套业务逻辑。

### 当前 DSH 的关键实现差异

在 `dsh-v0.1.6-alpha.1`，官方 Desktop [README](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.6-alpha.1/apps/desktop/README.md) 明确说明：Desktop 无监听端口，`dsh-app://` 与字节管道承载请求，Desktop profile 独立于 Web profile。`connection` 的 [Host 实现](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.6-alpha.1/packages/client/connection/src/rpc-host.ts) 有两个不同的注册路径：

- `rpc.handle(channel, handler)` 在当前源码中通过调用方 context 的 `owner.webServer.register(...)` 安装独立路由。它**不是**当前版本下可直接用于无 `webServer` Desktop 的通道。Vision 的 `ctx.connection.register(ctx, ...)` 分支还调用了公开类型中不存在的方法，应作为私有 API 风险移除。
- `fetch.register({ path, methods, requestBody, fetch })` 只把精确路径加入 Connection 自己的注册表。Web 的 `/api` 和 [Desktop Host 的 `/api` 分发](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.6-alpha.1/apps/desktop-host/src/index.ts) 都会进入同一注册表；这是本轮首先验证的候选公共接口。它接收标准 Fetch `Request`，由 Vision 自己验证 JSON 并返回 `Response`。

这意味着“把 `inject` 改成 `['connection']`”并不是修复。迁移入口要先做小型双载体实证，确认 `fetch.register`、相对 `/api/...` 请求和卸载语义在目标 Desktop 发行版里确实工作。以上结论来自当前源码，未来官方修复 `rpc.handle` 后可以重新评估。

## 3. 架构选择与取舍

| 选项 | 方式 | 优点 | 成本 / 风险 | 结论 |
| --- | --- | --- | --- | --- |
| A：Connection 共享 `/api` 精确 Fetch 路由 | Host 只注入 `connection`；Vision 的一个业务入口挂在 `/api/vision-bench/...`；Client 的 `post()` 适配器改为同源相对路径 Fetch。Agent 优先进程内 Host 句柄 | 符合当前 Web 与 Desktop 的共同载体；不占独立端口；业务层不动；不依赖私有 `register` | 需要调整传输适配层；须验证鉴权、取消、体积限制和错误信封；进程外 Agent 另需合法桥接 | **推荐作为目标方案**，以第 0 阶段实证为准。 |
| B：等待官方 `rpc.handle` 成为真正的跨载体入口 | 保留 Client 现有 RPC 映射，等待官方修复或增加 Desktop 注册支持 | Client 改动较少；可沿用 RPC 信封 | 当前版本 Host 在 Desktop 仍会碰 `webServer`；发布时间不可控 | 作为后续简化机会，不阻塞方案 A 的验证。 |
| C：Web 与 Desktop 各写一套 Host | Web 保留 `webServer`，Desktop 再建专用路由/IPC Host | 短期可做定制兼容 | 双套生命周期和错误处理容易漂移；回到曾经的重复状态问题 | 不采用。只允许极薄的、可删除的载体适配层。 |

需要保持的依赖方向：`domain/application` 不导入 DSH、Electron、HTTP 或 Cordis；`interfaces` 把 UI 请求交给现有 RPC Router、把 Agent 请求交给现有命令 Dispatcher；二者共用 Host 拥有的应用服务与状态。`infrastructure` 负责 Connection、进程内句柄和可选 Web 桥接。设备操作、审批、`expectedConfigVersion` 与错误码仍留在现有 Host 应用层。

## 4. 执行阶段与门禁

### 阶段 0：冻结基线、做最小实证（先于功能改动）

**工作**

1. 记录官方发行版标识、macOS/Windows 平台和架构、Node ABI、Vision commit、实际加载路径、Web/Desktop profile 内已启用插件及 DSH_HOME。保留现有 `0.29.0` 可回退包。
2. 在隔离 `DSH_HOME` 下建最小插件探针，不接硬件：A 仅注入 `connection` 并注册 `/api/vision-probe` 精确 Fetch 路由；B 复现当前 `rpc.handle('/vision-probe', ...)`；C 验证顶层只注入 `connection`、但在可选 `ctx.inject(['webServer'], webCtx => ...)` 内注册旧 Web 路由。Web 与官方 Desktop 各测注册、认证、调用、重复激活、卸载后 404、重启；C 在 Desktop 应保持不激活而不阻塞 Host。
3. 查 Agent tool fiber 是否与 Host 共用同一 Node 模块实例：工具调用先做 `system.ping`，记录 PID、fiber 名称、实际调度途径；分别测旧会话、新会话和预设切换。不能只凭“同进程”推断模块单例一定共享。
4. 确认 Desktop 的插件管理器是否能安装候选产物以及串口依赖是否进入 pending build。当前 [安装实现](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.6-alpha.1/apps/desktop/src/project-manager.ts) 只接受 npm registry 规范，拒绝 `file:`、URL 和 link；`npm pack` 用于检查包，不等于桌面 GUI 可安装。

**退出门禁**：有 Web/Desktop 的原始测试记录、预期与实测对照、失败日志和决策。若精确 Fetch 路由在 Desktop 不能工作，停止后续迁移，向上游确认可支持的公开扩展点；不要转向修改 Desktop 私有管道。

### 阶段 1：把 UI 传输适配到共享 Connection 路由

**工作**

1. 在 Host 建一个 `/api/vision-bench/...` 精确路由注册模块，外层只做请求大小、方法、JSON/schema、超时/取消和错误信封处理；内部继续调用现有 `createVisionRpcRouter`/应用服务。根据端点数量选择少量稳定的精确路径或一个带 `endpoint` 字段的入口，不能把任意路径当命令执行。
2. 改 `src/ui/client/client-entry.mjs` 后方的网络适配器；保持页面使用的 `post(path, payload, timeoutMs)` 接口、返回形状和 `AbortSignal` 语义。浏览器与 `dsh-app://` 页面都用相对 `/api/...` 路径，不拼 `localhost:3080`。
3. `fetch.register` 在 DSH 当前实现里已经通过调用方的 `owner.effect` 归属 Host fiber；实测其异步 disposer 与卸载先后顺序，必要时只加一次性清理保护，避免叠加第二套重复 dispose。统一响应契约沿用现有业务错误码，传输错误与业务失败分开表示；保留 request/command ID 便于关联日志。避免复刻 DSH 私有 RPC 编解码器。
4. 验证 Web 的浏览器认证、Host/Origin 防护与 Desktop 的协议调度确实先于 Vision 处理；Vision 不以 UI 传入的 `source`、`cwd` 或 `sessionId` 作为身份凭证。测试未登录 Web 401、非法来源 403、无效 JSON 400/415、取消、超时、超大载荷及并发写入。
5. 删除 `ctx.connection.register(ctx, ...)` 私有方法分支。迁移期旧 `/vision-bench` RPC 应移入 Web-only 薄适配器，优先验证 Host 内可选 `ctx.inject(['webServer'], webCtx => ...)` 是否能让其只在 Web 载体注册；若 Cordis 生命周期不支持，再用明确的 Web profile row。Host 顶层始终只要求 `connection`。旧路由移除目标与门禁见“执行口径”，新旧路由共用同一 Router 并做一致性测试。

**退出门禁**：同一 UI 构建产物在 Web 和 Desktop 完成设置页、点表、监控、Debug、人工审批、文件/图像相关操作；两边请求落到同一 Host RPC Router 和应用服务。无旧路由调用残留和越权绕过。

### 阶段 2：收紧 Agent→Host，守住唯一写入者

**工作**

1. 枚举 `dispatchHostCommand` 的每个调用点，标记纯查询、配置变更、硬件写入、调试操作。正式 `vision_bench.execute()` 和 `vision_debug.execute()` 已传 `requireHost: true`，先保留这一事实的回归测试；再删掉通用入口中“Host 句柄不存在就本地 `executeHostCommand`”的隐式回退。现有 `runVisionBench()` 测试辅助入口依赖此分支，应改成显式 Host fixture 或下沉到应用服务测试，而不是通过生产分发器偷偷执行。Host 缺席返回 `HOST_UNAVAILABLE`，不得打开另一个 I/O Worker 或写工作区。
2. 保留同进程 Host 句柄作为首选路径，给句柄加实例/epoch 身份和卸载失效约束；Agent 侧只做参数归一化和结果转换。跨 fiber 加载必须实测。若 Agent 被 DSH 放入隔离进程且没有公开 Host 调用能力，把这一点列为官方 API 阻塞项，不能把 Desktop 请求硬指向 Web 端口。尤其要删除 `hostOriginOf()` 中无配置时自动猜测 `http://127.0.0.1:3080` 的行为，避免 Desktop 的 Agent 意外打到同时运行的 Web Host。
3. 对确实需要进程外 Agent 的 Web 场景，把当前 `/dsh-vision-bench/command` 封装为独立的 Web 适配器，仅在 Web profile 激活；保留 loopback 限制、进程期 capability、请求上限、超时和单一命令入口。Desktop profile 不加载它。
4. 审计 Agent 工具、预设启动和 Debug 入口的所有失败路径，确认 `HOST_UNAVAILABLE` 不会被吞掉或触发无限重试。

**退出门禁**：Host 停止后 Agent 的查询和写命令均快速明确失败；Host 恢复后可正常调用；同一设备端口只被一个 Worker 占用；取消、并发和卸载中调用不会产生第二个状态所有者。

### 阶段 3：打包、原生依赖和官方桌面安装

**工作**

1. 核对 `package.json` 的 `exports`、`files`、`dsh.client.platform`、预设安装脚本和 `npm pack --dry-run` 结果。发布包不引用工作区兄弟目录、coverage、测试 fixtures 或源码 `link:`。Host/Agent/Client 从包内路径解析。
2. 对照官方 [profile 包校验](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.6-alpha.1/apps/desktop/src/profile-packages.ts)：DSH 共享核心包按官方要求声明 peer、保持实例身份；普通依赖留在插件包图中，避免嵌套核心包。
3. 专门验证 `serialport`、`@serialport/bindings-cpp` 在官方 Desktop 的 `allowBuilds` 和捆绑 Node ABI 下能否安装、重建、加载。若 allowlist 不含所需模块，先寻求官方支持或官方允许的构建配置；不要用关闭校验、改 Desktop profile 私有文件来宣称兼容。TCP/仿真能力可以单独验收，但不可掩盖 RTU 缺失。
   [`runtime/io/modbus-driver.mjs`](../../runtime/io/modbus-driver.mjs) 已动态导入 `serialport`，这让运行时可以报告 RTU 不可用，却**不能**绕过 Desktop 对安装时 native build 的审查。若官方暂不接受该 build，比较两个可发布方案：官方增加审核过的 allowlist 条目；或把 RTU 能力移到独立可选包并明确版本/能力协商。后一方案增加包与预设维护成本，只有前者不可行时采用。
4. 用 npm registry 的精确 `name@version` 在隔离 Desktop profile 做真实安装/更新/卸载。`npm pack` 仅作为发布物检查；源码 link 和本地 tgz 可继续用于 Web 开发实验，不作为 Desktop 产品安装路径。
5. 验证预设安装/迁移为显式安装动作，不在 Host `apply()` 反复写盘；旧 `persona.config.text`、`role`、错误 Agent 行迁移到 `prefix` + `/agent`，二次运行零变化。检查 Desktop 与 Web 共享产品数据时不会误改对方可执行 profile。

**退出门禁**：全新安装、旧版本升级、失败后修复、卸载重装都有可复现记录。原生依赖在目标平台实际加载；若失败，发布标记必须明确限制硬件能力，不能标记“完全原生兼容”。

### 阶段 4：生命周期、性能与恢复

**工作**

1. 保持 Host/RPC/Fetch route/Debug runtime/IO broker 的注册与 dispose 一一对应。测试异步注册晚于卸载、连续切预设、关闭窗口、Desktop 插件更新时 Host 停止、异常启动后的显式恢复。
2. Debug 页面只在确有调试会话时订阅事件；空闲状态不产生持续短周期请求。轮询、日志和重试都要有上限与错误分类；一次失败不得变成插件树重载风暴。
3. 用同一操作脚本采集 Web 与 Desktop：启动后静置 10–15 分钟、打开/关闭 Vision、切旧/新会话、开始/停止 Debug、拔插串口、停止操作后再静置。记录 CPU、RSS、上下文切换、请求速率、日志速率、插件 `apply`/dispose 次数。以同机同版本空白 profile 为对照，而不是只看某一瞬间 CPU 为零。
4. 不同时在同一真实 DSH_HOME 中运行 Web 和 Desktop 进行性能/数据写入验收；先在隔离 Home 验证并发写入语义，确认官方存储契约后再决定是否支持共用产品数据的并发场景。

**退出门禁**：静置后指标回到所测基线附近且不单调增长；一次用户操作只产生预期注册/卸载次数；日志可定位故障但不持续刷屏；Desktop 无 Vision 监听端口。

### 阶段 5：跨平台验收、发布与回退

| 场景 | Web macOS | Desktop macOS | Desktop Windows | 验收重点 |
| --- | --- | --- | --- | --- |
| 安装/更新/卸载/恢复 | 必测 | 必测 | 必测 | 精确版本、profile 独立、失败可诊断。 |
| 旧/新预设与 Agent 工具 | 必测 | 必测 | 必测 | `prefix`、`/agent`、Host 缺席失败、无双重写入。 |
| 设置、点表、监控、Debug | 必测 | 必测 | 必测 | 同一命令服务、取消与错误码、空闲开销。 |
| Modbus TCP 与模拟器 | 必测 | 必测 | 必测 | 连接、读点、受控写点、断线恢复。 |
| 串口 / Modbus RTU / 原生模块 | 条件必测 | 条件必测 | **发布硬件兼容前必测** | 打包 ABI、端口所有权、热插拔、权限和关闭清理。 |
| Keil / OpenOCD / 外部进程 | 按平台能力 | 按平台能力 | 按平台能力 | 可执行文件发现、确认流程、失败隔离。 |

建议按四个可独立回退的变更单元交付：**传输探针与契约测试 → Connection 适配 → Agent 所有权收紧 → 发布/原生依赖与性能门禁**。每个单元保留前一版可安装包和 profile 配置快照；出错时回退插件版本与启用项，避免依赖 Desktop 自动回滚，因为官方桌面插件操作会直接修改 profile，失败时保留部分更改。发布前再更新兼容基线文档和 `SUPPORTED_DSH_CONTRACT`，以实测最低支持版本为准。

## 5. 轻量代码级施工图

以下片段是**目标接口草图，不是已经验证过的补丁**。先完成阶段 0 的双载体探针，再把通过的形态写进代码。尽量保持当前页面、业务路由与 Host 命令服务不变。

### 5.1 逐文件改动清单

| 文件 | 建议改动 | 不应顺手改动 |
| --- | --- | --- |
| `host.js` | 将传输注册提到独立小模块；实证通过后 `inject` 缩到 `['connection']`；删 `ctx.connection.register(ctx, ...)`；保留 Host 服务、I/O broker 与共享 Debug runtime 的构造/清理 | 不把路由实现和 JSON 校验继续塞进已有 Host 文件；不改审批/设备业务逻辑。 |
| 新 `src/interfaces/fetch/vision-fetch-route.mjs` | 注册一个稳定的 `/api/vision-bench/dispatch` 精确路径，验证 `endpoint` 与负载，调用现有 `router.dispatch(endpoint, payload, request.signal)`，返回统一信封 | 不把任意 URL、方法或 Agent 命令映射成可执行入口。 |
| 新 `src/interfaces/web/vision-web-compat.mjs`（迁移期） | 仅在可选 `webServer` 注入实际可用时挂旧 `/vision-bench` RPC 和现有进程外 Agent HTTP 桥；在 Desktop 不注册。若旧 RPC 用 `webCtx.connection.rpc.handle`，必须由探针证明调用方 context 与卸载语义正确 | 不让 Web 适配器重新创建 Host 状态或 I/O Worker。 |
| `src/shared/vision-rpc-contract.mjs` | 继续保留 `VISION_HTTP_TO_RPC` 映射作为页面兼容层；增加 Fetch path 常量；允许的 endpoint 仍以现有白名单为准 | 不一次性重命名所有页面的 `/dsh-vision-bench/*` 路径。 |
| `src/infrastructure/host/vision-rpc-client.mjs` | 保留原函数供过渡期；新增或逐步替换为 `createVisionFetchPost`，保持 `post(path,payload,timeoutOrOptions)` 签名和“业务失败直接返回”约定 | 不把 UI 页面改成逐页直接 `fetch`。 |
| `src/ui/client/client-entry.mjs` | 在 `apply` 时创建一次 `post` 适配器，连接设置页、Debug、HMI、监控既有调用 | 不重写四个页面或样式。 |
| `src/infrastructure/host/vision-host-client.mjs` | 区分同进程 Host、明确配置的 Web 桥、Host 不可用；去除默认 `127.0.0.1:3080` 目标和隐式本地执行；更新探活描述 | 不改变 `AgentCommandResult` 的业务字段或审批语义。 |
| `src/interfaces/agent/vision-bench-tool.mjs`、`vision-debug-tool.mjs` | 正式工具的 `requireHost: true` 保持不变并增加回归门禁；测试辅助 `runVisionBench` 改由 fixture 提供 Host | 不修改工具名称、参数 schema 或用户提示词。 |
| `src/types/http-api.d.ts` | 增补公开 Fetch 注册形状、响应信封及实际传输枚举；保留过渡期 `ConnectionRpcLike` 所需字段，最终收掉旧 RPC 类型 | 不引入 DSH 内部类型路径。 |
| `package.json`、`scripts/check-package.mjs` | 把新增 `.mjs` 明确加入 `files`；现有 `pack:check` 已检查相对 import 闭包，新增文件必须通过它；原生依赖另过 Desktop 构建门禁 | 不以源码 link 的成功作为产品安装成功。 |
| `docs/architecture/ADR-012-remote-transport.md`、`ADR-014-debug-events-over-connection-rpc.md` | 迁移通过后改成“Connection 共享 `/api` Fetch 载体 + 保留 cursor 等待语义”，记录为何没有继续使用独立 `rpc.handle` | 不提前把提案写成已落地事实。 |

`host.js` 当前约 300 行，新增注册与编解码放新模块；符合仓库对页面、服务文件体积和 facade 的结构约束。新模块应保持一个职责：把 DSH 请求交给现有 `createVisionRpcRouter`，不复制 `vision-command-service`。

### 5.2 最小探针先验证什么

最小插件只包含 `inject=['connection']` 和一条精确路由；响应体不碰 Vision 状态或硬件：

```js
export const inject = ['connection']

export function apply(ctx) {
  ctx.connection.fetch.register({
    path: '/api/vision-probe',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => Response.json({ ok: true, path: new URL(request.url).pathname }),
  })
  // 注册归调用方 fiber 所有；实测卸载后路径消失和迟到注册的行为。
}
```

Web 浏览器和官方 Desktop 窗口分别执行 `fetch('/api/vision-probe', { method:'POST' })`。观察到相同 JSON、未授权 Web 请求被拦、插件卸载后路径消失、重装不报重复注册，才能进入阶段 1。再用第二个探针证明 `rpc.handle('/vision-probe')` 在目标 Desktop 的行为；如果官方已修复，与方案 A 重新比较，不把旧结论写死。

### 5.3 推荐的单路由信封

当前前端已有约 40 个逻辑 endpoint，逐个注册精确 Fetch 路由会增加注册/卸载表面积。建议只注册 **一个** `/api/vision-bench/dispatch`，请求为 `{ endpoint, payload }`，内部必须查 `isVisionRpcEndpoint(endpoint)` 白名单。`endpoint` 是既有的 `state`、`modbus/read`、`debug/events/wait` 等逻辑名；页面仍传旧路径，由适配器用 `httpPathToRpcEndpoint` 翻译。

```js
// 伪代码：src/interfaces/fetch/vision-fetch-route.mjs
const route = {
  path: '/api/vision-bench/dispatch',
  methods: ['POST'],
  requestBody: 'buffered',
  async fetch(request) {
    // 先检查 content-type、JSON 与 { endpoint, payload } 结构。
    // endpoint 必须在 Vision 白名单中；不能动态导入或拼业务函数名。
    const value = await router.dispatch(endpoint, payload, request.signal)
    return Response.json({ ok: true, value: toLosslessJson(value) })
  },
}
```

这里外层 `ok:true` 表示**载体和路由执行成功**，内层 `value.ok:false` 仍表示既有业务失败，例如 `CONFIG_DRIFT`、`needsConfirm`、`HOST_UNAVAILABLE`。无效 JSON、未授权、路由不可用等用 HTTP 非 2xx；UI 适配器抛出传输错误，不伪装成 `value.ok:false`。未命中的 endpoint 可以按现有 Router 的 `NOT_FOUND` 结果返回，或入口层 404，但必须在 Web/Desktop 统一且有契约测试。`toLosslessJson` 返回不可序列化结果时应显式返回受控 500/错误信封，不可静默返回 `null`。不要在这次迁移中随意缩小 DSH 的请求体上限；先量出证据附件、工程文件等实际最大负载，再定每端点上限。

Client 适配器只动一个模块，示意如下：

```js
function post(path, payload, timeoutOrOptions) {
  const endpoint = httpPathToRpcEndpoint(path) // 继续使用现有白名单
  const signal = combinedSignal(timeoutOrOptions) // 保留取消和默认超时
  return (async () => {
    const response = await fetch('/api/vision-bench/dispatch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint, payload: payload ?? {} }),
      signal,
    })
    if (!response.ok) throw transportFailure(response.status)
    const envelope = await response.json()
    if (envelope?.ok !== true) throw invalidEnvelope(envelope)
    return envelope.value // 包括业务层 { ok:false }
  })()
}
```

以上 `post` 是流程草图；实际实现须保留 `AbortSignal.timeout`/用户 signal 合并、非法信封检查、错误消息脱敏，以及页面现有的同步路径错误行为。`debug/events/wait` 的请求取消必须到达 Host `request.signal`，否则卸载时会留下挂起等待。Client 不需要知道 `dsh-app://`、Web 端口或 Electron IPC。

### 5.4 Agent 调度的三分支明确化

将 [`dispatchHostCommand`](../../src/infrastructure/host/vision-host-client.mjs) 的策略写成显式分支，而非“没找到句柄就猜端口”：

```text
Host 句柄存在且未 disposed → 直接调用 Host dispatcher
否则，明确处于 Web 且有显式配置的桥接地址与 capability → Web HTTP 桥
否则 → { ok:false, errorCode:'HOST_UNAVAILABLE' }
```

正式工具现已 `requireHost:true`，因此第一个改动是增加“Host 缺席无本地副作用”的测试，再删除通用分发器的隐式执行分支。现有大量单元测试调用 `runVisionBench()` 直接执行业务；这些测试应逐类迁到应用服务入口，或在 fixture 中 `registerVisionHost(createVisionCommandDispatcher(home))`。迁移测试时不得降低设备写入审批覆盖。若实测工具在 Desktop 与 Host 分属进程，先查 DSH 是否有公开进程间调用能力；没有时标为 B2 阻塞，不把 Web 监听端口偷带进 Desktop。

### 5.5 对应测试与最小验收序列

| 改动 | 重点测试位置 | 必须证明的行为 |
| --- | --- | --- |
| Fetch 入口 | 新 `test/commands/vision-connection-fetch.test.mjs`；扩展 `test/host-contract.test.mjs` | 白名单、JSON 错误、内外层 `ok`、`toLosslessJson`、取消、重复注册/卸载。 |
| Client 适配器 | `test/commands/vision-connection-rpc.test.mjs` 逐步迁移；`test/architecture/rpc-factory.test.mjs` | 旧路径映射不变；`CONFIG_DRIFT`/确认卡原样返回；401/403/5xx 抛错；自定义 timeout 与 signal 继续传播。 |
| Agent 所有权 | `test/agent/host-bridge.test.mjs`、`test/agent/single-io-owner.test.mjs`、`test/agent/host-http-bridge.test.mjs` | 正式工具缺 Host 不写盘/不开端口；同进程只用一个 broker；Web 进程外桥有明确配置；Desktop 无默认 HTTP 回退。 |
| Debug 等待 | `test/commands/rpc-cancel.test.mjs`、Debug 订阅生命周期测试 | 切会话、关闭页面、Host 停止都取消 `debug/events/wait`，空闲无唤醒风暴。 |
| 发布物 | `npm run quality`、`npm run pack:check`、`scripts/isolated-compat-repro.mjs` | 新文件在 tarball 内；预设迁移幂等；结构/类型/依赖门禁通过。 |

最小真实操作序列：**安装 → 打开设置页 → 查询 `state` → 保存一个配置 → 新旧会话切换 → Agent `system.ping` → Debug 空闲/启动/停止 → 卸载 → 重装**。每一步在 Web 和 Desktop 各留一份请求结果、Host 日志与 `apply`/dispose 计数。`npm run quality` 通过只是代码门禁，不能代替官方 Desktop 安装及 Windows 硬件验收。

### 5.6 用极少日志定位重载和高 CPU

在 `host.js` 的注册与清理边界记录一次结构化事件：`vision.host.start/stop`、`epoch`、PID、DSH 版本、实际启用的 UI/Agent 桥模式、耗时；不要记录 Home 绝对路径、capability 或串口原始数据。在 Fetch 适配器只记录**慢请求或错误**，字段限 `endpoint`、request ID、耗时、HTTP/业务错误码；不要为每次成功的 `state` 或 `debug/events/wait` 写日志。Agent 只在运输方式改变或 `HOST_UNAVAILABLE` 首次出现时记录摘要，重复失败计数并节流。

验收时同时读 Host 日志与系统采样，把 `host.start/stop` 次数、活跃 Debug wait 数、I/O Worker 数、请求/秒和错误/秒与 CPU 曲线对齐。若 CPU 上升但这些计数稳定，再看 DSH 插件树/Connection 栈；若 `host.start/stop` 同步增长，先查 Vision 注册/卸载和上游重载触发源。这些计数属于诊断，不应引入常驻高频轮询。

## 6. 待确认的阻塞项与决策记录

| 编号 | 需要实证的问题 | 阻塞哪一阶段 | 处理原则 |
| --- | --- | --- | --- |
| B1 | `connection.fetch.register` + 相对 `/api` 请求在官方 Desktop 目标版本是否完整支持注册、认证和卸载？ | 阶段 1 | 不通过则寻求官方公开扩展点，停止剥离 `webServer`。 |
| B2 | Agent 工具是否始终与 Host 共享模块实例；若不是，是否有公开的跨进程 Host 调用通道？ | 阶段 2 | 不允许以 Desktop 的 Web 端口或本地直接写入代替。 |
| B3 | Desktop `allowBuilds` 与捆绑 Node 是否支持 `serialport` 绑定？ | 完整硬件发布 | 不通过则向官方申请支持或明确能力限制。 |
| B4 | 现有 Client 资源元数据 `platform: web` 是否也被官方 Desktop 客户端接受？ | 阶段 1/3 | 以实际 Desktop 加载为准，必要时按公开元数据契约调整。 |
| B5 | Web 与 Desktop 共用产品数据时是否支持并发 Host 写入？ | 并发使用承诺 | 用隔离 Home 实证；未证实前不承诺并发安全。 |

**决策记录（提案）**：选择共享 Connection `/api` 精确 Fetch 路由作为 Vision 的跨载体 UI 入口；保留业务服务和 Host 唯一状态所有者；Web 的进程外命令路由作为可选适配器。接受一次传输适配器改造与少量协议测试，换取 Desktop 无端口和 Web/Desktop 同源代码。若官方将独立 `rpc.handle` 修复为跨载体契约，可在后续版本以兼容测试为前提迁回该接口；此迁移不依赖私有 `connection.register`。

## 7. 参考依据

- DSH 官方 [Desktop README（`dsh-v0.1.6-alpha.1`）](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.6-alpha.1/apps/desktop/README.md)：无端口、profile、生命周期、构建与恢复约束。
- DSH 官方 [`client-connection` Host 注册表](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.6-alpha.1/packages/client/connection/src/rpc-host.ts) 与 [公开类型](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.6-alpha.1/packages/client/connection/src/rpc.ts)：`rpc.handle`、`fetch.register` 的不同实现和契约。
- DSH 官方 [Desktop Host 请求分发](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.6-alpha.1/apps/desktop-host/src/index.ts)：`/api/*` 进入 Connection 的共享 Fetch handler。
- DSH 官方 [Desktop 插件管理实现](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.6-alpha.1/apps/desktop/src/project-manager.ts) 与 [profile 包校验](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.6-alpha.1/apps/desktop/src/profile-packages.ts)。
- Vision 现有 [兼容基线](../VISION_DSH_COMPAT_BASELINE.md)、[ADR-004](../architecture/ADR-004-agent-host-state-ownership.md)、[ADR-012](../architecture/ADR-012-remote-transport.md)、[Windows 验收边界](../architecture/ADR-023-windows-validation-boundary.md)。旧兼容基线是历史记录，不能替代本次 Desktop 实测。

## 8. 实施前疑问与决策回复（2026-09-17）

> 下列条目整理自对本文的审阅。请直接在「回复」栏填写；阶段 0 开干前至少填完 **§8.2** 与 **§8.3 的 C1**。§8.1 以实测为准，不必口头猜结论。

### 8.1 须实证的阻塞项（对照 §6）

| 编号 | 疑问（摘要） | 不实证的后果 | 回复（版本 / 结果 / 日志位置） |
| --- | --- | --- | --- |
| **B0** | 阶段 0「官方 Desktop」是否严格对齐 `dsh-v0.1.6-alpha.1`？探针失败时：停工等上游，还是允许 Web 继续、Desktop 标实验双轨？ | 基线漂移会使后续契约门禁失效 | **实施默认（2026-09-17 开搞）**：目标对齐本机 `dsh --version` = `0.1.6-alpha.1`。B1 Desktop 失败 → Web 可继续阶段 1 实验，Desktop 标阻塞不剥 `webServer`；不转向私有管道。 |
| **B1** | `fetch.register` + 相对 `/api/...` 在目标 Desktop 上：注册、鉴权、调用、重复激活、卸载 404、重启是否完整？ | 阶段 1 不能剥 `webServer`，方案 A 立不住 | **Web（隔离 Home）已通过** — 见 `scripts/probes/RESULTS.md`。Desktop 仍 pending。 |
| **B2** | Agent tool fiber 与 Host 是否同一 Node 模块实例？若否，有无公开跨进程 Host 通道？ | 阶段 2 不能只靠进程内句柄；禁止用 Web 端口硬桥 | （待阶段 0 ping/PID 实测） |
| **B3** | Desktop `allowBuilds` + 捆绑 Node ABI 能否安装/重建/加载 `serialport`？ | 不能宣称完整硬件兼容；须限能力或拆可选包 | （本轮硬件 defer，见 S1/C3） |
| **B4** | Client 元数据 `platform: web` 是否被官方 Desktop 接受并加载？ | 阶段 1/3 可能卡在资源注入 | （待 Desktop 加载实测） |
| **B5** | Web 与 Desktop 共用同一产品数据时，是否允许并发 Host 写入？ | 未证实前不能承诺「双开同 Home」 | **默认不承诺**；验收用隔离 `DSH_HOME`。 |

### 8.2 方案与范围拍板

| 编号 | 问题 | 选项提示 | 回复 |
| --- | --- | --- | --- |
| **S1** | 本轮「完成」是否包含 Windows 真串口 / Modbus RTU？ | A) 含硬件必测 B) 先 Desktop 无端口 UI + TCP/仿真，RTU 显式 defer | **B**（此前真机验收 defer） |
| **S2** | Web 进程外 Agent 桥（现 `/dsh-vision-bench/command`）本轮怎么处理？ | A) Desktop 不加载、Web 保留为可选适配器 B) 仅删默认端口猜测 C) Web 也收紧/移除 | **A**（与方案决策一致） |
| **S3** | 旧 `/vision-bench` RPC 与新 `/api/vision-bench/dispatch` 双路由兼容窗口？ | 保留到哪个版本号砍掉？ | 阶段 1 起双路由 + 一致性测试；**砍掉版本待阶段 1 合入后在 CHANGELOG 钉死**（暂记「下一 minor」） |
| **S4** | 阶段 1 是否确认只挂**一个** `dispatch` 精确路径（`{ endpoint, payload }`）？ | 是 / 否（若否：按 endpoint 批量 register） | **是** |
| **S5** | `SUPPORTED_DSH_CONTRACT`（现仍 `0.1.5-rc.1`）本轮策略？ | A) 先实测再改常量 B) 允许阶段性声明 `0.1.6-alpha.1+` | **A** |
| **S6** | Desktop 产品安装路径是否**只认** registry `name@version`？ | A) 是（`tgz`/`link` 不算验收） B) 开发期 tgz 可算、发布不算 | **B**（阶段 0/开发用 tgz；产品验收仍按 A） |

### 8.3 与组件治理工作怎么排

| 编号 | 问题 | 选项提示 | 回复 |
| --- | --- | --- | --- |
| **C1** | 治理分支（`feat/governance-p0-p5`：P4 余量 / P6 / P7）与本迁移如何排？ | A) 先冻治理、全力阶段 0 B) 并行（治理继续、迁移另开分支） | **B** — 本迁移开 `feat/native-web-desktop-migration` |
| **C2** | 阶段 0 探针插件放哪？ | A) 独立小仓 B) `dsh-vision-suite` 临时目录 C) bench 内 `scripts/probes/` | **C** |
| **C3** | 阶段 5 硬件验收是否仍 defer（此前「真机先不搞」）？ | A) 本迁移也 defer RTU/硬件 B) 至少 Windows RTU 必测 C) 按 §5 表全做 | **A** |

### 8.4 实施细节（非阻塞，避免踩坑）

| 编号 | 问题 | 回复 |
| --- | --- | --- |
| **D1** | Desktop 窗口内 `fetch('/api/vision-probe')` 的实际 origin 是什么？探针由 DevTools 手工还是自动化脚本？ | 阶段 0：DevTools 手工 + 下方自动化契约脚本；origin 实测后回填 |
| **D2** | 未登录 Web 401 / Host-Origin 403：Vision 只断言「DSH 先拦」，还是自己再加一层？ | **默认只断言 DSH 先拦**；Vision 不做第二套身份 |
| **D3** | `debug/events/wait` 取消传到 `request.signal`：阶段 1 必带回归，还是可放到阶段 4？ | **阶段 1 必带**（计划强调卸载挂起风险） |
| **D4** | 阶段 2 把 `runVisionBench()` 隐式本地执行改为 Host fixture 时，是否接受大批量测试改动作为独立提交单元？ | **接受**，独立提交单元 |

### 8.5 填完后的默认开工条件

当 **S1–S6、C1–C3、B0** 有明确回复，且同意方案 A 以阶段 0 双载体探针为准时：

1. 在约定位置创建最小 probe（`inject=['connection']` + `/api/vision-probe`）。
2. 在隔离 `DSH_HOME` 下分别跑 Web 与官方 Desktop，填写 §8.1 结果列。
3. **B1 通过** 才进入阶段 1 代码改造；B1 失败则按处理原则停剥离 `webServer`，改记上游阻塞，不转向私有管道。
