# Vision Agent × 插件：第五轮 Review 完整修复迭代计划

## 1. 基线、目标与范围

基线提交：`c5f1222`。上轮新增五项修复及授权模块拆分已提交，工作区干净。

最近审查结果：lint、typecheck、pack:check、build:check 通过；单元测试 1479/1482。失败仍为 multi-conn-poll 两项及 frames-virtualizer 一项，断言位置和原因与上一轮一致。日志：`/tmp/vision-review5-unit.log`。提交范围 `043d81c..c5f1222` 的 diff 检查另发现授权文件末尾多余空行。

本轮目标：消除身份预检对正常共享/禁用连接场景的误拦截，防止重复 deviceId 被静默合并后读取错误从站，并补齐能够证明实际请求正确的验收测试。

保留此前确认的约束：

- 不迁移 values/trend/alarmState 的运行态键；两个有效私有点定义占用同一 pointId 时，显式 sessionId 仍不能绕过冲突。
- 真正涉及本次采集的冲突必须在 I/O 前拒绝，整轮 0 读取、0 运行态提交、0 通知。
- 不重做通知 epoch、focus 身份、首次投递授权和 trend overrun 契约；保留其回归测试。
- 不更改 DSH 官方包、不升级依赖、不提高 structure-budget 阈值、不混入三个基线测试失败的修复。
- 本文只规定代码实施和模拟验收，不声称完成真实硬件、Web 或 Desktop 安装验收。

以下相对路径均相对于 `/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench`。接口名称是实现建议，不代表已经存在。

## 2. 统一判定规则：把“本次读取”与“全局占槽”分开

现有误拦截源于把原始配置行、会话有效配置、本轮执行集合混为一谈。修复后应显式保留三个集合：

1. **原始配置**：保存前的输入、共享层及各私有层。用于发现重复定义，不能先去重。
2. **有效身份索引**：依据 share、会话投影和旧工作区语义确定实际有效的定义；已被共享层覆盖的私有备份不算有效定义。
3. **本轮读取集合**：通过连接 enabled 与既有采集规则筛选后的目标及点位。只有该集合内 pointId 才触发运行态冲突查询。

重要区别：禁用连接不能凭自己的点位扩大本轮读取集合；但若本次确实读取 pointId=p，其他有效私有层也占用 p，仍沿用保守冲突策略。禁用不是释放全局运行态槽位，不要把这一修复实现为“从所有身份索引中删除 disabled 层”。

| 场景 | 本轮结果 |
| --- | --- |
| 共享点 p，私有层保留被共享覆盖的旧 p | 正常采集共享 p |
| 关闭 points 共享后，两个私有层各有有效 p | 拒绝涉及 p 的采集，包括显式 session 调用 |
| c1 读取 safe，禁用 c2/c3 各有 dup | c1 正常采集，c2/c3 不读 |
| c1 读取 p，另一有效私有层也定义 p | 继续拒绝，不因另一个连接暂时禁用而放行 |
| 全批次没有启用连接 | 沿用无可用连接契约 |
| 启用目标一部分空、一部分有点 | 采集有点目标，空目标沿用既有时间戳行为 |

## 3. A：修复共享覆盖后的误冲突（P1）

### 证据

connections/points 共享开启；顶层 c1/d1/p 地址 0，私有层保留 p 地址 99。`043d81c` 正常读取共享 p，新版返回 `point:p(__shared__,a/c1)` 冲突。有效会话投影使用共享点，私有旧定义并未参与采集。

### 修改文件与逻辑

主文件：`src/application/modbus/poll-runtime-identity.mjs`。

