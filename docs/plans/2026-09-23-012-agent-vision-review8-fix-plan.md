# Vision 插件集：第 8 轮全面 review 修复计划（代码级）

基线：`main` @ `8a1c4dd`（0.29.27），`npm run quality` 全绿（1553/1553，行 84.45% / 分支 69.96%）。
来源：2026-09-23 六个方向的只读 review（架构 / Modbus 正确性 / 安全 / DSH 契约与发布 / 测试门禁 / UI 与 Agent 工具）。本计划只收录**已在代码中核对过**或证据充分的问题；行号基于 `8a1c4dd`。

## 0. 已裁定的设计决定

- **Agent HTTP 命令桥等同用户侧，不走人工批准（用户确认：允许）。** 不改 `vision-command-routes.mjs` 的 `source`/`confirm` 语义。要做的只有：
  - 写进 `docs/VISION_DSH_COMPAT_BASELINE.md`（或新 ADR）：桥 = 用户权限、仅 Web 模式挂载、凭密钥访问，避免后续 review 重复报。
  - **D-1 已裁定：保持现状。** 密钥继续放在 `process.env.VISION_BENCH_CAPABILITY`（`host.js:48`）；Keil / OpenOCD / GDB 子进程在信任范围内。文档中注明这一点。
- **D-2 已裁定：告警死区默认按阈值百分比。** 点位未设置 `alarmDeadband` 时，回差 = `|触发阈值| × 1%`（`DEFAULT_ALARM_DEADBAND_RATIO = 0.01`，放在 `alarm-constants.mjs`）；显式设为 `0` 表示无回差。

## 分支与批次

| 批次 | 分支 | 内容 | 依赖 |
| --- | --- | --- | --- |
| A | `fix/review8-modbus-runtime` | Modbus 运行时 bug（A1–A7） | 无 |
| B | `fix/review8-dsh017-closure` | DSH 0.1.7 收尾（B1–B5） | 无，可与 A 并行 |
| C | `fix/review8-agent-boundary` | Agent 面与分层边界（C1–C5） | A7 之后（共享 write-service） |
| D | `chore/review8-gates` | 门禁补强（D1–D5） | B 之后（D2 需 B2 的新测试） |
| E | `feat/review8-ui-a11y` | UI / 无障碍 / 体积（E1–E6） | 独立，排在后面 |

每条修复都带回归测试；每批合并前跑 `npm run quality`。

---

## A. Modbus 运行时（`fix/review8-modbus-runtime`）

### A1. 停止轮询被在途 tick 覆盖（P1，已确认）

**根因**：`polling-service.mjs:233` 复制整张 `pollingByConnection`（含 `enabled`/`intervalMs`），`:243-248`、`:329-334` 在副本上改后整张交给 `commitPollResult`；`modbus-commit.mjs:173-176` 用 `{ ...pack.pollingByConnection, ...input.pollingByConnection }` 整条覆盖磁盘值。

**改动**：
- `polling-service.mjs`
  - `:233` 改为 `const pollingRuntime = {}`，只收集本次实际轮询的连接。
  - `:243-248`、`:329-334` 只写 `pollingRuntime[connId] = { lastAt, lastOk, error }`，不再展开 `interval`。
  - `:252-258` 的 `interval` 局部变量删除（已无用途）。
  - `:340-345` 传 `pollingRuntime` 替代 `pollingByConnection`。
- `modbus-commit.mjs:173-176, :204-206`
  - 输入字段改名 `pollingRuntime`（改名让旧调用方在 typecheck 时暴露）。
  - 合并按字段白名单：对每个 `cid`，仅当 `connections` 中仍存在时 `next[cid] = { ...(pack.pollingByConnection[cid] || normalizePolling(null)), lastAt, lastOk, error }`。
- 同步更新调用方测试：`test/devices/poll-alarm-commit.test.mjs:46,63,91,127`、`test/agent/alarm-notify-session.test.mjs:229`。

**测试**（新增 `test/devices/poll-stop-race.test.mjs`）：
1. 假 transport 的 read 挂在 deferred 上；启动一次 poll；期间调用协调器的停止（`polling-coordinator.mjs:125-132` 路径）写 `enabled:false`；释放 deferred。断言磁盘 `enabled === false`，且协调器不会重启该连接的定时器。
2. 同样竞态下修改 `intervalMs`，断言新间隔保留。
3. tick 期间删除连接，断言提交不会把它复活。

