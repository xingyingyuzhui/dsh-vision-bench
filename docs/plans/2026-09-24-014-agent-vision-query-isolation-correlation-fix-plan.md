# points get/list 运行值隔离与 Host 异常关联：深入代码级修复计划

## 1. 基线与边界

审查基线 `8205d68`。已跑全量单测 1635/1635；lint、typecheck、pack、build、structure、assertions、提交范围 diff 检查通过。日志 `/tmp/vision-feedback-review-unit.log`。

工作区已有 CHANGELOG.md、client.js、docs/VISION_DSH_COMPAT_BASELINE.md、package.json 修改和两份未跟踪计划，均不是本轮产生；不得覆盖或混入提交。实施前重新核对 HEAD/status。

本轮只修两项已复现缺陷：

- A：points get/list 返回当前会话的点位定义，却拼上另一会话同 pointId 的运行值。
- B：进程内 Host throw/reject 绕过工具 finish；直接客户端处理 null 等无效响应时丢 commandId。

不迁移全局运行态键、不自动修改旧数据、不更改设备、不新增自动重试、不把未知写入结果说成未执行。所有相对路径均基于 `/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench`。

## 2. A 的证据及数据流

fixture：A=c1/dc1/p，B=c2/dc2/p；全局 values 中保存 `{pointId:'p',connectionId:'c2',deviceId:'dc2',raw:9876,value:9876,ok:true}`。

A 调用 getPoints(ids:['p']) 返回 `{id:'p',connectionId:'c1',deviceId:'dc1',raw:9876,value:9876,ok:true}`。点位定义经过会话过滤，但运行值没有。

当前链路：

```text
loadWorkspace
  → normalizeQualifiedValues(global values, union points)
  → modbusForSession / projectModbusForSession
  → visible points
  → compactPointRow(point, pack.values)
       └ find(item.key === point.id || item.pointId === point.id)
```

关键约束：`normalizeQualifiedValues` 会给缺失 connectionId/deviceId 的旧记录补当前点位字段；因此“字段现在齐全”不能证明它原来有可靠来源。全局值仍只占一个 pointId 槽位，即使两个私有定义的连接、设备字段完全相同，也不能据此确定是哪一个会话的值。

## 3. A：判定契约

点位定义和运行值分开处理。合法可见点的配置仍可查询；值不可信时隐藏值，不把点位伪装成不存在，也不整批拒绝其他安全点。

| 情况 | 运行值行为 |
| --- | --- |
| pointId 有唯一有效归属，记录的 pointId/connectionId/deviceId 与点一致 | 可返回该值 |
| pointId 相同但 connectionId 或 deviceId 不匹配 | 隐藏值 |
| 多个有效私有定义共享同一 pointId | 隐藏值，即便三元组相同、调用显式带 sessionId |
| 同一共享定义对多个会话可见 | 算一个对象，允许匹配值 |
| 私有旧定义被当前共享定义覆盖 | 不作为额外有效归属，沿用已验收的共享覆盖规则 |
| 没有运行记录 | 返回无值状态 |
| 来源已在历史规范化中丢失且无法可靠区分 | 不声称恢复来源；可检测歧义按上述规则隐藏 |

唯一有效点的旧记录可保持既有补字段兼容，但不得以补字段结果解开跨私有层歧义。本轮不解决历史删除后同 ID 重建、同设备更改地址等所有代际追踪问题；不宣称这些旧数据已被验证为最新采集。

### 输出契约

保持 points/requested/returned/missingIds/partial 的“配置查找”含义不变。可见点因值被隐藏仍计入 returned；partial 仍只表示部分点未找到。

get/list 每条点必须包含有界状态字段 `valueStatus`；类型、Agent 投影及预算裁剪必须保留：

- `available`：该值通过当前身份检查；不等同于新鲜值，继续看 at/既有 stale 语义。
- `missing`：没有可用运行记录。
- `unavailable`：有记录但无法安全归属。

隐藏时固定 `raw:null, value:null, ok:false, at:0`，不返回该记录的 error、来源连接、来源会话、时间或其他值细节。外部不给 `owners` 或隐藏会话数量，避免从诊断泄露其他会话拓扑。内部纯函数可返回 mismatch/ambiguous 等 reason 供测试，不必暴露给 Agent。