- 将 `enumerateRawPointIdentities()` 改为明确的有效身份枚举流程。仍从原始行建立索引，但按 `isCategoryShared(share, 'points')`、分区状态及投影语义决定哪些层可参与同一槽位判断。
- points 共享有效时，同 ID 已由共享定义覆盖的私有备份必须排除；其他不可见私有行不得被当成本次共享目标。不要通过删除私有配置实现排除，它们仍需要保留供取消共享后使用。
- points 不共享且已分区时，采用有效私有层；旧的未分区工作区保留顶层读取兼容性。不要单凭 `__toplevel__` 标签忽略所有旧工作区定义。
- 身份记录使用结构化字段：`layer/sessionId/connectionId/deviceId/pointId/function/address`。直接构建规范化 tuple，不通过替换 JSON 字符串里的 owner 来比较。
- 删除目前无实际作用的 privateIdentities、几何字符串替换及相关未使用导出。不要扩大成通用配置框架。
- `projectModbusForSession()` 是 share 语义的对照来源；不要直接使用 union 后的结果做重复检测，因为 union 会隐藏真实重复。
- `unionScopedPoints()` 在其他地方还承担保存运行态的职责；本轮不全局改变 union 行为，避免误删隐藏配置的历史数据。

建议输出：`Map<pointId, IdentityRecord[]>`，同一共享定义只加入一次，不因多个会话可见而重复。

### 测试

新增 `test/devices/poll-runtime-shared-scope.test.mjs`：

1. 上述共享覆盖 fixture，批量和显式会话均正常读取地址 0，不能读取私有地址 99。
2. 两个私有层均保留同名旧 p，共享开启时正常；关闭 points 共享后，涉及 p 的调用恢复冲突检查。
3. master enabled=false、points=true 时仍属于未开启共享，不能仅看类别复选框。
4. 相同共享对象多会话可见不重复计数；交换私有层顺序不改变结果。
5. 未分区旧工作区正常，私有双胞胎旧回归继续拒绝。

集成用例必须断言请求地址、连接、返回值来源和冲突时 0 I/O，不能只检查 ok。

## 4. B：仅让实际执行目标触发预检（P2）

### 证据

c1 启用并读取 safe；c2/c3 禁用，但均定义 dup。`043d81c` 只读 c1，新版因 dup 冲突阻断整批。当前预检早于 enabled 过滤，`readPointIds` 实际收集了所有 preparedTargets。

### 修改文件与顺序

主文件：`src/application/modbus/polling-service.mjs`、`poll-runtime-identity.mjs`。

按以下顺序整理调用链，均在 transport/锁内执行采集之前完成：

```js
const ownership = resolvePollTargets(workspace, requestedTarget)
// 失败沿用现有归属错误
const prepared = prepareTargetViews(workspace, ownership.targets)
const executable = prepared.filter(t => t.connection?.enabled !== false && t.connection)
// 按既有规则处理无连接、全空、混合空目标
const readTargets = prepareReadTargets(executable)
const check = validatePollRuntimeIdentities(workspace, readTargets)
// check 成功后才进入锁、采集、统一 commit
```

- `prepareReadTargets` 复用实际轮询使用的过滤/读批次规则；不要新加 monitorEnabled、device.enabled 的不同解释。若当前某字段未参与过滤，不借本轮悄然改变它。
- 最好让预检和执行复用同一份准备结果，避免校验后执行阶段再扩大读取集合。空连接仍可保留在元数据更新集合中，但不加入 readPointIds。
- `batchHasPoints` 不再使用禁用连接上的点来认定整批可采集；无可用连接优先处理，再按现有契约区分全空和无可执行批次。
- `validatePollRuntimeIdentities` 输入类型明确为读取目标，不再将任意 preparedTargets 都称为“实际读取”。
- 不削弱跨层占槽检查：先从 readTargets 得到触及的 pointId，再查询 A 的有效身份索引。
- 不递归调用 modbusPoll，保留原锁、取消、预算、一次 commit 和 sourceSessionByConnection。

### 测试

扩展或单独新增 `test/devices/poll-disabled-runtime-conflicts.test.mjs`：

- c1 safe + c2/c3 disabled dup：成功，仅 c1 一次请求。
- 显式只读 safe 与批量读结果一致；交换连接及会话顺序一致。
- 将 c2/c3 启用后，冲突整批 0 I/O，不允许先读 c1 再报错。
- c1 读取 p、另一个有效私有层占用 p，即使对方暂时禁用仍按已确认规则拒绝。
- 全禁用、启用空目标加禁用非空目标、空/非空混合，检查错误和时间戳契约。

## 5. C：设备身份保存前校验与运行时关系保护（验收漏洞，实际会读错 unit）

### 已确认调用链