### A2. 告警死区写死 1 个工程单位（P1，已确认）

**根因**：`modbus-commit.mjs:183` `opts: { deadband: 1 }`；`alarm-evaluate.mjs:80-86` 用它做恢复回差，量程 < 1 的点位永不恢复。

**改动**：
- 新增点位字段 `alarmDeadband`（工程单位，`>= 0`；缺省为 `null`，表示按 D-2 的 1% 相对值）：
  - `src/types/workspace.d.ts:44` 后加 `alarmDeadband?: number | null`。
  - `point-model.mjs:108-122` 与 `:350-362` 两处 normalize 加 `alarmDeadband: nonNegOrZero(raw.alarmDeadband)`。
  - `point-patch.mjs:5-17` `PATCHABLE` 加 `'alarmDeadband'`，校验非负有限数，否则 `INVALID_FIELD`。
  - `point-csv.mjs:13-14, :62-63, :101-102` 增加列（按表头 `pick`，旧 CSV 缺列时为 0，兼容导入）。
  - UI：`src/ui/hmi/point-editor.mjs` 加输入框；i18n 两份 copy 表加 key。
  - Agent 工具 schema（`vision-bench-tool.mjs`）的点位字段说明加一行。
- `alarm-evaluate.mjs:25, :80-86`：改为按点取值：`p.alarmDeadband` 为有限非负数时用它；否则 `opts.deadband`（显式传入时，保持现有测试语义）；否则 `|阈值| × DEFAULT_ALARM_DEADBAND_RATIO`。
- `modbus-commit.mjs:183`：删除 `deadband: 1`。
- 手动编辑（`point-patch`）、CSV 导入与 UI 编辑框对 `alarmDeadband` 的校验一致：非负有限数或空（空 = 默认 1%）。

**行为变化（写入 CHANGELOG）**：旧点位原先隐式有 1 个工程单位回差，改后默认回差为阈值的 1%。

**测试**：
- `test/domain/alarm.test.mjs`：`scale 0.01`、`alarmMax 0.55`，0.58 触发、0.54 恢复（默认回差 0.0055）；设 `alarmDeadband 0.02` 时 0.54 保持、0.52 恢复；`alarmDeadband 0` 时 0.549 即恢复。
- `point-patch-semantics.test.mjs`：负数 / NaN 被拒。
- CSV 往返与旧 CSV（无该列）导入。

### A3. 仿真写入保存失败后写任务不结束（P1，已确认）

**根因**：`write-execute.mjs:76` `openTask` 之后，`:202` `if (saved && saved.ok === false) return saved` 直接返回，未调用 `finishTask`；之后 `write-service.mjs:71` `hasRunning(workspace,'write')` 永远为真。任何抛异常的路径同理。

**改动**（`write-execute.mjs`）：
- 在 `done()` 内置 `finished = true`；取消分支 `:224` 也置位。
- `:76` 之后的主体包进 `try { … } finally { if (!finished) await finishTask(home, roomCwd, task.id, { ok: false, summary: '写入中断' }) }`。
- `:202` 改为 `return done(false, saved.error || '仿真写入保存失败', { errorCode: saved.errorCode })`，让日志与返回形状一致。

**测试**（`test/devices/write-task-lifecycle.test.mjs`）：
1. 让 `saveSessionModbusPatch` 返回 `ok:false`（共享配置下无会话写入即可触发 `SESSION_REQUIRED`），断言返回 `ok:false`、`hasRunning(ws,'write') === false`、第二次合法写入成功。
2. transport 抛异常，同样断言任务被关闭。

### A4. 单个从站超时可能关闭整条共享串口（P1，强怀疑）

**根因**：broker 截止时间（`io-broker.mjs:297, :317`）与驱动超时（`runtime/io/modbus-driver.mjs:110`）相同。broker 先到期时发送 `cancel`，worker 中止回调执行 `client.close()`（`modbus-driver.mjs:113-119`），同一端口上的其他设备随之断开重连。

**改动**：
- `io-broker.mjs:297`：`const timeoutMs = clampTimeoutMs(...) + BROKER_GRACE_MS`（`BROKER_GRACE_MS = 1500`，常量放文件顶部）。正常超时由驱动先上报 `MODBUS_TIMEOUT`，broker 的计时器只兜底 worker 卡死的情况。
- 显式用户取消（`signal` abort）仍保留关闭行为：modbus-serial 没有别的中断手段。

