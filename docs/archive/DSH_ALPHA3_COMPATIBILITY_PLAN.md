# DSH 0.1.2-alpha.3 兼容迭代计划

## 1. 目标

把 dsh-vision-bench 从“可以被 DSH 0.1.2-alpha.3 加载”推进到“按 alpha.3 的正式契约运行”，并关闭升级后暴露的会话定位、原生 Tab 导航、通知消息和浏览器通信边界问题。

目标版本：

- DSH：0.1.2-alpha.3
- Vision：建议发布 0.26.0
- Node.js：24.x
- 首轮验收平台：macOS
- Windows 串口、Modbus、OpenOCD 真机验收：保留为后续独立验收，不作为本轮阻塞项

本轮不是 UI 重设计，也不新增 CAN/DBC、远程 Runner、多设备市场或 Keil 能力。

## 2. 当前升级结果

### 2.1 已完成

- 两个本地 dsh 命令均已升级为 0.1.2-alpha.3：
  - /opt/homebrew/opt/node@24/bin/dsh
  - /opt/homebrew/bin/dsh
- launchd 服务 com.qin.deepseek-harness-web 已用 alpha.3 重启。
- 127.0.0.1:3080 已完成令牌握手和登录后页面响应检查。
- Web Profile 已能加载 Vision、dsh-at-file 和 dsh-better-sidebar。
- Vision 当前质量门通过：
  - npm test：669 项通过
  - npm run test:full：通过
  - lint：319 个文件
  - 依赖边界：205 个模块、645 条依赖，无违规
  - 行覆盖率：80.26%
  - 打包检查：通过

### 2.2 已升级的 Profile 兼容依赖

- dsh-better-sidebar：0.12.2 → 0.18.0-alpha.0
- dsh-at-file：0.6.0 → 0.7.0，对应提交 da602d1a8f1b417b8a1d8d4059e0f4cb1c353524

### 2.3 回滚点

- 完整备份：
  /Users/qin/.dsh-backups/dsh-home-before-0.1.2-alpha.3-20260901-144040.tar.gz
- SHA256：
  88cae4ea5cc4f04ec18d2676b01b22811d475316efe9243c5e87dfd3c228ddae

## 3. 结论

Vision 不是“整体不可用”，也不需要推倒重写。后端命令边界、工作区持久化、Modbus、OpenOCD、审批、可视化组件和 Agent 工具主体仍可保留。

真正需要迁移的是四条 Harness 集成边界：

| 优先级 | 边界 | 当前问题 | 结果 |
| --- | --- | --- | --- |
| P0 | Session → workspace path | 仍读取已移除的 useSessions/cwd | 页面能挂载，但 cwd 为空，状态请求不会启动 |
| P0 | 原生 Tab / Agent 聚焦 | 依赖不存在的 slots.select | 跨 Tab 聚焦不再可靠 |
| P1 | Client 服务声明 | 只声明 slots，却读取 locale | alpha.3 严格服务访问下静默降级 |
| P1 | Agent 通知消息 | 动态导入旧核心包，fallback 缺 id | followup/steer 消息不满足 alpha.3 结构 |
| P0 安全 | 浏览器 → Host 通信 | 自定义 HTTP 路由以静态请求头代替认证 | 未登录本地请求可读写 Vision 状态 |
| P2 | Agent preset 生命周期 | 仍按“修改后当前 Session 生效”理解 | alpha.3 使用 generation，已有 Session 不热更新 |

现有 669 项测试全绿并不能证明 alpha.3 兼容，因为测试夹具仍主动提供旧 useSessions，恰好遮住了最关键的破坏性变化。

## 4. 实施原则

1. 先建立 alpha.3 契约测试，再修改业务代码。
2. 页面修复和传输安全迁移分开提交，避免一个提交同时改变 UI 状态和 Host 通信。
3. 所有 Session 状态必须以 sessionId 隔离，禁止以模块级 cwd 共享。
4. 使用 Harness 公开契约，不再读取 DOM、私有 Store 或不存在的 slots.select。
5. Agent 聚焦不得打断用户主动切走；跨页聚焦通过原生 viewRequest 协议传递。
6. 本轮不引入新的大型 UI 依赖。Remote 迁移只使用 Harness 官方包。
7. 自动化、浏览器验收和 Windows 真机验收必须分别报告。