## 4. A：代码改动

### 4.1 共用有效身份规则

主参考：`src/application/modbus/poll-runtime-identity.mjs` 的 identitiesForPoint 和共享覆盖规则。

提取最小只读身份解析器到合适的小模块（例如 `effective-point-identity.mjs`），让 poll 校验与 query 复用规则，不另写一套 share/私有层算法。接口建议：

```js
resolveEffectivePointIdentity(modbus, pointId)
// { kind: 'unique' | 'ambiguous' | 'missing', identities: [...] }
```

- 输入必须是包含所有有效层的工作区 modbus，不能只传投影后 pack。只看当前会话会漏掉同槽位其他私有归属。
- 不能先 union 去重再统计；不能将相同设备几何位置的两个私有 owner 合并。
- 与已验收规则保持一致，新增查询修复不改变 poll 的允许/拒绝结果；用既有共享/禁用/双胞胎测试验证。
- 如原身份 helper 的导出已足够且不会违反层次，可直接复用，不为抽象而大拆模块。

### 4.2 安全选择运行记录

新增纯函数 `selectPointQueryValue({workspaceModbus, point, values})`，放 application query 层或独立 query-value 模块：

1. 先判断 pointId 是否只有一个有效身份；有歧义立即 unavailable。
2. 验证唯一有效对象与当前可见 point 的 connection/device 定义一致。
3. 找该 pointId 的运行记录，检查 connectionId/deviceId 与 point 一致。不要直接重写记录上的来源字段以“修复”不一致。
4. 检查通过返回 record，否则返回无值状态；多个候选来源不一致时也拒绝，不选第一个。
5. 不写 workspace，不删除或清理全局 values，不触碰其他会话的运行态。

### 4.3 在 get/list 输出前接入

`src/application/modbus/point-query-service.mjs`：

```js
const selected = selectPointQueryValue({
  workspaceModbus: viewSource.modbus, // 仍含全部层，legacy 仅内存 claim
  point: hit,
  values: workspace.modbus.values,
})
const row = compactPointRow(hit, selected.record ? [selected.record] : [])
row.valueStatus = selected.status
```

确保任何重新 normalize/project 后的字段填充都不能绕过先行的全局歧义判定。若实际加载流程已丢失原 provenance，按第 3 节的保守边界处理，不为本轮直接读取磁盘 JSON 绕过 repository。

`src/domain/modbus/point-value.mjs::compactPointRow`：本轮优先传入已筛选的一条或零条记录，避免直接改全局 helper 行为造成其他视图回归。清楚标注 get/list 调用者负责身份校验。`point-service.mjs` 的 list 分支复用相同选择器；保留其既有过滤、排序与分页。status/read 的其它输出另列 FOLLOWUP-014-01 审查，不宣称本轮已实现所有读取接口隔离。

更新查询返回类型和工具说明：配置存在不意味着一定有可归属的值；valueStatus=unavailable 应提示先确认唯一点位身份，不能触发自动改名、采集或写设备。

### 4.4 测试

新增 `test/agent/points-get-value-isolation.test.mjs`，用临时 workspace 和真实 handler/工具链：

1. 已复现 A/B 同 pointId、不同 connection/device、全局值来自 B：A 返回自身定义但 raw/value=null、ok=false，不带 B 的 at/来源。
2. 将会话插入顺序、values 顺序反转，仍不泄露；不能只靠恰好 first-wins。
3. 两私有层的 pointId/connectionId/deviceId 完全相同：仍 unavailable，显式 sessionId 不能解开全局槽归属。
4. 单一有效点且三元组匹配：正常返回值及时间；连接或设备不匹配分别隐藏。
5. 同共享对象多会话可见：合法匹配值返回；被共享覆盖的私有备份不制造假歧义。
6. 缺 provenance 的旧记录加双私有定义，经真实 save/load/normalize 后仍隐藏，防止补字段造成假确定性。
7. 安全点/无值点/歧义点/不存在点混合查询：计数、missingIds、partial 不被 valueStatus 改乱。
8. 调用前后配置、版本、claim、values/frames/trend 不变；无 transport、无告警订阅变化。
9. 通过 visionBenchTool.execute → 实际 Host dispatcher → projection 验证最终 JSON 没有被隐藏的值及来源细节，保留 commandId。