**测试**（`test/infrastructure/io-broker-timeout.test.mjs`）：假 worker 在 `timeoutMs` 时回 `MODBUS_TIMEOUT`，断言 broker 未发送 `cancel`；worker 卡死超过 `timeoutMs + grace` 时才发送 `cancel`。

### A5. worker 进程可能比 Host 活得久并占住 COM 口（P1，已确认缺处理）

**改动**：
- `runtime/vision-io-worker.mjs:123` 之后：
  - `rl.on('close', () => { void shutdown() })`：父进程死亡导致 stdin EOF 时自行退出。
  - `process.stdout.on('error', () => { void shutdown() })`：父进程关闭管道时写 stdout 触发 EPIPE。
- `io-broker.mjs:201` 创建 `proc` 之后加 `proc.stdin.on('error', (error) => { if (workerEpoch !== epoch) return; lastError = ioError('IO_RUNTIME_UNAVAILABLE', …); killWorker(lastError) })`，防止向正在退出的 worker 写入时 EPIPE 抛到 Host。

**测试**：`test/infrastructure/io-worker-lifecycle.test.mjs`：真实 spawn worker，关闭其 stdin，断言 2 秒内退出且 exit code 为 0；broker 侧模拟 stdin `error` 事件，断言 Host 进程不抛未处理异常。

### A6. 两次写入可能同时上总线（P2，已确认逻辑）

**根因**：`write-service.mjs:71` 的 `hasRunning` 读的是 `:36` 加载的快照；任务在 `write-execute.mjs:76` 若干 `await` 之后才创建。

**改动**：
- `modbus-runtime-context.mjs` 增加 `writeLocks: Set<string>`（按 `cwd`，与 `pollLocks` 同类）。
- `write-service.mjs`：`:71` 处先检查锁，再保留 `hasRunning`（跨进程兜底）；在调用 `executeApprovedWrite` 前 `writeLocks.add(cwd)`，`finally` 中删除。
- `errors.mjs` 新增 `WRITE_BUSY`，`:72` 返回 `{ ok:false, errorCode: WRITE_BUSY, error: '已有写入任务进行中' }`（原来缺 errorCode）。

**测试**：两个并发 `modbusWrite`，transport 用 deferred 挂住第一个，断言第二个得到 `WRITE_BUSY` 且 transport 只被调用一次。

### A7. 批准与写入之间不是原子的（P2）

**根因**：`resolvePendingWrite`（`write-service.mjs:174-219`）校验通过后调用 `modbusWrite`（`:230-238`），后者重新加载配置、按功能码 + 地址重新查点（`:36, :73-80`），中间的配置变更不会被发现。另外写锁忙时，已消费的批准会丢失。

**改动**：
- `resolvePendingWrite` 调用 `modbusWrite` 时传 `expected: { configVersion: boundConfigVersion, pointIds: entry.params.pointIds, endpoint: entry.params.endpoint }`。
- `modbusWrite` 在 `:80` 算完 `targetPointIds` 后，若带 `expected`：`configVersion` 不等、`pointIds` 不等或端点指纹不同，均返回 `CONFIG_DRIFT` / `ENDPOINT_DRIFT`。
- `write-approval-service.mjs` 新增 `restorePendingWrite(entry)`；`resolvePendingWrite` 收到 `WRITE_BUSY` 时放回原批准并返回该错误，让用户稍后再点批准。

**测试**：批准前修改点表（同地址换点 id），断言 `CONFIG_DRIFT` 且 transport 未被调用；写锁占用时批准，断言返回 `WRITE_BUSY` 且 `listPendingWrites` 仍包含该请求。

---

## B. DSH 0.1.7 收尾（`fix/review8-dsh017-closure`）

### B1. `seed-preset` 在 0.1.7 上报错退出（P1）