## 5. 分阶段实施

### 阶段 0：建立 alpha.3 合同基线

建议提交：

    test(alpha3): add Harness contract fixtures

新增：

- test/fixtures/harness-alpha3-props.mjs
- test/alpha3-contract.test.mjs
- docs/architecture/ADR-011-dsh-alpha3-integration.md

修改：

- test/client-apply.test.mjs
- 所有自行构造 conversation.view props 的 UI 测试

要求：

- fixture 只能提供 alpha.3 的公开字段：
  - sessionId
  - useSession
  - useProjection
  - useConversation
  - useInput
  - useWorkspaces
  - viewRequest
  - openView
  - completeViewRequest
- 不再在主兼容套件中提供 useSessions。
- 增加一条反向测试：生产代码出现 props.useSessions 或 slots.select 时失败。
- 保存 alpha.3 上游契约来源和对应 tag/commit，避免以后凭记忆改接口。

验收：

- 新合同测试在当前代码上应先失败，证明测试确实覆盖了断点。
- 不修改业务行为。

### 阶段 1：修复 Session 工作区路径

建议提交：

    fix(alpha3): resolve session workspace through useWorkspaces

主要文件：

- src/ui/common/session-scope.mjs
- src/ui/monitor/frames/frames-page.mjs
- 所有调用 useSessionCwd/sessionCwd 的页面

实现：

1. sessionCwd(props) 使用 useWorkspaces 的 snapshot。
2. 从 snapshot.items 中查找 sessionIds 包含 props.sessionId 的 workspace。
3. 返回 workspace.path；不存在时返回空字符串。
4. frames-page 删除自己的重复 cwd 解析，统一调用公共 helper。
5. props.scope.cwd 只允许作为短期兼容回退，并加弃用测试；0.26.0 发布前决定是否删除。
6. 找不到 workspace 时展示可解释的“正在等待工作区”状态，不发送 cwd 为空的 Host 请求。
7. Session 切换时终止旧轮询、清空旧页面快照并以新 sessionId 重建订阅。

必须增加的测试：

- 一个 workspace 对应一个 Session。
- 同一 workspace 对应多个 Session。
- 两个 Session 位于不同 workspace，不串 cwd。
- Session 暂未进入 workspace 列表。
- Session 从 workspace A 移到 B。
- frames、告警、报文、可视化、HMI 使用相同解析结果。

验收：

- 生产代码中 useSessions 命中数为 0。
- alpha.3 实际页面能加载当前工作区状态。
- Session A/B 快速切换不会显示上一 Session 的状态。

### 阶段 2：迁移原生 Tab 与 Agent 聚焦协议

建议提交：

    fix(alpha3): adopt conversation view request navigation

新增：

- src/ui/workspace/vision-view-request.mjs
- test/vision-view-request.test.mjs

修改：

- src/ui/bench-runtime.mjs
- src/ui/bench-view.mjs
- src/ui/workspace/vision-navigation-store.mjs
- HMI、调试、监控三页的跨页入口
- Agent focus 消费逻辑

删除：

- selectView
- setNavViewSelector
- 对 slots.select 的依赖
- wildcard 全局 view selector hack

协议：

- 一级页面仍由 conversation.view 注册。
- 跨页导航调用 props.openView(targetView, focusToken)。
- focusToken 使用版本化、可容错的自有编码，例如 dvb1: 前缀加 URI 安全 JSON。
- 最小内容：
  - section
  - target
  - routeKey
  - source
- 目标页只消费 viewRequest.view 等于自身 viewId 的请求。
- 请求成功应用后，completeViewRequest() 只能调用一次。
- token 非法或目标已删除时，安全忽略并完成请求，不能形成重复导航循环。

用户控制规则：