## 5. B：Host 结果在统一边界完成安全转换与关联

### 根因

`vision-host-client.mjs::dispatchHostCommand` 对进程内 `registered.handle.dispatch(input)` 直接 await，无异常转换。工具端 `finish(await dispatchVisionCommand(...))` 的 await 一旦 reject，finish 不会执行。

null/circular 等结果经 finalize/losslessCommandResult 生成 HOST_INVALID_RESPONSE，但该转换没有命令上下文；直接客户端调用就丢 ID。工具最后补 ID 只能补救一部分路径。

### 固定错误语义

- 没有可用 Host：保持 HOST_UNAVAILABLE。
- Host 返回无效命令结果：HOST_INVALID_RESPONSE。
- dispatch 同步 throw 或 Promise reject：建议新增 `HOST_DISPATCH_FAILED`，避免误称“Host 不存在”或“参数缺失”。本轮统一登记在 command-contract 及相应类型/错误说明。
- 若调用在发出前已取消：cancelled=true，原 ID，0 dispatch。
- 已发出后 abort/timeout/异常：保留可区分的取消或超时语义，但**不声明未执行**；尤其 write/build 等操作可能已开始，不自动重试。
- 所有外部错误不带 stack、不直接拼接任意异常 message，不将路径/凭据带给 Agent。保留既有安全内部诊断机制；没有合适 logger 时不新增散乱 console 输出。

新增 HOST_DISPATCH_FAILED 是边界异常封装，不把编程错误伪装成业务参数错误；测试必须验证异常没有被标为成功。

### 5.1 统一 finalize 的顺序

建议在 Host client 或独立的小型结果模块实现：

```js
finishHostResult(cmd, rawResult, source)
// 1. 对 rawResult 做无损 JSON 转换/有效结果检查
// 2. 将无效原始返回转换成 HOST_INVALID_RESPONSE
// 3. 与 cmd 关联，保证 commandId/action
// 4. 按 source compact/finalize
// 5. 若最后转换再失败，用同一 cmd 构造最小可序列化错误
```

必须先判断原始结果，不能先 `envelope(cmd, null)`：后者会把非法返回包成普通对象，掩盖 HOST_INVALID_RESPONSE。

复用 losslessCommandResult/toLosslessJson，不改变整个系统的通用转换规则。null/undefined/primitive/array/circular 无效；成功或业务失败响应应符合对象命令契约，ok 为 boolean。已有容许的普通 JSON 清洗行为保持一致，并通过真实 Host 测试确认不会误拒绝现有正确响应。

响应缺 commandId 时补 cmd.commandId；响应带不同非空 commandId 时返回本次 ID 对应的 HOST_INVALID_RESPONSE，不把别的请求成功结果冒认成本次结果。相同 ID 原样保持。

错误对象至少包含 `ok:false,errorCode,error,commandId,action`；无效响应时不附原始 body。已经合法的 refresh/conflicts/missingFields/hint/idempotent 等不能被重新封装丢弃。

### 5.2 dispatchHostCommand 接入

- normalizeCommand 只在入口分配或接收 ID，所有分支复用 input。
- 用 try/catch 包住同步调用和 await 的进程内 dispatch，将异常构造成 HOST_DISPATCH_FAILED 后走 finishHostResult。
- HTTP 分支返回也统一走 finishHostResult；无效 JSON、HTTP 状态失败与网络超时继续用现有码，但需保留上下文和不泄露原始错误内容的约束。
- Host 未注册、requireHost=false、执行前取消也走同一出口。不要因为“统一边界”增加本地执行 fallback。
- 不新增 in-process 竞争超时后重发操作；未完成 dispatch 的超时/取消语义另有现有契约，本轮只保证可关联的结果。
- 共享 debug 调用也会经过此客户端：跑 vision_debug 现有测试，检查 action 与 commandId 不被 vision_bench 规则改坏。

