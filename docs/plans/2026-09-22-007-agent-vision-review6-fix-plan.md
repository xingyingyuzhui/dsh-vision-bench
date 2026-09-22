# Vision Agent × 插件：第六轮 Review 完整修复方案

## 1. 基线与交付目标

基线：`a972a8d`，工作区干净。最近全量测试 1492/1495，三个失败仍为 multi-conn-poll 两项和 frames-virtualizer 一项；lint/typecheck/pack/build/提交范围 diff 检查通过。全量日志 `/tmp/vision-review6-unit.log`。随后再次独立复测，下述三个问题仍可复现。

本轮完成三个行为修复及相应调用链，不重做前轮正常工作的共享影子过滤、禁用目标过滤、通知授权/epoch 或趋势预算。继续保持：不迁移运行态键，不放行真实 pointId 冲突，不修改 DSH 官方包，不自动猜测旧设备的 unitId。

本文仅新增修复方案，不修改生产代码、不创建提交。文中路径相对于 `/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench`。

| 项目 | 当前实测 | 修复后要求 |
| --- | --- | --- |
| R1：同连接多设备 | c1 的 d1/unit1、d2/unit2 都请求 unit1；第二个值却标为 d2 | 每个 scope 使用自己的设备，预检与执行使用同一解析结果 |
| R2：配置命令创建同层重复设备 | device.create 返回成功，版本 2→3，新设备被丢弃 | fold/normalize 前返回 CONFLICT，配置与版本不变 |
| R3：共享发布重复定义 | 私有双 d1 先被去重，再发布成功 | 原始候选层在去重前校验，错误及 conflicts 传到命令出口 |

## 2. R1：按当前读批次绑定设备，移除兜底发送（P1）

### 根因

`src/application/modbus/polling-service.mjs:264` 在遍历 scopes 时，使用整条连接的 `pts[0]` 解析设备。只要第一个点设备合法，后续所有设备 scope 都得到同一个 device；请求的 unitId 被错误覆盖，scatter 仍按原 scope.points 写回，形成“从 d1 读到的值归到 d2”。

仅把 pts[0] 改成 scope.points[0] 能修直接症状，但仍留着执行阶段重新解析和失败兜底。本轮应完成前轮约定：全部目标先解析完成，再按同一份结果执行。

### 修改文件与接口

**`src/application/modbus/poll-target-preparation.mjs`**

将 `validateDeviceRouting()` 的只返回布尔结果改为返回准备好的执行计划，建议名 `preparePollReadPlan(executable)`。保持 prepareTargetViews/prepareReadTargets 的有效视图与 enabled 规则。

建议类型：

```js
// PreparedReadScope
{
  connection,       // 当前目标的连接对象
  device,           // 该 scope 的已验证设备对象
  connectionId,
  deviceId,
  unitId,
  points,
  batches,
}
// 成功
{ ok: true, targets: [{ ...preparedTarget, scopes: PreparedReadScope[] }] }
// 失败：不附带可执行的部分 targets
{ ok: false, errorCode, error, reason: 'device-routing', conflicts }
```

算法：

1. 遍历每个有效目标的点，调用 `resolvePointDevice(target.pack, point, target.connectionId)`；任何错误整轮返回，尚未创建 transport、提交运行态或发送通知。
2. 用已解析 device.unitId 为该点生成采集副本，再调用既有 `planScopedReadBatches()`，保持 function/address 合并规则不变。不修改原始点位配置。
3. 使用结构化 key 或固定字段 JSON tuple，把 scope 绑定到当前目标中已解析的 device，不能用不转义的字符串拼接，也不能取全连接的第一个点。
4. 每个 scope 验证 `scope.deviceId === device.id`、`scope.connectionId === connection.id === device.connectionId`，unitId 与该设备一致。缺失或不一致作为准备失败。
5. 空连接保留空 scopes，继续走现有轮询时间戳行为；点位运行态冲突检查使用这份计划对应的读取集合，保留原先的保守策略。

**`src/application/modbus/polling-service.mjs`**

- 在任何 I/O 前取得整个 batch 的 prepared plan，并完成 pointId 冲突检查。
- 主循环直接遍历计划中的 scopes，向 `runReadTx` 传 `scope.connection`、`scope.device` 和该 scope 的 batch。
- 删除 `pts[0]` 路由、执行循环内 `devices.find(...)` 及 `{id,unitId}` 兜底；准备失败后禁止继续发送。
- 以 scope.points scatter，帧里的 deviceId/unitId 必须与实际请求一致；不改变锁、取消、预算或统一 commit 边界。
- 不全局修改 stampPoints 的契约。若 poll 不再需要该函数，清理此处未使用 import 即可。

### 必须新增的行为测试

扩充 `test/devices/poll-device-routing.test.mjs`，超过结构预算时按路由场景拆分：

