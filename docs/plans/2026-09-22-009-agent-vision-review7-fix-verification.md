# Vision Agent × 插件：第七轮 Review 修复验证报告

本报告记录 [2026-09-22-008-agent-vision-review7-fix-plan.md](./2026-09-22-008-agent-vision-review7-fix-plan.md) 的实际执行证据。所有命令在 `dsh-vision-bench/` 内执行，结果为实测输出；未执行的验收在 §8 明确列出，不计入通过。

## 1. 提交与工作区

| 提交 | 内容 |
| --- | --- |
| `9f9f12a` | `fix(share): preserve raw topology through mutation scope resolution`（R1 + `test/config/share-transaction-device-identity.test.mjs` 红→绿） |
| `12dbebf` | `fix(config): report device conflicts against the actual target layer`（R2 + `device-identity-mutations.test.mjs` 层归属用例 + `share-transaction-conflict-reporting.test.mjs`） |
| 本 docs 提交 | 收录修复计划与本验证报告 |

基线 `96c316c`，分支 `feat/native-web-desktop-migration`。修复后工作区除本报告与计划文档外无未跟踪/未暂存改动（`git diff --check` 与 `git diff --check 96c316c..HEAD` 均通过）。

## 2. 复现证据（修复前，基线 96c316c）

同一份原始私有双 `d1` fixture（`sessionConfigs.s1.devices = [d1/c1/1, d1/c2/2]`），直接函数 vs 真实 mutation 事务：

```
direct applyShareFlags: {"ok":false,"errorCode":"CONFLICT","conflicts":[{"layer":"private","sessionId":"s1","deviceId":"d1","connectionIds":["c1","c2"]}]}
transaction share.update: {"ok":true,"published":["connections"],"commits":1}
```

R1 缺陷确认：事务入口接受原始双 `d1` 并提交 1 次。红灯测试（`node --test test/config/share-transaction-device-identity.test.mjs`）：R1-1/R1-2/R1-3/R1-9 失败，R1-4–R1-8 通过（合法路径护栏）。

R2 缺陷确认（connections 共享有效、s1 建重复 `d1`）：

```
{"ok":false,"errorCode":"CONFLICT","conflicts":[{"layer":"private","sessionId":"s1","deviceId":"d1","connectionIds":["c1"]}]}
```

写回目标实为共享层，诊断误标 `private/s1`。

## 3. 修复后证据（HEAD 12dbebf，脚本实测）

原始双 d1 对照（两者均拒绝；事务 commit 次数 0）：

```
E2-direct       : {"ok":false,"errorCode":"CONFLICT","conflicts":[{"layer":"shared","sessionId":"","deviceId":"d1","connectionIds":["c1","c2"]}]}
E2-transaction  : {"ok":false,"errorCode":"CONFLICT","conflicts":[{"layer":"shared","sessionId":"","deviceId":"d1","connectionIds":["c1","c2"]}]}
E2-commit-count : 0
```

拒绝前后不变（输入对象、版本、share、claim 标记）：

```
E5-input-unchanged: true | configVersion = 5 | share = {"enabled":false,...} | claim = "s1"
```

legacy 合法拓扑首次 claim+发布/撤销（真实临时 repository）——拓扑、unitId、点位、版本增量：

```
E3-before       : {"configVersion":2,"claim":"","devices":["d1:7"],"points":["p1"],"connections":["c1"]}
E3-after-publish: {"ok":true,"published":["connections"],"configVersion":3,"claim":"s1","devices":["d1:7"],"points":["p1"]}
E3-after-revoke : {"ok":true,"revoked":["connections"],"configVersion":4,"sharedDevices":["设备1"],"privateDevices":["d1:7"],"points":["p1"]}
```

（`设备1` 为空拓扑合成默认行，非真实数据；真实行 `d1:7`、`p1`、unitId 7 全程未丢。）

shared / private / top 三类错误 JSON 与 share 发布/撤销目标层：

```
E4-shared-create: {"errorCode":"CONFLICT","conflicts":[{"layer":"shared","sessionId":"","deviceId":"d1","connectionIds":["c1"]}]}
E4-private-create: {"errorCode":"CONFLICT","conflicts":[{"layer":"private","sessionId":"s1","deviceId":"d1","connectionIds":["c1"]}]}
E4-top-create   : {"errorCode":"CONFLICT","conflicts":[{"layer":"top","sessionId":"","deviceId":"d1","connectionIds":["c1"]}]}
E4-publish-layer: [{"layer":"shared","sessionId":"","deviceId":"d1","connectionIds":["c1","c2"]}]
E4-revoke-layer : [{"layer":"private","sessionId":"s1","deviceId":"d1","connectionIds":["c1","c2"]}]
```

## 4. 场景覆盖对照