### 5.3 Agent execute 和幂等边界

客户端修复后，工具 finish 继续负责 refresh/project/finalize。检查重复 envelope 后 ID 和结构化字段不变；避免只在工具加 catch 而让直接 Host 客户端仍裸 reject。

不修改 command-idempotency-cache 的 fingerprint、键或重放策略，不声称命令 ID 等于 exactly-once。未预期 dispatch 失败必须让调用方知道结果未知；禁止自动生成新 ID 重试写入。缓存 rejected promise 的后续治理若出现独立问题，另列，不借本轮改动执行次数语义。

### 5.4 测试矩阵

新增或拆分 `test/agent/host-result-correlation.test.mjs`：

- 注册 Host 同步 throw、异步 reject，分别调用 dispatchVisionCommand 与 visionBenchTool.execute：返回可序列化错误、原 ID、无 stack/原始异常敏感内容，dispatch 次数恰为 1。
- Host 实际返回 null/undefined/string/array/circular，而非手工返回预制 HOST_INVALID_RESPONSE：客户端和工具均报告无效响应且保留 ID。
- Host 返回合法业务错误但无 ID：客户端补 ID；带同 ID 保留；带不同 ID 拒绝错配。
- 显式 ID、缺省生成 ID、取消前、网络超时路径；生成 ID 与 Host 收到 ID 完全相同。
- CONFIG_DRIFT refresh、CONFLICT conflicts、TARGET_REQUIRED missingFields/hint 均不丢。
- 正常同键重放及不同参数 COMMAND_ID_REUSE 仍通过，不增加执行次数。
- HTTP 测试使用临时 loopback server 或现有 fetch 注入，真实返回无效 JSON/空 body，禁用真实外网与用户 Host。进程内和 HTTP 两条路径分别验证。
- vision_debug 通过公共客户端的正常及失败响应仍有正确 debug action 和原 ID。

当前测试用“Host 返回一个自带 commandId 的错误对象”代替异常/无效响应，只能证明透传。可以保留，但不能替代以上触发真实转换路径的测试。

## 6. 提交、门禁与交付

建议两项独立实现提交：

1. `fix(points): isolate runtime values in scoped point queries`
2. `fix(host): correlate dispatch failures and invalid responses`

每项先记录基线失败复现，再实现转绿；不把字段改为 undefined 以规避泄露断言，不 mock 被测安全函数。新增生产模块同步 package files/typecheck 列表，不扩大结构预算白名单。现有未提交发布改动保持不变，重叠文件只合入必要增量。

完成后运行 lint/typecheck/pack:check/build:check/structure:check/assertions:check/test:unit，以及 `git diff --check 8205d68..HEAD` 和工作区 diff 检查。当前基线已全绿，不能沿用早期“三个已知失败”豁免任何失败。

交付证据必须包含：

- 值隔离表：当前会话点身份、存储记录身份、最终 raw/value/ok/at/valueStatus；双私有同三元组也要列。
- 调用前后配置、运行态、版本与 claim 未变化。
- 直接客户端和 Agent 两个出口的异常/无效响应 JSON；原 commandId、调用次数、无内部堆栈。
- 最新 HEAD、提交、全量测试数及全部门禁；保留的既有未提交改动清单。

真实 Harness 回归只需安全查询和无副作用错误场景，不需要创建真实告警或操作硬件。没有真实会话记录时仅声明模拟/代码验收；本轮也不解决历史数据恢复和全局运行态键迁移。


## 7. 实施前决策（2026-09-24，优先于上文建议措辞）