- **同连接、两设备、同地址**：c1/d1/unit1/p1@0 与 c1/d2/unit2/p2@0；注入 transport 返回 `unitId * 1000 + address`。断言请求 `(c1,d1,1,0)`、`(c1,d2,2,0)`，p1=1000、p2=2000，磁盘 values、frames、trend 归属一致。
- 将点位数组和设备数组分别倒序；结果只允许顺序变化，不允许设备和值交换。
- 同设备多个相邻点仍合批；另一设备同地址独立批次；覆盖多个 function scope，避免只验证第一批。
- 不同连接、不同私有会话同名 d1 保留前轮正确 unit 路由，并验证提交后的会话查询结果。
- 第二个目标才出现设备错误时，整个 batch 的 transport read 数为 0，values/frames/trend/alarmState/pollingByConnection 不变。
- 缺失设备、跨连接引用、多重设备定义在准备函数的原始 fixture 中都返回具体错误；集成错误 fixture 不得被测试工厂提前修正而掩盖问题。

## 3. R2：在真实配置命令事务内拦截重复设备（P1）

### 根因

`applyWorkspacePatch()` 的校验没有覆盖 `mutateConfig → applyDevice → foldModbusFromSession → repository`。`validateWorkspaceConfig()` 只做既有字段/连接验证，不能代替同层 ID 唯一性验证；fold 中 normalizeSessionConfig 会去重。

### 插入点

**`src/application/config/config-mutation-service.mjs`**

在事务回调中按以下顺序执行：

```js
const applied = await applyOperation(...)
if (!applied.ok) return applied

// 检查原始操作结果；此时不得 fold 或 normalize 它。
const identity = validateMutatedDeviceLayer(applied.workspace, mutationContext)
if (!identity.ok) return identity

const errors = validateWorkspaceConfig(applied.workspace)
if (errors.length) return configInvalid(errors)
if (scoped.projected) {
  applied.workspace.modbus = foldModbusFromSession(...)
}
// 成功后才能 stampTimeline / 安排 postCommit / 返回待保存 workspace。
```

建议 `validateMutatedDeviceLayer` 放在已有 device-identity 模块或小型配置校验模块，不复制计数逻辑：

- 复用 `validateLayerDeviceIds()` 检查操作结果中的未去重 devices。
- 会话有效投影下，connections 共享开启则标记 shared；否则标记 private 并携带 sessionId；未分区顶层标记 top。不要把投影中的所有私有会话列表当成本次被修改层。
- 只针对实际改变/发布的设备层校验，不让纯点位、focus、运行态或其他会话的无关更新因为隐藏旧配置失败。
- 对 device.create/update/remove 等操作使用同一候选层校验；正常更新原行并不重复，create 一个现存 ID 必须拒绝。不要让 disabled 或相同 unitId 成为重复 ID 例外。
- 在会规范化结果的配置操作中，必须进一步把检查放到该操作内部首次去重前；share 单独按 R3 处理。

错误固定为现有结构：

```js
{
  ok: false,
  errorCode: 'CONFLICT',
  error: '同一配置层 deviceId 必须唯一…',
  conflicts: [{ layer, sessionId, deviceId, connectionIds }],
}
```

失败不得增加 configVersion，不得写“添加成功”的日志/时间线，不得触发 postCommit 副作用。沿用 Host 既有失败操作记录约定，不能把失败操作伪装成成功。

**保留公共保存校验**：`workspace-store.mjs::applyWorkspacePatch()` 仍需保护 saveWorkspace/saveWorkspaceAsync/saveSessionModbusPatch，不能因为加了命令入口校验就删除它。原始 sessionConfigs 导入继续逐被修改层检查，跨私有层同名设备不自动判重复。

### 回归测试

新增 `test/config/device-identity-mutations.test.mjs`，必须走真实 mutateConfig；至少一个用例走 `runVisionBench` 的 config 命令：

1. 私有会话已有 c1/d1，创建 c2/d1：CONFLICT，conflicts 指向会话和两连接，版本/配置不变，新设备不被静默丢弃。
2. 共享配置相同场景也拒绝；两个私有会话各自一个 d1 合法。
3. 更新已有 d1 的合法 unitId 正常成功；唯一 d2 创建正常；同层完全相同的重复 create 仍拒绝。
4. 设备 disabled 不绕过唯一性；名称/连接/单位相同不能把重复创建当幂等成功。
5. 对比事务前后 workspace 的配置、版本、运行态，以及成功事件/副作用调用；不只检查返回码。
6. 原公共保存路径的重复拒绝仍通过。若存在批量操作入口，覆盖 update/add 后最终候选层重复的情况；不为测试新增生产批量 API。

## 4. R3：共享候选层先校验后规范化，并保留错误信息（P2）

### 根因与额外遗漏

`applyShareFlags()` 一进来就 `ensureScopeFields(modbus)`，其中 normalizeSessionConfigs 会去重；后面的候选层检查已经没有原始双 d1。此外，`config-share-mutations.mjs::applyShare()` 的失败封装遗漏 conflicts；即使底层拒绝，调用者也拿不到结构化诊断。

### 修改流程

**`src/application/modbus/config-scope-service.mjs::applyShareFlags()`**