**改动**：
- `dsh-contract.mjs` 新增 `detectPresetTrack(extraPaths)`：能解析 `@deepseek-ai/dsh-agent-preset-registry` 且不能解析 `@deepseek-ai/dsh-agent-presets` → `'declarative'`；反之 → `'legacy'`；都不能解析 → `'unknown'`。
- `scripts/seed-preset.mjs:5-6`：`declarative` 时打印「DSH 0.1.7+ 由 Host 声明注册 Vision模式，无需 seed」并 `exit 0`；`unknown` 时打印可读错误并 `exit 1`；`legacy` 走原路径。
- `dsh-contract.mjs:20`：删除 `/opt/homebrew/Cellar/node@24/24.18.0/...` 硬编码，改为 `join(dirname(process.execPath), '..', 'lib', 'node_modules', '@deepseek-ai', 'dsh')`（Windows 为 `join(dirname(process.execPath), 'node_modules', ...)`）。
- `README.md:77` 改写「Vision模式」一节：0.1.5-rc.1–0.1.6 目录式需要 seed；0.1.7+ 由 Host 自动声明。

**测试**：`test/preset/seed-track.test.mjs`，用 `extraPaths` 指向两个 fixture 目录（只有 registry / 只有旧包），断言三种判定。

### B2. 热重载后 Vision模式可能处于未注册状态（P1）

**根因**：`preset-declaration.mjs:170-189` 重复 id 只重试 3×50ms，之后按 `external-declaration` 报成功；旧 fiber 的注销被推迟到挂载完成后（`vision-preset-attach.mjs:51-57`），晚到的注销把 id 删掉，无人重新注册，健康状态仍显示 `registered`。`declarationState` 是模块级单例，旧 fiber 的晚写会覆盖新 fiber。

**改动**：
- `vision-preset-attach.mjs`：用跨模块实例的槽位 `globalThis[Symbol.for('dsh-vision-bench.preset-declaration')] = { epoch, settled: Promise }`（HMR 会重新 import 模块，模块级变量不共享）。
  - 旧 fiber dispose 时把「等挂载完成 → 执行 unregister」整个链条写入 `slot.settled`。
  - 新 fiber 激活前 `await slot.settled.catch(() => {})`，再调用 `activateVisionPresetDeclaration`。
- `preset-declaration.mjs`：
  - `setDeclarationState` 增加 `epoch` 参数，只接受当前 epoch 的写入；`activateVisionPresetDeclaration(…, { epoch })` 透传。
  - `:289` 迁移条件改为 `roster.ok && registration.via === 'agentPresets.register'`，外部声明时不动旧目录。
  - `external-declaration` 分支之后在 attacher 中安排一次延迟复核（约 2 秒）：`describeDeclaredPreset` 找不到行且当前 fiber 未 dispose → 再注册一次；仍失败则把健康状态置为 `failed` 并写明原因。

**测试**（新增 `test/preset/preset-attach-hmr.test.mjs`，同时覆盖目前 34.7% 的 `vision-preset-attach.mjs`）：
1. 假 registry：`register` 延迟 resolve；占用中的 id 抛 duplicate。
2. 旧 fiber 挂载中 dispose → 新 fiber 激活 → 断言最终 roster 有行、健康状态为 `registered`、只迁移一次。
3. 旧 fiber 的晚写不会覆盖新 fiber 的状态。

### B3. 标准预设快照漂移没有运行时提示（P2）

`inspectPresetHealth` 读取已安装 `@deepseek-ai/dsh/package.json` 的版本，与 `STANDARD_PRESET_SNAPSHOT_CONTRACT`（`standard-preset-snapshot.mjs:17`）不同时附加 warning「标准预设快照（0.1.7-alpha.2）早于已安装 DSH（x），如 roster 行 broken 请升级插件」。测试：`declarative-health.test.mjs` 加一例。

### B4. 文档与版本声明对齐（P1）

- `CHANGELOG.md` 0.29.27：「Desktop 实测基线」「旧会话身份可解析」改为「静态契约核对 + lab 安装；Desktop 复验待做（见 011 §7）」。
- `docs/VISION_DSH_COMPAT_BASELINE.md:3,9` 同步措辞；并写入 §0 的「命令桥 = 用户权限」设计决定。
- `README.md:3, :15, :43`：版本段落改为「见 CHANGELOG」，支持范围统一写「DSH 0.1.5-rc.1 – 0.1.7-alpha.2（双轨）」。
- 套件 `README.md:7, :34` 同步；`/Users/qin/AGENTS.md` 中的契约钉更新为 `0.1.7-alpha.2`。
- `docs/plans` 中 09-03 与 09-21-001 至 09-22-008 移入 `docs/archive/`，保留 009–012。

### B5. 包内带了开发专用脚本（P2）