1. **范围：get + list。** list 是同一拼值问题的常用入口，本轮一起复用选择器。get/list 各有真实入口回归，过滤/分页不得改变全局身份判定。FOLLOWUP-014-01：追踪 status/read 及其它运行值投影，逐路径复现、记录是否受影响和修复范围；不直接断言所有入口同 bug，不扩入 poll/写路径。交付必须列出该剩余审查范围。
2. **身份先于取值。** 用 repository 加载并保留完整分层的 modbus（legacy claim 只在内存）判定有效身份，再使用同次加载的 values。无需绕过 repository 读原始文件。多归属时补齐的 conn/dev 完全不能作为消歧证据；唯一归属允许既有旧记录补字段兼容，明确这不是历史来源证明。身份歧义且根本无记录时为 missing；有记录但归属不明才是 unavailable。
3. **错误码范围。** HOST_DISPATCH_FAILED 仅用于进程内 dispatch 同步 throw/异步 reject 的兜底；有可信现有取消语义则保留。HTTP 网络失败、超时、非 JSON/空 body 沿用现有 HOST_UNAVAILABLE/HOST_TIMEOUT/HOST_INVALID_RESPONSE 及状态映射，只统一关联与结果校验。不能用错误码推断请求未执行。
4. **valueStatus 每条必有。** get/list 的类型、说明、投影白名单与预算裁剪保留它。若保留一条点，就保留该状态；不可仅保留 raw:null 而抹掉原因类别。available 表示来源校验通过，不表示采集成功或数据新鲜；ok/at 仍独立。
5. **优先薄包装身份函数。** 先 export/薄包装 identitiesForPoint，必要时原样移动到共享小模块；不顺手重写身份算法。poll 的允许/拒绝、共享覆盖及禁用连接行为完全不变，作为硬验收条件。
6. **ID 错配仍用 HOST_INVALID_RESPONSE。** 不新增 HOST_COMMAND_ID_MISMATCH。可附固定 reason:'command-id-mismatch' 供区分，但不回显对方 commandId 或原始响应。先校验原对象和 ID，再 envelope，禁止将错配值覆盖成本次 ID 后当成功返回。
7. **幂等策略维持，不采用“dispatch 失败默认删缓存”。** 已核实缓存位于 executeVisionCommand 内，Host client 的 finishHostResult 在其外层。本轮合成错误不新增客户端缓存、不移入 executor，也不删除或替换 Host 内已有条目。正常业务失败缓存维持原状。真实 executor reject 时现有 promise 条目也维持；同键再次调用不能因本次修复重新执行。测试需覆盖 executor 计数，而不只是 dispatch 次数。FOLLOWUP-014-02：rejected promise 缺 completedAt 导致清理缺口单独治理，需设计结果未知条目的生命周期，不能直接删除后重放可能已执行的写入。
8. **发出后失败统一表达结果未知。** 默认文案“未能确认本次命令结果”；不必为本轮扩建 action 分类表。已有可靠只读分类可附“可重新查询”，不得据此自动重试或把所有 points 操作视为只读。写入及未知 action 禁止“未执行/可安全重试”措辞。
9. **计数与 Agent 指引。** returned 含 unavailable 点，missingIds 只含配置未找到的 ID。工具说明明确 unavailable 不是修配置指令：可以继续查询可见配置、说明来源不可确认；不得自动改名、改设备绑定、采集或写设备。不得把 unavailable 伪装成 DEVICE_NOT_FOUND。
10. **测试按行为拆分。** get/list 值隔离、纯选择器、进程内异常、HTTP、debug 可各自成文件；公共 fixture 只抽确有复用部分。不扩大 structure allowlist，遵守实际测试文件预算。
11. **双 finalize 必须幂等。** 先做无损可表示性与对象契约检查，随后校验原始 ID，最后 envelope/project/finalize。验证已有合法错误经过两次处理后 ID 与 refresh/conflicts/missingFields 不变；无效 null/circular 不得被包装洗白。HTTP 成功 body 的不同 ID 也需真实路径覆盖。
12. **代码验收与安装验收分开。** 本轮必须通过代码门禁及隔离环境集成测试；Desktop 0.29.28 lab 是历史安装信息，不能当本次代码验收依据。真实 Harness 单列待验收项：先确认加载本轮提交对应产物，再跑安全查询与无副作用错误，不自动重启、升级安装或测试硬件。未执行时明确标注，不能据代码门禁宣称 Harness 已通过。

补充交付矩阵：get/list 分别列安全值、歧义值、无值、共享覆盖与投影保留；真实缓存 executor reject 后同键重放执行次数不增加；HTTP 原有错误码不变且 commandId 完整。保留 FOLLOWUP-014-01/02 的范围和风险，不以本轮完成替代它们。