- 用户手动切换一级或二级 Tab 后，保留当前已有的 navigation lease。
- lease 期间 Agent 请求只更新角标/提示，不强制抢焦点。
- 用户主动点击“前往 Agent 目标”后再执行跳转。
- 用户在聊天页时，公开 API 没有全局强切 Vision Tab 的能力；只排队聚焦请求并显示提示，不读取私有 Store、不操作 DOM。
- 同一 routeKey 去重，Session A/B 的队列互相隔离。

必须增加的测试：

- 同页 section 跳转。
- HMI → 监控、调试 → HMI 的跨页跳转。
- viewRequest 指向其他 view 时不消费。
- malformed token。
- completeViewRequest 恰好一次。
- 用户 lease 阻止 Agent 抢焦点。
- 后台 Session 只记录 badge。
- Session 切换后旧请求不泄漏。

验收：

- 上位机、调试、监控三个原生 Tab 均能互相跳转。
- Agent 聚焦可定位到连接、设备、点位、告警、组件或报文。
- 用户主动操作期间页面不被 Agent 拉走。

### 阶段 3：补齐 Client 服务和 Agent 通知契约

建议拆成两个提交：

    fix(alpha3): declare client slot and locale services
    fix(alpha3): emit valid plugin notice messages

Client 服务文件：

- scripts/build-client.mjs
- src/ui/bench-runtime.mjs
- package.json
- test/client-bundle.test.mjs
- test/client-apply.test.mjs

修改：

- 客户端运行模块 inject 改为 slots + locale。
- package.json 的 dsh.client.inject 静态声明：
  - @deepseek-ai/dsh-client-ui-slots
  - @deepseek-ai/dsh-client-locale
- 对声明过的服务统一使用 ctx.slots 和 ctx.locale。
- locale 不可用时应有明确测试，不依赖吞异常完成降级。

Agent 通知文件：

- src/host/bench-notify.mjs
- 对应通知、followup、steer 测试

修改：

- 删除运行时动态导入 @deepseek-ai/dsh-llm。
- 使用 node:crypto 的 randomUUID 生成消息 id。
- 每条消息必须包含：
  - id
  - role: user
  - content
  - source.kind: plugin
  - source.plugin: dsh-vision-bench
  - source.form: notice
  - source.summary
- summary 做长度上限和敏感内容过滤。

验收：

- 中文 locale 在 alpha.3 中正常注册。
- client manifest 与 bundle inject 完全一致。
- 每条 Vision notice 均有非空、唯一 id。
- 在真实 alpha.3 Session 中分别验证空闲 followup 与运行中 steer。

### 阶段 4：关闭自定义 HTTP 认证缺口

风险：高。该阶段必须独立评审和回滚。

当前已确认：

- 未携带 DSH 登录 cookie/token，只加 X-DSH-Vision-Bench: 1，即可访问 /dsh-vision-bench/state。
- Origin 正则只能限制普通浏览器跨域，不是身份认证。
- 本地任意进程可伪造静态请求头。
- Vision 能写 Modbus、执行刷写，因此不能把“仅监听 localhost”视为充分授权。

#### 阶段 4A：Remote 可行性 spike

建议提交：

    chore(alpha3): validate official Remote transport packaging

验证：

- Host 使用 TypertRemoteService 与 Remote 装饰器公开最小只读方法。
- Client 通过 ctx.remote.visionBench 调用。
- Vision 以正式 tarball 安装到隔离 Profile，而不是 link 到外部仓库。
- official Remote 运行时解析到同一套 alpha.3 核心实例。
- 测量 client bundle 增量、启动时间和错误恢复。

门禁：

- spike 不通过，不进入全面搬迁。
- 不添加第三方通信框架。
- 不允许为绕开模块解析而复制 Harness 私有源码。

#### 阶段 4B：浏览器 RPC 迁移

建议提交：

    security(alpha3): migrate browser host calls to authenticated Remote

主要文件：