从 `package.json` `files` 移除 `scripts/apply-live-preset.sh`（依赖本机 `../../../../backups`）、`scripts/gen-standard-preset-snapshot.mjs`、`scripts/check-client-budget.mjs`、`scripts/report-client-vendors.mjs`。先确认 `pack:check` 的 import 闭包不依赖它们；`test/package-contents.test.mjs` 加反向断言。

---

## C. Agent 面与分层边界（`fix/review8-agent-boundary`）

### C1. Agent 工具在自己的进程里读盘（P1，已确认）

**根因**：`vision-bench-tool.mjs:7` import `workspace-store`，`:367-374` 为 alarm/trend 预检调用 `loadWorkspace`。

**改动**：
- 删除 `:367-374` 与 `:7` 的 import；`validateAgentToolArgs(args, { pack: null })` 只做 schema 级检查（`agent-tool-preflight.mjs:146` 已有无 pack 时的回退：要求 `connectionId`）。
- `alarmId` / `trendKey` 的唯一性检查移到 Host 侧处理函数（`live-command-handler.mjs` 中 alarm/trend 分支），复用 `resolveTarget`，返回相同的 `missingFields` / `hint` 形状。
- `runVisionBench`（`vision-bench-tool.mjs:78`）移到 `test/helpers/run-vision-bench.mjs`，生产模块不再静态 import `executeHostCommand`。

**测试**：`test/agent/tool-schema.test.mjs` 加断言：生产模块的 import 图不含 `infrastructure/store`；原有 preflight 用例改为经 Host 分派后得到同样的错误。

### C2. 依赖规则失效与分层反向依赖（P1）

- `dependency-cruiser.config.mjs:139-144`：`agent-tool-no-store-or-io` 的 `from` 改为 `^src/interfaces/agent/`，`to` 增加 `^src/infrastructure/(store|modbus)/`。
- 把纯领域逻辑移到 `src/domain/modbus/`：`modbus-migration.mjs`、`modbus-migrate-steps.mjs`、`modbus-compat-accessors.mjs`、`config-scope-service.mjs`、`target-resolver-service.mjs`、`trend-model.mjs`（移动前逐个确认只 import `domain/`）。用脚本改写 import，不留转发文件。
- 新增规则 `infrastructure-no-application`、`ui-no-application`（`ui/client` → `infrastructure/host/vision-rpc-client` 例外），级别 `error`。
- 结构预算与 `facades:check` 同步更新路径。

### C3. 写点待批准的返回让 Agent 无从下手（P1）

- `errors.mjs` 新增 `APPROVAL_PENDING`。
- `write-service.mjs:112-118` 返回：`{ ok:false, needsConfirm:true, errorCode: APPROVAL_PENDING, requestId, label, nextStep: '等待用户在界面批准；结果会以通知返回，不要重复调用 write', error }`。
- `agent-result-projection.mjs`：`write` 的 `needsConfirm` 结果只投影 `requestId / label / errorCode / nextStep`，不再把含端点指纹的 `request` 交给模型。

### C4. 重复写入叠出多张审批卡（P1）

- `write-approval-service.mjs:21` `createPendingWrite`：先在同 `cwd` 中查找 `sessionId + connectionId + deviceId + function + address + values` 相同且未过期的条目，命中则返回原条目并带 `deduped: true`。
- 同一 `cwd` 待批准数量上限 20，超过返回 `APPROVAL_QUEUE_FULL`（修复 review 中「pendingWrites 无上限」）。
- 待批准 id 改用 `randomBytes(8).toString('hex')`（与烧录票据一致）。

**测试**：同一写入调用两次，断言只有一个待批准条目且第二次结果 `deduped:true`。

### C5. Agent 输出体积与提示词（P2）

- `vision-bench-tool.mjs:354`：`JSON.stringify(value)`（去掉缩进），使实际 token 与 `agent-result-caps.mjs:22` 的预算口径一致；列表类动作（points / visualization / ls / map / build）接入 `enforceBudget`。
- `guidance.mjs:20-21`：合并中英两条重复的审批说明，统一用中文；「写点需要端点指纹和配置版本」改写为「Host 会自动绑定端点与配置版本，配置变化后需重新发起」。
- 先跑一遍 `test/agent/*` 确认没有断言依赖缩进格式。

---

## D. 门禁补强（`chore/review8-gates`）