`device-model.mjs::normalizeDevices()` 按 deviceId 去重；`modbus-migration.mjs` 在点位规范化前调用它。`workspace-store.mjs::applyWorkspacePatch()` 当前在 normalizeWorkspace 后才 validateDevices，原始重复行此时已经丢失。

现有测试把 c1/d1/unit1 与 c2/d1/unit2 写在同一共享数组。保存后只剩 c1/d1，采集两条请求的 unitId 均为 1。不同地址产生不同值不能证明读了正确设备。

### 本轮固定策略

- **同一配置层内 deviceId 必须唯一**。同一数组提交两个相同 ID 即拒绝，不以端点、unit 或名称相同作为静默去重理由。修改已有设备仍通过替换原行/既有 edit 操作，不视为重复创建。
- **不同私有会话中的同名 deviceId 不自动判冲突**。必须证明其各自有效 pack、实际请求及提交/查询均正确；若某条按 deviceId 的路径仍会串设备，对受影响调用明确拒绝，不做全局复合键迁移。
- 点位的 deviceId 必须在该有效视图中唯一解析，且设备 connectionId 等于点位及当前请求的 connectionId。不得使用另一个连接的同名设备，也不得在这种错误下默认 unitId=1 继续发送。

### C1. 先修正验收用例

替换 `test/devices/poll-runtime-identity.test.mjs` 中“shared point visible twice ... same deviceId ... isolated”混合测试，拆为三个独立场景：

1. 共享点多会话可见：使用合法唯一 deviceId 验证共享行为。
2. 同层重复 deviceId：保存返回结构化错误，配置和 configVersion 未变化，原有运行态未变化。
3. 不同私有层同名 deviceId：A=c1/d1/unit1，B=c2/d1/unit2，点位 ID 不同且使用相同 function/address。断言保存后两个私有定义仍在；以注入 transport 按请求 unitId 返回不同值，验证真实路由，不依赖随时间变化的 sim 数值。

第三个场景同时检查显式会话、批量、相反插入顺序、帧 unitId、values 归属、趋势及会话查询结果。若失败，先定位错误发生在读取还是 commit/query，再选择精确拦截位置。

### C2. 原始配置写入前校验

新增 `src/domain/modbus/device-identity.mjs` 的纯函数，校验一个配置层的原始 device 行，返回重复 ID 和相关 connectionIds。返回值使用现有 ERROR_CODES.CONFLICT 与结构化 conflicts，避免只给一段无法解析的文本。

接入位置：

- `src/infrastructure/store/workspace-store.mjs::applyWorkspacePatch()`：构建原始候选拓扑后、normalizeWorkspace 前运行检查。如果该函数更早的分支已规范化/去重输入，检查必须前移到那些步骤之前；不能只插到末尾假装覆盖。
- `src/application/modbus/workspace-session-view.mjs::saveSessionModbusPatch()`：会话投影写回继续复用上述检查；直接导入 sessionConfigs 时，分别校验被修改的私有层，禁止把跨私有层同名 ID 当作同层重复。
- `src/application/config/config-connection-mutations.mjs` / `config-mutation-service.mjs`：核对新增、编辑、导入、批量配置及 share 发布入口；任何在公共检查前会去重的路径，应在去重前调用同一纯校验器。
- `config-scope-service.mjs::applyShareFlags()`：若发布/切换会把定义合并进同一层，在形成原始候选层时先检查，再保存。校验失败不更新 share、配置或版本。

校验面向本次变更的层和合并后的候选数组，不能让一个无关 focus/运行态更新因为旧隐藏配置而失败。失败必须返回现有调用链可以传播的 `{ok:false,errorCode,error,conflicts}`，不得直接抛出破坏 Host 的加载异常。

### C3. 已保存配置的采集保护

在 poll 的有效目标准备阶段增加设备关系检查（可复用 `device-identity.mjs` 的纯解析函数）：

```js
resolvePointDevice(targetPack, point, connectionId)
// 必须唯一命中 deviceId，且 device.connectionId === connectionId
// 不存在 -> DEVICE_NOT_FOUND
// 跨连接 -> TARGET_MISMATCH
// 多个定义 -> AMBIGUOUS_OWNER
```

