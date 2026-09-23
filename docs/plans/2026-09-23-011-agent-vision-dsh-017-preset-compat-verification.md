# Vision Agent × 插件：DSH 0.1.7 声明式预设兼容验证报告

本报告记录 [2026-09-23-010-agent-vision-dsh-017-preset-compat-plan.md](./2026-09-23-010-agent-vision-dsh-017-preset-compat-plan.md) 的实际执行证据。所有命令在 `dsh-vision-bench/` 内执行，结果为实测输出；未执行/待确认的验收在 §7 明确列出，**不计入通过**。

## 1. 提交与工作区

基线 `f0d8388`（main，0.29.26），分支 `fix/dsh-017-preset-compat`。

| 提交 | 内容 |
| --- | --- |
| `88c992f` | `fix(preset): declare the Vision preset against the DSH 0.1.7 agent preset registry`（声明模块 + 生成快照 + 宿主接线 + 迁移 + 健康/seed 双轨 + 33 新用例） |
| `cd22c81` | `release: 0.29.27 declarative agent preset for DSH 0.1.7`（契约钉 `0.1.7-alpha.2` + 兼容基线/验收文档/CHANGELOG/版本戳） |
| 本 docs 提交 | 收录计划与本验证报告 |

## 2. 缺陷确认（0.29.26 × Desktop 0.1.7-alpha.2）

- 用户实测：Desktop 升级 `0.1.7-alpha.2` 后「Vision模式」Agent 预设消失（预设选择器无此项）。
- 宿主/UI 链路本身正常（Vision 面板可观察到缺项），缺陷限于预设面。

## 3. 根因证据

- 上游 `feat(preset): declare Agent compositions in profile YAML`（#4569，`dsh-v0.1.6-alpha.2..dsh-v0.1.7-alpha.2` 区间）：预设改为 `@deepseek-ai/dsh-agent-preset` 声明行；`packages/preset/agent-presets/`（含 `presets/standard` 目录与 `agentPresets.copy`）在 0.1.7 树中移除。
- 0.1.7 官方 skill（`packages/preset/agent-preset/skills/editing-cordis-compositions/SKILL.md`）原话：*"Before declaration rows, a user preset was a directory `$DSH_HOME/.agent-presets/<id>/` … **Nothing reads that directory any more.**"*；迁移路径 = 转声明 → 验证行 → 删旧目录。
- registry（`packages/preset/agent-preset-registry/src/index.ts`）公开 API 仅 `register(definition)`/`list()`/`resolve()`；`list()` 只回 `{id,name,description,order,broken}` → 预设自包含、必须重述子插件清单。
- 本机 `~/.dsh/.agent-presets/vision-bench/`（schema 3 marker，13264B `agent.cordis.yml`）证实旧契约产出物形态，与上述「不再被读取」直接冲突。
- 其余契约面在 `app.asar` 中实测存在（`__ModuleLoader__`×84、`dsh-client-ui-slots`×87、`dsh-client-locale`×116、`dsh-client-connection`×82、`agent/created`×46、`settings.section`×73、`bundle.patch`×40、`dsh-persona`×30；`agent/session-start`×0 已移除，bench 不订阅）。

## 4. 修复验证（命令与实测输出）

新增用例（33/33）：

```
$ node --test test/preset/declarative-preset.test.mjs test/preset/declarative-registration.test.mjs \
    test/preset/declarative-health.test.mjs test/preset/standard-snapshot.test.mjs \
    test/preset/snapshot-generator.test.mjs
ℹ tests 33   ℹ pass 33   ℹ fail 0
```

全量质量门（`npm run quality`，含 build:check / lint / typecheck / deps:check / facades:check / ui:ownership:check / structure:check / assertions:check / test:coverage / pack:check）：

```
ℹ tests 1553   ℹ pass 1553   ℹ fail 0
Statements   : 84.47% ( 57109/67606 )     Branches : 69.96% ( 12472/17826 )
Functions    : 76.51% ( 2023/2644 )       Lines    : 84.47% ( 57109/67606 )
pack:check ok 528 files[] entries, no duplicates, no ghost paths, import closure closed
```

快照漂移门（对钉住 tag `dsh-v0.1.7-alpha.2` 的 `packages/bundle/web-app/presets/standard.patch.yml`）：

```
$ node scripts/gen-standard-preset-snapshot.mjs --check
standard-preset-snapshot matches DSH 0.1.7-alpha.2
```

结构预算：`structure budget ok`（`host.js` 389 行 <400 软限，preset 接线抽至 `src/infrastructure/host/vision-preset-attach.mjs`，**白名单零扩**）。

行为要点（均有用例覆盖）：
- 声明 `{ id: vision-bench, name: Vision模式, order: 10, plugins: standard 19 行快照 + {id: vision-bench-tools, name: dsh-vision-bench/agent} }`；persona 保留 shipped `prefix`/`suffix`；`!!js process.platform` 行按注册进程平台落纯布尔。
- `agentPresets.register` 存在且无 `copy` → 声明式；否则旧目录 seed 路径零改动（既有用例原样通过）。
- Duplicate 短重试后仍占用 → `external-declaration` 让位；HMR 竞速有护栏。
- 迁移仅动带归属标记的旧目录，整体改名到 `.vision-bench.backup.<ISO>`；roster 行 `broken` 时**不迁移**（保留恢复数据）。

## 5. 发布与本地安装证据

```
$ npm pack
dsh-vision-bench-0.29.27.tgz

$ node scripts/probes/install-desktop-local.mjs     # Desktop 处于完全退出状态（pgrep 无进程）
{"event":"vision.desktop.local-install","profile":"/Users/qin/.dsh/profiles/desktop",
 "package":"dsh-vision-bench@0.29.27",
 "tarball":"/Users/qin/.dsh/profiles/desktop/.dsh-local-plugins/dsh-vision-bench-0.29.27.tgz",
 "bundles":["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app","dsh-chat-tune","dsh-restart","dsh-vision-bench"],
 "ok":true}
```

本地 tgz / lab 安装按既有规则仅计 **lab/dev 证据**，不计官方产品安装（未发 npm）。

## 6. 契约钉

`SUPPORTED_DSH_CONTRACT = '0.1.7-alpha.2'`（`dsh-contract.mjs`；`test/preset/contract.test.mjs` 与 `scripts/probes/check-stage5-acceptance.mjs` 断言同步）。依据：0.1.7 契约面静态实测（§3）+ 0.29.26 在 Desktop 0.1.7 的运行证据（§2）+ 本修复的全量质量门与本地安装（§4–§5）。预设路径双轨：`0.1.5-rc.1`–`0.1.6` 目录式、`0.1.7+` 声明式。

## 7. 未执行 / 待确认验收（不计入通过）

1. **Desktop 0.1.7 复验（待用户实测）**：重开 Desktop 后确认预设选择器出现「Vision模式」、新会话 `vision_bench`/`vision_debug` 可用、旧会话 `vision-bench` 身份重启可解析、旧目录被备份迁移。0.29.27 已装入 Desktop profile，尚未在应用内复验。
2. 真实硬件 / STM32 + Keil 链路验收：不在本轮范围。
3. Windows 真机矩阵、10–15 分钟 Desktop soak：不在本轮范围。
4. registry 产品安装（npm 发布）：按用户要求不发 npm，未执行。
5. `scripts/probes/run-desktop-b1.mts` / `run-desktop-b2-identity.mts` / `check-stage5-acceptance.mjs` 对 0.1.7 runtime 的重新取证：本轮未跑（其 harness 检出仍为 0.1.6-alpha.2 源码树，与 0.1.7 发布包不同源，取证前需先同步检出）。