- **D1 测试超时**：`scripts/run-tests.mjs:55` 默认加 `--test-timeout=60000`；`.github/workflows/quality.yml` job 加 `timeout-minutes: 25` 与 `concurrency: { group: quality-${{ github.ref }}, cancel-in-progress: true }`。
- **D2 覆盖率门槛**：`package.json:570` 提到 `--statements 83 --branches 68 --functions 74 --lines 83`，加 `--reporter=json-summary`；新增 `scripts/check-coverage-critical.mjs`，对 `application/modbus/write-*.mjs`、`application/modbus/write-approval-service.mjs`、`application/flash/*`、`harness/preset-declaration.mjs`、`host/vision-preset-attach.mjs` 设逐文件下限（B2 测试落地之后再开）。
- **D3 类型检查范围**：`scripts/check-typecheck-files.mjs:8-16` 分步加入 `src/infrastructure/modbus`、`src/infrastructure/process`、`src/infrastructure/store`、`src/infrastructure/harness`、`src/application/flash`，每加一个目录单独一个提交并修掉类型错误；`preset-transaction.mjs:40` 的 `@ts-ignore` 改为有类型的错误子类。
- **D4 结构预算**：检查脚本在白名单 `max` 超过组硬上限或超过当前行数 5 行以上时失败；同一提交内把各条 `max` 收紧到当前行数（`lossless-json.test.mjs` 629 → 拆分或降到 ≤ 500）。
- **D5 发布流程**：`.github/workflows/package.yml` 加 `needs` 依赖 quality 矩阵（含 Windows），避免只在 Ubuntu 通过就发布。

---

## E. UI / 无障碍 / 体积（`feat/review8-ui-a11y`，排后）

- **E1 包体积**（`client.js` 1,671,103 / 1,675,000 字节）：CodeMirror 改为进入 Debug 页时动态加载；评估 `line-renderer.mjs` 从 uPlot 迁到 ECharts 的成本后再决定是否移除 uPlot（涉及 `use-viz-charts.mjs`、`vendor-bridge.mjs`、`trend-model.mjs`）。完成后 `scripts/check-client-budget.mjs:6` 把上限降到实际体积 +5%。
- **E2 模态框**：`components/modal-dialog.mjs:272-307` 加 Tab / Shift+Tab 焦点循环；`danger` 时初始焦点落在取消按钮、`maskClosable` 默认 `false`。
- **E3 可视化编辑器**：`viz-editor-panel.mjs:112-136` 改用 `createModalDialog`，文案进 i18n。
- **E4 设计 token 与样式作用域**：`runtime-program-graph.mjs:109-307` 与 `styles/sidebar.mjs:10` 的硬编码颜色改为 `--dsw-alias-*`；`styles/sidebar.mjs:7,10`、`styles/runtime.mjs:4` 每条选择器都加页面前缀，并在样式构建里加检查。
- **E5 i18n**：约 800 处中文字面量迁入 copy 表；新增测试：`src/ui` 中 `i18n/` 之外出现中文字面量即失败（先以当前数量为上限做棘轮，再逐步降为 0）。`t('x') || '中文'` 写法一并清理。
- **E6 待批准面板**：`hmi/hmi-controller.mjs:57-100` 加 `aria-live="polite"`、请求进行中禁用按钮、按钮 `aria-label` 带请求标签；frames 列表补空状态。

---

## F. 已裁定事项

- **D-1**：命令桥密钥保留在 `process.env`，不改。
- **D-2**：告警死区默认 `|阈值| × 1%`，显式 `0` 为无回差。

## G. 本计划不包含（留作后续）

- 写入值的点位类型（int16 / uint32 / float32、字序）与写入上下限。
- `bench-*` 兼容层退役与无人调用的 TCP 从站代码清理。
- alarm-notify 五个文件的归并、`host.js` 内聚性整理、`vision-rpc-router.mjs` 下沉协调逻辑。
- 调试 `evaluate` 的写操作限制、设备/文件文本注入 Agent 上下文的数据框定、Agent 构建的审批。
- Desktop 0.1.7 实机复验与 B1/B2 探针重新取证（011 §7）。

## H. 验收

每批：
1. 新增测试先红后绿（按 TDD 顺序提交）。
2. `npm run quality` 全绿，覆盖率不低于基线。
3. 批次 A 额外用仿真连接手工走一遍：启动轮询 → tick 中停止 → 确认不再轮询；小量程点位触发并恢复告警；仿真写入失败后下一次写入可用。
