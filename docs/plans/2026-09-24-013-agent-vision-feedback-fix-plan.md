# Agent 实跑反馈：错误关联 ID 与按 ID 点位查询修复计划

## 1. 基线、证据与范围

代码核对基线：`04d1402`。当前已有未提交的 CHANGELOG.md、client.js、docs/VISION_DSH_COMPAT_BASELINE.md、package.json，以及未跟踪的 `2026-09-23-012-agent-vision-review8-fix-plan.md`。这些不是本计划产生的改动；实施时先重新记录 HEAD/status，不覆盖、不代为提交这些既有改动。

用户提供的 Agent 运行反馈称版本从 0.29.25 升至 0.29.28，配置响应显著缩小，错误提示及告警接口改善。这是用户提供的运行证据，不等于本轮已重跑安装/硬件验收。

当前代码已确认：

- vision-bench-tool.mjs 在取消和参数预检失败时直接 finalize，绕过 command envelope，因此可能缺 commandId。
- executeVisionCommand 的 envelope 本来会为正常进入命令执行链的错误补 commandId。不能预设所有 CONFIG_DRIFT 都缺 ID；应通过各入口测试定位。
- points 只有 op=list 走查询；其余 op 都转给 mutateConfig。op=get 尚未实现，先收到 CONFIG_VERSION_REQUIRED 不代表实际发生了修改。
- pointsOp 的 list 当前会调用 ensureWorkspaceClaimed；新增查询不得不加区分地复用这一持久化认领路径。

本轮只处理两项：A 统一命令关联 ID；B 新增按 ID 的点位只读查询并修正未知操作路由。不改变已验收的告警/设备路由/share 身份策略，不重新设计幂等缓存，不自动升级或发布插件。

所有下文路径均相对于插件根目录 `/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench`。

## 2. A：从 Agent 入口到错误出口保持同一个 commandId

### 契约

1. 一次调用在最外层创建一个规范化 commandId；已有合法字符串 ID 按既有 trim 规则使用，未提供时只生成一次。
2. 成功、预检失败、调用前取消、Host 不可用、超时、Host 执行失败、CONFIG_DRIFT 均返回该 ID。重放不得重新生成 ID。
3. commandId 是关联标识；“失败返回有 ID”不表示命令已执行或缓存。预检拒绝不进入 Host、幂等缓存或设备 I/O。
4. 参数修正后应发起新命令。已有幂等键用于不同命令仍按 COMMAND_ID_REUSE 拒绝，不改缓存 fingerprint 规则，不靠静默替换 ID 避开冲突。
5. 保留 errorCode、missingFields、hint、refresh、conflicts 等结构化字段。不得为了统一 ID 把错误简化成一段文本。

### 修改位置

**`src/interfaces/agent/vision-bench-tool.mjs::execute()`**

- 在 signal.aborted 和 validateAgentToolArgs 之前，使用已有 `normalizeCommand` / `newCommandId` 机制准备命令上下文，携带 home/cwd/sessionId/action/payload/source。不要自己再造第三套 ID 格式。
- 一个局部结果出口处理 envelope、适用的 refresh、Agent projection 和 finalize；取消、预检以及 dispatch 结果均通过它。保持既有紧凑 JSON/无损结果语义，不重复序列化 JSON 字符串。
- dispatch 显式传递入口生成的 commandId，payload 若保留 commandId 也必须一致；不能只在最终输出补随机 ID。
- 优先复用 command-contract.mjs::envelope，而不是手工枚举错误字段。核对 envelope 补 nextConfigVersion 等行为不会让预检错误被误识别成成功 mutation。
- 工具与 Host 都可能封装结果，封装必须保持幂等：同一个 ID、相同 errorCode，不覆盖正确的 Host 版本/诊断字段。

**`src/infrastructure/host/vision-host-client.mjs`**

- 审查 dispatchHostCommand 的取消、Host 未注册、HTTP 超时、错误状态码、无效响应、进程内 dispatch 错误等出口。使用调用方提供的同一个命令上下文封装失败。
- Host 客户端也可能被非 Agent 调用；其自身入口需要规范化缺省 ID，但传入已有 ID 时不得再生成。
- 不改变 Host 必须可用的限制，不增加隐式本地执行兜底，不为仅补 ID 而自动重试写操作。

**`src/application/commands/command-contract.mjs` / `vision-command-service.mjs` / `agent-result-projection.mjs`**

