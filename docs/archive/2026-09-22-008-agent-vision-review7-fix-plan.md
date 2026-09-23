# Vision Agent × 插件：第七轮 Review 修复计划

## 1. 基线与完成条件

基线为 `96c316c`。已确认上一轮的同连接多设备路由、真实 device.create 重复拒绝及 Agent conflicts 保留有效，不重做这些修复。

最近验证：lint、typecheck、pack:check、build:check、提交范围 diff 检查通过；单测 1502/1505。三个失败仍为 multi-conn-poll 两项及 frames-virtualizer 一项，日志 `/tmp/vision-review7-unit.log`。

剩余两项均为 P2：

1. share.update 在配置事务的作用域解析阶段提前去重，绕过原始候选层校验。
2. 有 sessionId 的共享设备冲突被标为 private，诊断指向错误配置层。

完成条件：原始双 d1 通过真实 mutation 事务也被拒绝；legacy claim 及共享发布/撤销语义不变；所有错误中的 layer/sessionId 指向实际目标层；无新增测试失败。

本文件是实施方案，不表示修复已经执行。路径相对于 `/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench`。不迁移运行态键、不恢复已经丢失的设备信息、不改变硬件连接、不修改 DSH 官方代码。

## 2. R1：share 在作用域解析之前保留原始候选（P2）

### 复现与根因

对同一份原始私有双 d1 fixture：

- 直接 `applyShareFlags(raw, sid, flags)` 返回 CONFLICT。
- 注入到 `createConfigMutationService` 的 repository 事务 current 后，share.update 的事务回调返回成功，设备数组仅保留第一条。

错误发生于 `config-mutation-service.mjs::resolveMutationScope()`：先调用 `claimLegacyPrivate()`，其第一步 `ensureScopeFields()` 就执行 normalizeSessionConfigs。即便 claimed=false，输入也已经去重。仅在 applyOperation 内跳过 normalizeModbus 不足以修复。

### 确定的实现方式

**share 分支必须在 claimLegacyPrivate 之前分流**，但不能直接删掉 legacy claim。对 share 操作提供“不去重的 claim 准备结果”，让现有 applyShareFlags 看到完整原始数组并执行候选校验。

建议在 `src/application/modbus/config-scope-service.mjs` 提取小型纯辅助函数：

```js
prepareRawShareMutation(modbus, sessionId)
// => { modbus: rawCandidate, claimed: boolean }
```

职责：

1. 复用现有 sessionId 规范化和 legacy claim 资格条件：没有 claim 标记、没有有效 session 分区、有可认领拓扑、sessionId 非空。提取共同的资格判断供现有 claim 和此函数使用，避免复制后语义分叉。
2. 判定 sessionConfigs 是否存在有效分区时，只做键/对象有效性判断；不得为了判定资格把 normalizeSessionConfigs 的去重结果替换回候选。无效键等兼容行为应与原资格判断一致。
3. 不需要 claim 时，保留输入各层原始 topology 数组，不调用 normalizeModbus/normalizeSessionConfig/ensureScopeFields，不裁剪条数、不按 ID 去重。
4. 需要 legacy claim 时，按原 claim 语义构造新对象：把顶层拓扑复制到当前私有层、清空顶层拓扑、使用原先的 share 重置规则、设置 claim 标记，保留运行态。复制的设备数组仍是原始行，不做 normalize。
5. 所有改动只存在候选对象中，不修改传入 current。候选校验失败时，claim 标记、配置、share 和版本都不落盘。

**`src/application/config/config-mutation-service.mjs::resolveMutationScope()`**

```js
if (scope === 'share') {
  const prepared = prepareRawShareMutation(current.modbus, sessionId)
  return {
    ok: true,
    workspace: { ...current, modbus: prepared.modbus },
    base: prepared.modbus,
    projected: false,
  }
}
// 其他操作继续使用原 claimLegacyPrivate / projectModbusForSession 流程。
```

上面的成功分支是示意：无 session、无效 operation 等既有错误仍按原契约返回，不用新默认会话掩盖错误。

**`applyOperation()`、`applyShare()`、`applyShareFlags()`**

- 保留上一轮 share 分支绕开 normalizeModbus 的改动；调用链从事务 current 到 applyShareFlags 捕获 raw 数组前，不允许再次替换为去重副本。
- 继续使用现有候选层检查逻辑：发布替换指定类别，撤销复制共享层到当前私有层；不能拼接所有会话制造不存在的冲突。
- 私有原始双 d1 发布时返回 CONFLICT；撤销时原始共享双 d1 同样拒绝。保留原先的撤销确认错误优先级。
- 只在原始候选检查成功后规范化并构造待保存 workspace。不同入口复用同一候选校验，不能在事务入口新增另一套发布规则。
- 无关 points/visualization share 变更不因为未涉及的其他会话设备备份而额外失败。
- `applyShareFlags` 直接调用仍沿用原有接口，不自动新增 legacy claim；claim 准备发生在配置事务入口，避免影响已有直接调用者。

### 回归测试：必须覆盖事务回调

新增 `test/config/share-transaction-device-identity.test.mjs`，使用现有 `createConfigMutationService({repositoryFactory})` 注入事务 current。

测试 repository 应：将未规范化 fixture 直接传入真实回调；记录回调返回值；只有 ok=true 才模拟提交和版本递增。不要 mock applyShareFlags 的结果，也不要先 saveWorkspace 构造所谓原始数据。