1. 对 sessionId、share flags、发布/撤销类别按现有规则解析。保留撤销共享的既有确认顺序，不新增确认流程。
2. 在调用会去重的 ensureScopeFields/normalizeSessionConfigs 前，保留传入 modbus 的原始顶层拓扑和当前 session 原始拓扑。不要用 normalizeSessionConfig 构造这些副本。
3. 从原始数组按既有 withCategory 规则构造候选 shared/private 层：发布是替换指定类别，不改为拼接所有会话；撤销沿用现有复制并清空规则。
4. 校验本次实际改变设备拓扑的结果层，先 validateLayerDeviceIds，成功后才进行规范化和最终保存对象构造。不要扫描并阻断无关会话的隐藏重复。
5. 失败返回 CONFLICT 和 conflicts，不修改传入对象、share、配置或版本。合法的旧共享 d1 被新的合法私有 d1 替换，不应误判成“双 d1”。

**`src/application/config/config-mutation-service.mjs::applyOperation()`**

当前入口先 normalizeModbus(current.modbus) / normalizeWorkspace(current)，再分派 share。核对并调整 share 分支，让共享操作获得当前事务可用的原始层级数据，而不是已去重副本；或在首次规范化前完成同一套原始候选检查。不要在两个入口复制不同的发布规则。

注意：repository 加载时已经丢掉的原始行无法由 applyShareFlags 恢复。必须区分“此调用收到的原始重复数组”与“磁盘更早已经丢失的信息”，不以本轮修复宣称自动恢复旧设备。旧磁盘不修改；保留前轮跨连接引用的运行前保护。

**`src/application/config/config-share-mutations.mjs::applyShare()`**

失败返回保留 `errorCode/error/conflicts`，同时保留原有 `needsConfirm/revoked`，不将整个输入 workspace 暴露给 Agent。核对 config handler 及 Agent 结果投影最终仍保留 conflicts；若最终输出契约有摘要预算，用受限的冲突摘要，不静默丢掉全部定位字段。

### 测试层次

- 纯函数：向 applyShareFlags 传私有原始双 d1，发布必须拒绝；传入对象深比较不变。这个 fixture 不得通过 saveWorkspace 预先规范化。
- 撤销连接共享后若实际候选私有层出现重复，也先拒绝；缺确认时维持既有确认错误契约。
- 替换语义：共享层一个 d1，发布层一个 d1，发布正常；不要把被替换旧层拼入候选后误报。
- 无关层重复且本次只改 visualization/points share，不额外阻断设备未变化的操作。
- applyShare 封装测试：错误 conflicts 不丢失；使用真实底层原始 fixture，避免只 mock 返回值。
- 命令边界测试：通过注入支持的 repository fixture 向 mutateConfig 提供原始层级数据，验证规范化之前就拒绝、版本不变。使用项目现有依赖注入，不为测试提供绕过生产校验的公共接口。
- 至少一个端到端输出测试检查 config handler/Agent projection 的 conflicts 字段，不能只看到底层辅助函数返回正确就验收。

## 5. 提交顺序与验证纪律

建议三个独立提交，每项包含修复和对应回归测试：

1. `fix(poll): bind each read scope to its validated device`：R1，先修真实读错从站问题。
2. `fix(config): validate device identities before folding mutations`：R2，补真实命令入口。
3. `fix(share): validate raw publication candidates and preserve conflicts`：R3，包含错误传递。

每组先让本方案复现测试在 a972a8d 上失败，再修复转绿；不通过跳过测试、改变预期值、仅提高预算来通过。设备路由使用 deterministic transport，按请求 unitId/address 返回结果，不依赖模拟随机/时间值。

保留结构预算；如新增生产文件，更新 package files 和类型检查清单。不要改动已经通过的前三轮修复历史。未提交他人改动出现时先核对范围，不覆盖。

## 6. 最终门禁与交付证据

每组跑直接相关测试，全部完成后运行完整门禁：

```sh
npm run lint --silent
npm run typecheck --silent
npm run pack:check --silent
npm run build:check --silent
npm run test:unit --silent
git diff --check a972a8d..HEAD
git diff --check
```

structure/assertions 检查按 package.json 现有脚本执行并记录，不虚构命令或以其他门禁替代。三个既有失败只能在断言位置与原因仍一致时归为基线，其余必须修复。

交付报告提供实际数据，而非只列“测试全绿”：

- 最终 HEAD、三项提交及工作区状态。
- 同连接多设备实际请求表：connectionId/deviceId/unitId/address，以及提交后的 pointId/raw；明确 d2 请求 unit2，p2=2000。
- 重复 device.create 的真实命令输入、CONFLICT 输出、conflicts、操作前后 configVersion 与设备数组；版本应保持不变。
- 原始双 d1 发布的错误、输入未变证据及命令出口 conflicts。
- 全量测试总数/失败原因、各门禁结果与提交范围 diff 结果。
- 说明未做真实硬件、Web/Desktop 安装验收；保留旧设备信息不可恢复的限制。

验收标准：三个复现均在正确调用层被测试覆盖；预检和执行不再选不同设备；新设备不再被成功响应掩盖后静默丢弃；发布不再先去重再验证；错误诊断完整到达 UI/Agent；前轮共享/禁用/通知/趋势测试没有回归。