计划 §2（R1 八行）→ `test/config/share-transaction-device-identity.test.mjs`：R1-1（分区私有双 d1 发布拒绝、不提交、输入不变）、R1-2（已有 claim 标记不提前去重）、R1-3（legacy 顶层双 d1 拒绝、claim 不落盘、不丢第二条）、R1-4（合法 claim+发布/撤销拓扑完整、版本 +1/+2，真实 repository）、R1-5（共享双 d1 撤销拒绝、两层均不变）、R1-6（未确认维持 `SHARE_REVOKE_CONFIRM_REQUIRED`）、R1-7（发布替换不误判）、R1-8（无关会话双 d1 不误伤）。

计划 §3（R2）→ `test/config/device-identity-mutations.test.mjs` R2-1（shared/空 session）、R2-2（master=false → private/sid）、R2-3（connections=false → private/sid）、R2-4（无 session → top/空）、R2-5（config handler + Agent projection 层信息正确，含 configVersion/设备数组不变）；`test/config/share-transaction-conflict-reporting.test.mjs` R2-6（发布报 shared、撤销报 private）+ R1-9（mutateConfig 包装与 Agent projection 保留 errorCode/conflicts/deviceId/connectionIds）。

实现落点：`src/application/modbus/config-scope-claim.mjs`（新，`pickTopology`/`topologyFingerprint`/`hasTopology` 搬入 + `isLegacyClaimable`/`prepareRawShareMutation`，单向依赖）、`config-scope-service.mjs`（共用资格判断、兼容转出、发布冲突标 shared）、`config-mutation-service.mjs`（share 分支前移、`deviceWriteTarget` 写回上下文）。`package.json` `files` 已补 `config-scope-claim.mjs`；typecheck 清单经 `tsconfig.check.json` 目录包含自动覆盖（`check-typecheck-files.mjs` 通过）。未扩大 `structure-budget.config.mjs` 白名单——share 事务测试按语义拆为两个文件并抽出 `test/helpers/share-raw-fixtures.mjs` 以满足 test 350 行预算。

## 5. 新增单测

新增 15 个用例（1505 → 1520）：`share-transaction-device-identity.test.mjs` 8、`share-transaction-conflict-reporting.test.mjs` 2、`device-identity-mutations.test.mjs` +5；辅助 `test/helpers/raw-mutation-repo.mjs`（事务 harness：未规范化 fixture 直入真实回调、仅 ok 才模拟提交+版本递增、计数 commit）与 `test/helpers/share-raw-fixtures.mjs`。

## 6. 门禁结果（实测）

| 命令 | 结果 |
| --- | --- |
| `npm run lint --silent` | 通过（856 files, no fixes） |
| `npm run typecheck --silent` | 通过（`typecheck file list ok`） |
| `npm run deps:check --silent` | 通过（508 modules, no violations） |
| `npm run structure:check --silent` | 通过（`structure budget ok`） |
| `npm run assertions:check --silent` | 通过（`source assertions ok`） |
| `npm run facades:check --silent` | 通过（`facade purity ok`） |
| `npm run ui:ownership:check --silent` | 通过 |
| `npm run pack:check --silent` | 通过（524 files, import closure closed） |
| `npm run build:check --silent` | 通过 |
| `npm run test:unit --silent` | 1520 tests / 1517 pass / 3 fail（§7 基线） |
| `git diff --check 96c316c..HEAD` / `git diff --check` | 通过 |

## 7. 基线失败核对（按断言位置与原因，不按测试名）

修复前基线日志 `/tmp/vision-review7-unit.log`（1502/1505）与最终 `/tmp/vision-review7-unit-final2.log`（1517/1520）逐项对照：

| 测试 | 断言位置 | 原因 | 前后一致 |
| --- | --- | --- | --- |
| 多连接轮询：两条 enabled 连接并行 poll… | `test/hmi/multi-conn-poll.test.mjs:8` | frames 数组 deepEqual 不符（`deviceName:''` 等） | 是 |
| 多连接轮询跳过 disabled 连接 | `test/hmi/multi-conn-poll.test.mjs:47` | frames 数组 deepEqual 不符 | 是 |
| Task8: official Virtualizer renders viewport-limited rows… | `test/ui/frames-virtualizer-real-effects.test.mjs:110` | `first visible row is oldest retained frame`：`'c1-f5000:tx'` ≠ `'c1-f4501:tx'` | 是 |

三项均在 HMI frames/UI 虚拟化层，与 share/config 作用域无关，维持基线归类；未改 skip、未放宽断言。执行期间一次 `structure-budget` 失败（新测试文件 383 行超 350 预算）已按 §4 拆分修复，最终全绿。

## 8. 未执行的验收（不计为通过）

- 真实硬件 / STM32 + Keil Windows 真机验收：未执行。
- Web / Desktop 安装验收（registry 产品安装、Desktop 探针 B1/B2、soak）：未执行。
- `npm run test:coverage`：本轮未执行。
- Desktop 完整 Modbus RTU（`serialport` allowBuilds 限制）：未执行、仍不宣称。

本报告的证据仅覆盖模拟/事务/单测层面；不外推为上述验收已完成。此修复保护事务 current 中仍存在的原始定义，不能恢复 repository 更早已去重或历史保存已丢失的设备信息。