- src/host/bench-service.mjs
- src/host/bench-web.mjs
- src/ui/bench-client.mjs
- package.json
- scripts/build-client.mjs

实现：

- 页面状态、配置命令、审批操作全部走官方 Remote。
- Client 注入 remote 与 remote.visionBench。
- 删除浏览器对 /dsh-vision-bench/state、command、approval 等业务路由的 fetch。
- 删除浏览器静态认证请求头。
- Remote 方法必须接收/校验 sessionId，并从 Session/workspace 关系解析 cwd，禁止只信任浏览器提交的 cwd。
- 写命令继续经过现有单写者、版本检查、审批和幂等边界。

Agent 子进程：

- 如果 Agent 工具仍需要进程外访问，保留独立 loopback bridge。
- bridge 与浏览器 RPC 分离。
- 使用启动时随机 capability token，不使用固定字符串。
- 限制到当前 Profile、当前 workspace 和允许的命令集合。
- capability 不写日志、不进入页面状态、不长期落盘。

短期防护：

- Remote 全量迁移完成前，Host 只允许 loopback 监听。
- 发现非 loopback bind 时，Vision 应拒绝启动有写能力的路由并给出明确错误。
- 所有写路由补 origin、content-type、请求大小和 schema 检查；这些只是纵深防御，不能代替认证。

安全测试：

- 未登录请求无法读状态。
- 未登录请求无法写点位、批准或刷写。
- 伪造 X-DSH-Vision-Bench 无效。
- Session A 不能批准 Session B 的操作。
- cwd 伪造无效。
- capability 过期或不匹配时拒绝。
- 非 loopback 启动策略符合预期。

验收：

- 浏览器业务通信中不再存在固定共享密钥。
- 未认证访问返回拒绝，且不泄漏工作区路径、串口或点位信息。
- 现有 Agent 工具仍能通过受限桥接工作。

### 阶段 5：对齐 Agent preset generation 生命周期

建议提交：

    fix(alpha3): align Vision preset UX with mount generations

主要文件：

- src/preset/seed.mjs
- src/host/preset-health.mjs
- Vision 设置/状态提示组件
- README.md

实现：

- 保留 agentPresets.copy；该公开能力在 alpha.3 仍存在。
- 只有 composition 内容确实变化时才写 agent.cordis.yml。
- 修改成功后明确提示：“新建 Session 后生效”。
- 不再暗示已打开 Session 会热更新 Agent 工具和 system prompt。
- preset health 展示当前 generation、发现错误和下一步操作。
- 已有 Session 不主动销毁或重建。

测试：

- 新安装后，新 Session 获得 Vision 工具和预设。
- 修改 preset 后，当前 Session 保持原 generation。
- 新 Session 使用新 generation。
- 重复执行 seed 不产生无意义写入。
- 损坏的 agent.cordis.yml 显示明确健康错误。

### 阶段 6：版本、文档和发布验收

建议提交：

    release: prepare dsh-vision-bench 0.26.0 for DSH alpha.3

修改：

- package.json：0.26.0
- README.md：写明 Requires DSH 0.1.2-alpha.3
- CHANGELOG.md：列出破坏性集成迁移
- docs/architecture/ADR-008-session-navigation.md：标记被 ADR-011 补充或替代的部分
- docs/WINDOWS_ACCEPTANCE_0.26.md：建立未验收清单，不伪造结果

发布形态：

- 正式验收使用 npm pack 生成的 tarball安装。
- 不以 link: 开发安装作为发布兼容证据。
- 不新增未验证的 dshCompatibility 自定义字段；兼容版本写入 README/CHANGELOG 和发布说明。

## 6. 质量门

每个阶段至少运行：

    npm test
    npm run test:full
    npm pack --dry-run

静态门禁：

    rg "useSessions|slots\.select|setNavViewSelector" src
    rg "X-DSH-Vision-Bench" src

期望：

- 第一组在阶段 2 后零命中。
- 第二组在阶段 4 后不再用于浏览器业务认证；若 bridge 仍保留，应改为随机 capability 方案且有单独命名。

