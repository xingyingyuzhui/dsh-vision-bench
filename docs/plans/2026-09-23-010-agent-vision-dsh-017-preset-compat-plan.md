# Vision Agent × 插件：DSH 0.1.7 声明式预设兼容计划

日期：2026-09-23。分支 `fix/dsh-017-preset-compat`。背景：Desktop 升级 `0.1.7-alpha.2` 后「Vision模式」Agent 预设消失（用户实测确认）。

## 1. 缺陷与根因

- DSH 0.1.7 重构预设体系（上游 `feat(preset): declare Agent compositions in profile YAML`）：预设从目录（`$DSH_HOME/.agent-presets/<id>/`）改为 Cordis 组合里的 `@deepseek-ai/dsh-agent-preset` 声明行。官方 skill 文档原话：*"a user preset was a directory … **Nothing reads that directory any more.**"*
- bench 0.29.26 仍按旧契约 seed 目录（`agentPresets.copy` → `resolveShippedStandardDir` 复制 `presets/standard`），在 0.1.7 上：`copy` 已移除（能力守卫跳过）、`@deepseek-ai/dsh-agent-presets` 包已移除（仅本机 homebrew CLI 0.1.6 回退路径能解析）、产出目录不被读取 → 预设不可见，旧会话 `vision-bench` 身份重启后 `preset not found`。
- 其余契约面（`connection.fetch.register`、`__ModuleLoader__`、`dsh-client-*`、`tools`/`systemPrompt`、`settings.section`、`bundle.patch`、`dsh-persona`）在 0.1.7 asar 中实测存在；`agent/session-start` → `agent/created` 与 bench 无关（不订阅）。

## 2. 关键决策

| 决策点 | 选择 | 理由 |
| --- | --- | --- |
| S1 注册方式 | **运行时 `ctx.agentPresets.register()`**（可选注入，能力探测） | 公开 API（声明行本身走的同一入口）；≤0.1.6 零风险（服务无 `register` 则不触发，旧目录 seed 原样保留）；dispose 随 fiber 注销；无需改用户拥有的 `cordis.patch.yml`。纯 patch 声明行需 `!!js` 门控（0.1.6 无 `@deepseek-ai/dsh-agent-preset`），语义未实测，不采用 |
| S2 子插件清单来源 | **随包生成快照**（0.1.7 `standard.patch.yml`）+ `--check` 漂移门 | 0.1.7 registry 只回展示元数据（`copy` 深拷贝语义消失），预设自包含必须重述清单；live 配置含已求值 `!!js`，克隆会把平台行为写死；快照以纯 JS 布尔在注册时求平台，跨平台正确 |
| 同 id 处理 | 保留 `vision-bench` | 旧会话记录的预设身份重启后可解析 |
| 迁移 | roster 校验通过后旧目录**整体改名备份**到 `.vision-bench.backup.<ISO>` | 不删用户文件；激活失败保留旧目录作恢复数据；无/外来归属标记的目录一律不动 |
| 外部占用 id | 让位 `external-declaration`（含短重试防 HMR 竞速） | 不与用户声明/其他安装抢占 |
| 结构预算 | preset 接线抽到 `src/infrastructure/host/vision-preset-attach.mjs` | `host.js` 保持 <400 行软限，**不扩大白名单** |

## 3. 变更分组

1. **声明与快照**：`src/infrastructure/harness/preset-declaration.mjs`（契约常量、`buildVisionPresetDefinition`、`registerVisionPreset`（Duplicate 重试）、`describeDeclaredPreset`、`migrateLegacyPresetDir`、`activateVisionPresetDeclaration`、声明状态机）；`src/infrastructure/harness/standard-preset-snapshot.mjs`（生成物）；`scripts/gen-standard-preset-snapshot.mjs`（生成 + 漂移校验，拒绝未支持 `!!js`）。
2. **宿主接线**：`src/infrastructure/host/vision-preset-attach.mjs` + `host.js` 可选注入 `agentPresets`（非致命；失败只记 `vision.preset.declaration*` 日志，不影响 Host apply 事务与 lease）。
3. **健康与 seed**：`preset.mjs` 声明式健康分支（`via`/roster 诊断/迁移警告/声明式 `nextStep`）；`seedVisionBenchPreset` 对声明式 registry 走注册并回传 disposer；旧路径零改动。
4. **契约钉**：`SUPPORTED_DSH_CONTRACT` → `0.1.7-alpha.2`（S5「先实测再改常量」：静态契约面 + probes + Desktop 运行证据见验证报告）；`test/preset/contract.test.mjs`、`scripts/probes/check-stage5-acceptance.mjs`、`docs/ACCEPTANCE_NATIVE_WEB_DESKTOP.md`、`docs/VISION_DSH_COMPAT_BASELINE.md` 同步。
5. **发布**：`0.29.27` + CHANGELOG + `client.js` 版本戳。

## 4. 测试与验收标准

- 新增 33 用例：声明形状（persona prefix/suffix、单工具行、组 isolate、平台布尔、fresh rows）、注册（成功/失败/Duplicate 重试/让位）、迁移（owned/legacy 标记/外来/无标记/无目录）、激活编排（roster broken 时不迁移）、健康分支、seed 双轨、快照清单、生成器（含拒绝 `!!js`、拒绝无 standard 声明）。
- `npm run quality` 全绿（含 coverage 门槛与 pack:check 闭包）。
- Desktop 0.1.7 复验：预设选择器出现「Vision模式」；新会话 `vision_bench`/`vision_debug` 可用；旧 `vision-bench` 身份重启可解析；旧目录被备份迁移。
- 0.1.6 Web 路径零回归（目录 seed 用例原样通过）。

## 5. 边界与失败模式

- registry 缺失/激活失败：健康报错 + 声明式重建指引；工作台功能不受影响（预设是增量能力）。
- 迁移失败（EPERM 等）：警告但健康仍 ok（0.1.7 不读旧目录，残留无害），备份路径回显。
- HMR/重挂载：Duplicate 短重试；dispose 同步触发注销，重挂载重新注册。
- 快照漂移：升级 DSH 后用 `--write --tag <tag>` 重生成 + `--check` 进复验清单。