完整批次都通过关系检查后才允许 I/O；复用已解析的设备生成请求，不再出现“预检正确、执行时按 id 找到另一行”的情况。既有合法旧配置的默认设备生成规则保持兼容，禁止对明确的跨连接引用静默补默认 unit。

旧磁盘数据经过加载去重可能已不可逆丢失原 unit2。本轮能阻止仍可检测到的跨连接引用，不能恢复已经丢失且不留矛盾的数据。错误提示应让用户重新指定唯一 deviceId 和正确 unitId；不自动重命名、不猜 unit、不重写用户设备拓扑。

同一设备解析器若被本轮触及的 read/write 入口复用，必须同时跑对应路由回归；不要为 poll 修复全局改变 stampPoints 的返回结构而遗漏调用方。

### C4. 验收矩阵

- 同层重复：同连接/不同连接、相同/不同 unitId、禁用行也保留 ID 唯一性；均在保存前拒绝。
- 私有层各自唯一且同名：要么证明隔离后放行，要么精确拒绝存在串味的路径；不允许两条请求都发到 unit1 后仍通过。
- 无关配置更新不受影响；唯一 ID 编辑正常；分享/取消分享不静默丢设备。
- 构造旧磁盘 fixture 时不能再用会规范化的 saveWorkspace 伪装原始重复配置。通过测试工厂的受控原始文件写入模拟，确保只写临时 workspace。
- 已损坏跨连接引用调用 poll：0 transport、0 frame、0 runtime commit；正确旧配置继续可读可采集。

## 6. D：小范围清理与提交门禁

清理 `src/application/modbus/alarm-notify-authorization.mjs` 末尾空行。移除身份模块中不再需要的字符串替换和未使用项，与所属行为修复一起完成，不开展无关重构。

新增生产模块按现有规则补 package files 和类型检查清单。保持结构预算，不扩白名单。测试按行为拆文件，不把所有场景追加到既有 250 行身份测试。

## 7. 实施顺序与提交划分

建议分四个可验收提交：

1. **A**：`fix(poll): ignore shadowed private point identities in shared mode`。
2. **B**：`fix(poll): validate runtime identities only for executable targets`。
3. **C1+C2**：`fix(config): reject duplicate device identities before normalization`，同时纠正伪通过的共享设备测试。
4. **C3+C4+D**：`fix(poll): reject mismatched device routing before I/O`，补私有设备隔离集成证据及格式清理。

每项先记录复现测试失败，再实现、转绿并提交；生产修复与对应测试同一提交。C2 与 C3 必须全部完成后才算 deviceId 项完成，不能只补一个 assert 就关闭问题。若私有同名设备证明不安全，将所需拒绝逻辑纳入第 4 个提交，不默认扩大到存储键迁移。

若源码在实施前已经变化，先记录新 HEAD 和 diff，核对本计划的复现是否仍成立，不覆盖他人改动。

## 8. 最终验证与交付材料

每组跑相关行为测试；全部合并后运行一次完整门禁：

```sh
npm run lint --silent
npm run typecheck --silent
npm run pack:check --silent
npm run build:check --silent
npm run test:unit --silent
git diff --check c5f1222..HEAD
git diff --check
```

提交范围和工作区差异都要检查；仅在干净工作区跑 git diff --check 无法发现已提交的空白错误。

交付必须给出：

- 最终 HEAD、四组提交、修改文件和对应新增测试。
- 共享覆盖场景：采集地址 0、无地址 99 请求；取消共享后真实冲突仍被拦截。
- 禁用场景：c1 实际请求记录，c2/c3 为 0；开启真实冲突后整轮为 0。
- 保存前重复设备校验的错误结果、保存前后配置/版本对比。
- 设备路由表：请求 connectionId、deviceId、unitId、address、返回值、提交后点位归属；分别列共享合法配置和私有同名配置。
- 最新单测总数及失败详情；只有断言原因与基线一致的三个失败可以继续记为基线。其余失败必须解决，不能改成 skip 或放宽断言。
- 明确未做真实硬件及安装验收；不得用 sim 全绿推导物理设备正确。

完成标准：两个新增回归消失，deviceId 测试能识别错误 unit 路由，保存和读取两层保护均有证据，前轮授权/趋势/生命周期测试无回归，所有静态与打包门禁及 diff 检查通过。