- 保留 executeVisionCommand 的既有 envelope 和幂等缓存顺序。若入口最终封装已经足够，不无意义改写服务。
- 检查 projection/预算压缩保留 commandId；现有 pickSafetyFields 已包含它，应通过行为测试证明各分支不丢。
- 已有可预期异常若通过客户端错误转换返回，补同一 ID；不为捕获所有异常而把编程错误伪装成 TARGET_REQUIRED，也不返回内部堆栈给 Agent。

### 测试矩阵

新增 `test/agent/agent-command-correlation.test.mjs`，调用真实 visionBenchTool.execute，使用现有 Host 注册/注入测试设施：

| 场景 | 断言 |
| --- | --- |
| read 缺 connectionId/deviceId，显式 commandId | 返回原 ID、全部 missingFields；Host 调用 0 次 |
| 相同预检错误但无 ID | 返回非空生成 ID，不需要 Host |
| 执行前 signal 已取消 | 返回同一 ID，Host 调用 0 次 |
| Host 未注册、超时、无效响应 | 错误码不变、ID 不变；不执行本地设备操作 |
| 正常 Host 成功 | 入口、Host 收到、最终输出三者 ID 完全一致 |
| Host CONFIG_DRIFT | 同一 ID，refresh 与版本字段保留 |
| Host CONFLICT | 同一 ID，conflicts 保留 |
| 同键同参数重放/同键不同参数 | 维持现有幂等与 COMMAND_ID_REUSE 行为 |

通过工具真实返回类型解析 JSON/content，不仅测试 envelope 纯函数。fixture 及时注销 Host，禁止访问真实串口、发起真实跟进通知。

## 3. B：新增 points get，明确只读路由

### 确定接口

新增 `action:'points', op:'get'`：

```json
{"action":"points","op":"get","ids":["p1","p2"]}
```

- 单点可用 `pointId` 或既有 `id` 别名；批量推荐 ids。多个选择字段同时出现，规范化后的集合不同则 FIELD_CONFLICT，同值可接受。不要扩散到新的 pointIds 别名。
- ID 必须非空字符串，trim 后去重，保持首次出现顺序；每次最多 32 个。空选择返回 TARGET_REQUIRED + missingFields/hint，类型错误或超量返回明确参数错误，不静默截断、不回退全量 list。
- 不要求 connectionId/deviceId；可选提供时作为当前会话可见点集合的额外过滤条件，不能覆盖会话隔离。
- 返回紧凑 points 数组、configVersion、requested、returned、missingIds，不返回 workspace、全量拓扑、可视化或历史数据。
- 按请求顺序返回已找到点。部分不存在：`ok:true, partial:true`，同时返回 missingIds；全部不存在：POINT_NOT_FOUND、points:[]、returned:0、missingIds。缺失只表示“当前可见且满足过滤条件的集合中未找到”，不能泄露其他会话是否拥有该 ID。
- 全部找到时 partial=false。复用 compactPointRow，保留 Agent 决策需要的点位定义和现值，不默认附整段趋势或帧。
- 本轮不追加 list 分页或 list 的 ids 过滤；原 list 保持契约，get 提供明确轻量路径。

### 只读边界

查询不增加 configVersion、不认领或迁移拓扑、不改 share/focus/订阅、不发起设备 I/O。保留既有命令追踪/会话活跃记录约定，因此不要把“配置只读”夸大为所有元数据绝不落盘。

已分区工作区：只投影当前可信 origin.sessionId 的有效视图。缺失会话时按现有分区授权规则明确拒绝，不回退成跨会话 union。

未分区旧工作区：复用既有纯 claim/project 逻辑构造临时可读视图，但不保存 claim。已有归属时不得重新认领。不要从 args 任意 sessionId 越过 Host 提供的会话上下文。

### 修改位置

**新增 `src/application/modbus/point-query-service.mjs`**

建议拆为选择器规范化纯函数与 `getPoints(home,cwd,query)`：

1. 校验请求选择器及上限。
2. loadWorkspace，创建只读有效视图；不得调用 ensureWorkspaceClaimed 或任何 save 方法。
3. 先限制会话可见范围，再应用可选连接/设备过滤，最后按 ID 查找。
4. compactPointRow 并计算 requested/returned/missingIds；禁止按全工作区扫描后用错误文本暴露其他会话对象。

**`src/application/commands/handlers/config-command-handler.mjs`**