隔离 Profile 验收矩阵：

| Profile | 用途 | 必须通过 |
| --- | --- | --- |
| alpha.3 + 官方内置插件 + Vision tarball | 证明 Vision 自身兼容 | 是 |
| 用户当前完整 Profile | 证明日常环境可用 | 是 |
| 未安装 better-sidebar | 证明 Vision 已不依赖旧侧栏 | 是 |
| Windows + 串口/Modbus/OpenOCD 真机 | 设备链验收 | 本轮记录为未验收 |

浏览器手工验收：

- 新建 Session，打开上位机、调试、监控。
- 每页显示当前 workspace，而不是空白或上一 Session 数据。
- 添加连接、设备、点位并读取。
- Agent 操作后对应原生 Tab 有状态回显。
- 用户主动切页时 Agent 不抢焦点。
- 串口报文、告警、可视化组件能定位到正确对象。
- 刷新页面和切换 Session 后状态隔离。
- 未登录窗口不能访问 Vision 数据。

## 7. Profile 遗留风险

这些问题不属于 Vision 代码，但会影响“完整用户 Profile 已兼容”的结论：

- dsh-excel-panel 0.6.1 仍声明 dsh-better-sidebar ^0.12.0，与当前 0.18.0-alpha.0 不匹配。
- @omdsh-dev/dsh-genui 0.8.4 仍依赖已移除的 rc.6 时代包，包括 dsh-client-runtime。
- 当前 Profile 能启动不等于这两个插件所有页面均可用。

处理方式：

1. Vision 的 alpha.3 验收必须先在隔离 Profile 完成。
2. 对 excel-panel 和 genui 分别做安装、页面挂载和核心交互检查。
3. 未通过前只标记“环境兼容风险”，不能归因于 Vision，也不能宣称完整 Profile 全兼容。

## 8. 工作量与依赖成本

- 阶段 0–3：中等，主要是契约迁移和测试，预计 2–4 个开发日。
- 阶段 4：高风险，Remote spike + 安全迁移预计 3–5 个开发日。
- 阶段 5–6：低到中等，预计 1–2 个开发日。
- 不引入新的大型 UI 库，无新增第三方许可证面和前端体积预算。
- 最大不确定性不是页面开发，而是 linked package 下官方 Remote 的模块解析；因此必须先做 tarball 隔离 spike。

以上为工程量级，不是交付承诺。若阶段 4 spike 发现 alpha.3 没有可用的插件认证接入点，应单独形成上游问题和临时防护 ADR，不能用静态请求头冒充已解决。

## 9. 回滚策略

- 每阶段单独提交，禁止把路径、导航、Remote 和 preset 生命周期揉成一个提交。
- 阶段 1–3 可独立回滚，不改工作区落盘 schema。
- 阶段 4 保留一个发布周期的 Host 内部适配层，但浏览器不得自动退回未认证 HTTP。
- 本轮不升级 visualization schema，不产生旧版 Vision 无法读取的新磁盘格式。
- DSH 本体异常时，使用升级前备份恢复 /Users/qin/.dsh，并恢复原 CLI 版本；恢复前停止 launchd 服务。

## 10. 完成定义

只有同时满足以下条件，才可宣称 Vision 匹配 DSH 0.1.2-alpha.3：

- alpha.3 隔离 Profile 能从 tarball 安装并启动 Vision。
- 三个原生 Tab 可挂载并得到正确 workspace path。
- 生产代码不再依赖 useSessions、slots.select 或私有 DOM/Store。
- Agent 聚焦使用 viewRequest/openView，且不抢用户焦点。
- locale 服务声明与运行时访问一致。
- followup/steer 消息满足 alpha.3 的 id/role/content/source 契约。
- 浏览器不能绕过 DSH 身份边界访问 Vision 状态或写操作。
- 新 Session 正确获得 Vision preset；旧 Session 生命周期说明准确。
- npm run test:full 和打包检查通过。
- macOS 浏览器手工流程通过。
- Windows 真机验收明确列为未验收，而不是默认为通过。