| 场景 | 断言 |
| --- | --- |
| 已分区，当前私有层双 d1，发布 connections | CONFLICT；事务不提交；设备定义、share、版本、输入对象不变 |
| 与上项相同，但 privateClaimSessionId 已有值 | 仍拒绝，证明 claimed=false 不再导致去重 |
| legacy 顶层双 d1、尚未认领，首次 share.update | 拒绝；不能先 claim 并丢掉第二条；claim 标记不落盘 |
| legacy 合法唯一设备，首次 share.update | 与基线正常 claim+发布的最终有效拓扑相同，设备、点位和 unitId 不丢 |
| 共享双 d1，撤销 connections 且 confirmed=true | CONFLICT；没有写入私有层或清空共享层 |
| 撤销但未确认 | 维持既有确认错误，不新增确认流程 |
| 共享旧单 d1 被私有新单 d1 替换 | 成功，候选层只有新定义，不误判重复 |
| 无关会话双 d1，本次只发布合法当前层 | 不因无关层重复误拒绝 |

另外用真实临时 repository 验证合法旧工作区的首次发布/撤销和版本行为。该正常路径可以经 saveWorkspace；原始重复 fixture 不可以。

错误还需经 mutateConfig 返回包装及 Agent projection 检查，至少包含 errorCode、conflicts、deviceId 和连接定位字段。继续保留 applyShareFlags/applyShare 的已有直接测试，不能用新测试替换掉正常路径覆盖。

## 3. R2：冲突层由实际写回目标决定（P2）

### 复现与根因

connections 共享有效，s1 创建重复 d1，正确返回 CONFLICT，但 conflicts 为 `{layer:'private', sessionId:'s1', ...}`。原因是 validateMutatedDeviceLayer 仅凭 sessionId 非空判 private。

### 固定字段语义

| 实际写回目标 | layer | sessionId |
| --- | --- | --- |
| connections 共享有效 | shared | 空字符串 |
| connections 未共享，操作写回当前私有层 | private | 规范化后的当前 sessionId |
| 未分区旧顶层、无会话写入 | top | 空字符串 |
| share 发布后的共享候选层 | shared | 空字符串 |
| share 撤销后的当前私有候选层 | private | 当前 sessionId |

conflicts.sessionId 表示拥有该私有层的会话，不表示操作发起者。共享发布来源如确有诊断需要，可新增明确的 sourceSessionId，但不能塞进 sessionId 改变含义。本轮不必新增该字段。

**`config-mutation-service.mjs::validateMutatedDeviceLayer()`**

- 继续校验 `applied.workspace.modbus.devices` 的操作后未去重候选数组，不回头检查旧 sessionConfigs。
- 使用 `isCategoryShared(modbus.share, 'connections')`，同时考虑 master enabled 和 category flag，不能只检查 share.connections。
- 更稳妥的接口是由 resolveMutationScope 返回本次设备写回上下文 `{layer, sessionId}`，成功操作后传给校验器。该上下文与 fold 的实际目的层一致，而非根据 scope 字符串猜测。
- share 操作的候选校验由 applyShareFlags 负责；不要再次用顶层默认标签覆盖其冲突，或把隐藏私有层拉进通用检查。
- 不改变错误码 CONFLICT 和正常操作行为；本项主要修正诊断归属。

**`config-scope-service.mjs::applyShareFlags()`**

发布时对原始私有来源数组检查，但其候选目标层为 shared；校验上下文应标记 shared/空 session。撤销复制进私有层时才标记 private/sid。结构化错误应描述哪个结果层无法合法保存。

### 回归测试

扩展 `test/config/device-identity-mutations.test.mjs`，并给 share 事务测试补出口断言：

- shared=true、connections=true、带 sessionId 的重复创建：shared/空 session。
- master=false、connections=true：按私有层处理，不能误报 shared。
- connections=false、其他类别共享：仍是 private/sid。
- 无 session 的合法旧顶层重复创建：top/空 session。
- share 发布/撤销错误分别报告 shared 与 private。
- 对每例验证配置版本和设备数组不变；错误经过 attachConfigDriftRefresh、config handler/Agent projection 后层信息仍正确。

## 4. 实施顺序与提交

建议两个提交，各带对应行为测试：

1. `fix(share): preserve raw topology through mutation scope resolution`
2. `fix(config): report device conflicts against the actual target layer`

先在 `96c316c` 重现两个失败：事务入口接受原始双 d1、共享冲突误标 private；再修复转绿。保留已经通过的普通设备路由、duplicate create、共享覆盖、禁用连接、通知和趋势用例。

若提取小型 helper 导致新生产文件，补齐 package files/typecheck 清单。遵守结构预算，不扩大白名单，不顺带改变 point/device ID 规则或进行存储迁移。

## 5. 验收门禁与证据

完成针对性测试后执行一次完整门禁：

```sh
npm run lint --silent
npm run typecheck --silent
npm run pack:check --silent
npm run build:check --silent
npm run test:unit --silent
git diff --check 96c316c..HEAD
git diff --check
```

structure/assertions 按当前 package.json 中实际脚本执行并记录。三个已知失败只在断言位置与原因仍一致时继续归为基线；其余失败必须处理，不改 skip 或放宽断言。

交付报告必须提供：

- 最终 HEAD、两个提交、工作区状态。
- 原始双 d1 在直接函数和真实 mutation 回调中的结果对照：两者均拒绝；事务 commit 次数为 0。
- 合法 legacy claim+发布的前后拓扑、设备 unitId、版本增量，证明没有因前移校验而破坏兼容。
- shared/private/top 三类实际错误 JSON；share 发布与撤销的目标层 JSON。
- 配置、share、privateClaimSessionId 和 configVersion 在拒绝前后不变的证据。
- 新单测总数、基线失败原因、全部门禁结果。

限制明确保留：此修复保护事务 current 中仍存在的原始定义；不能恢复 repository 更早已去重或历史保存已丢失的设备信息。未执行真实硬件、Web/Desktop 安装验收，不把模拟/事务测试通过外推为这些验收已完成。