- 明确分流 list → 既有 list，get → 新查询，add/update/remove/clear → mutateConfig。
- 其他 op 直接 UNKNOWN_OP，并返回支持列表及 hint；这一判断必须早于版本检查和 mutateConfig，未知 op 不再报 CONFIG_VERSION_REQUIRED。
- payload.ids/pointId/id 与可选 connectionId/deviceId 原样交给统一选择器规范化函数；不要在多个入口写不同选择规则。
- `action:config, operation:points.get` 不进入配置修改；明确返回 UNKNOWN_OP，指引使用 points/op=get。不要把 get 加入 CONFIG_OPERATIONS 的修改集合。

**`src/interfaces/agent/vision-bench-tool.mjs`、`agent-tool-preflight.mjs`**

- 描述增加 get、ids 查询示例、最多 32 个、部分缺失语义，明确 list/get 不要求版本。
- ids 的说明从“只用于 remove”改为用于 get/remove。op schema 已含 get，但需说明按 action 的合法组合。
- 预检可调用同一个选择器校验纯函数；Host 入口仍需检查，不能只靠 Agent schema。预检错误通过 A 的统一出口返回 commandId。

**类型、结果投影与打包**

- 更新实际使用的 src/types 下请求/返回类型，不把只读查询描述成 mutation。
- Agent projection 必须保留 configVersion/points/requested/returned/missingIds/partial/commandId；不携带 previousConfigVersion/changedIds 来伪装成提交。
- 32 个 ID 上限解决点数增长，不声称自动满足任意字节预算；若沿用响应预算裁剪，不能静默丢行或误报 returned，需明确 overrun/提示分批。优先保持有界查询完整返回。
- 新生产模块加入 package files，核对 typecheck/import closure；源代码变更需要重建的 client.js 按现有流程生成，不手改已有生成文件。

### 行为测试

新增 `test/agent/points-get.test.mjs`，覆盖真实 handler/runVisionBench，至少一个走工具 execute → Host → projection：

1. ids 两点成功，顺序稳定、去重、返回无全量 workspace；查询前后配置/版本/claim 标记不变，transport 调用为 0。
2. 单点 pointId/id；等价选择器兼容，冲突选择器 FIELD_CONFLICT。
3. 缺 ID、空字符串、错误类型、33 个不同 ID：明确失败，不全量 list、不要求版本。
4. 部分缺失、全部缺失，计数和 missingIds 与定义一致。
5. 两会话包含不同私有点：A 查 B 点与查不存在 ID 得到等价缺失结果；共享点对有权会话可见。
6. 可选连接/设备过滤不匹配：按过滤后未找到处理；不能忽略过滤而返回另一连接的点。
7. 合法未分区旧工作区 get 不落盘认领；分区工作区无会话拒绝；即使带旧 expectedConfigVersion，查询不进入版本锁校验。
8. points/op=typo 及 config/operation=points.get 返回 UNKNOWN_OP 和正确用法，不返回 CONFIG_VERSION_REQUIRED。
9. list 原行为及四个修改 op 的原子性、版本要求、FIELD_CONFLICT 守卫继续通过。
10. 经 Agent 最终输出，成功和失败均有 commandId；CONFIG_DRIFT/订阅等无关既有契约不回归。

## 4. 提交顺序与验收

建议两个实现提交，生产修改与对应测试一起提交：

1. `fix(agent): preserve command correlation across all result paths`
2. `feat(points): add scoped read-only lookup by point ids`

可以另有 docs 提交记录计划和实际验证报告。不要把当前已有未提交的版本/打包/发布改动混入这些提交；若与 package.json/client.js 重叠，先按现有内容增量合并并保留既有修改。

先运行针对性失败复现，再实现修复；最终运行 lint、typecheck、pack:check、build:check、structure:check、assertions:check、test:unit，以及工作区和本轮提交范围 git diff --check。测试总数和基线失败以实施前的实际 HEAD 为准，不能机械沿用上一轮 1517/1520。

交付证据：

- 命令 ID 对照表：入口 ID、Host 收到的 ID、最终成功/失败输出 ID；预检/取消的 Host 调用次数为 0。
- points get 的单点/批量/部分缺失/跨会话缺失响应，配置与 claim 标记前后对比。
- 新旧 points list 和 mutation 回归结果，全部门禁及明确的基线失败对照。
- 最终修改范围及仍保留的他人未提交改动。

代码验收后再执行一次真实 Harness Agent 会话回归：查询已知测试点和不存在 ID，触发无副作用参数错误，核对 commandId 和响应大小。无需为本轮测试真实写点、改告警阈值或创建告警。未取得真实会话日志前，只声明代码及模拟测试通过；不宣称硬件、安装或幂等故障恢复已全面验收。
