# Vision 公共层清单（P1-1）

状态：**已完成**（2026-09-15）
所属计划：`docs/VISION_COMPONENT_REUSE_AND_ENGINEERING_PLAN.md` §P1-1
基线：`dsh-vision-bench` `8117dbb`（0.29.0）

本清单只记录**有真实文件和调用方证据**的结论。class 名相似不等于行为重复；本文件明确区分
「复用」「领域特有」「重复待合并」「不值得抽取」四类，后续 P2/P3 任务只能从本清单取项。

## 1. 现有公共组件（`src/ui/components/`）

8 个模块，均无业务语义。调用方统计口径：`src/**` 中导入该文件的**生产**模块数（不含自身、不含测试）。

| 模块 | 行数 | 导出 | 生产调用方 | 状态所有权 | 可访问性要求 | 行为测试 | 结论 |
|---|---:|---|---|---|---|---|---|
| `primitives.mjs` | 80 | `createPanel` / `createTabs` / `createHint` | 6 模块 / 11 处（全在 `debug/runtime`） | 无（受控；`activeTab` 由调用方传入） | Tabs 需 `role=tablist/tab` + 键盘切换（**当前缺**） | `primitives.test.mjs` 31 行，仅验 class 名 | 复用（已有），**补齐 a11y 与行为测试** |
| `custom-select.mjs` | 465 | `renderCustomSelect` / `getCustomSelect` / `createCustomSelect` | **13 模块** | 受控 + 非受控混用（`open`/`value`；内部 `highlight`） | `combobox`/`listbox`/`option`/`aria-activedescendant`（已有），需唯一 ID | `custom-select.test.mjs` 239 行，8 例 | 复用（已有），**修 ID 缺陷 + 补键盘/清理测试** |
| `data-table.mjs` | 343 | `createDataTable` | 3 模块（journal / alarm / frames） | 选中行由调用方持有；虚拟化内部持有 | 需 `ariaLabel/ariaLabelledBy`、`aria-selected`、resizer 名称（**当前缺**） | `data-table.test.mjs` 182 行，5 例（含 5000 行虚拟化） | 复用（已有），**补 a11y/选择/顺序契约** |
| `modal-dialog.mjs` | 234 | `renderModalDialog` / `createModalDialog` | 3 模块（`hmi/connection-overview`、`connection-panel`、`connection-workspace`） | `open` 由调用方持有；焦点由组件负责（**当前无**） | 需 `role=dialog`/`aria-modal`/`aria-labelledby`、Escape、焦点进入与恢复（**当前缺**） | `modal-dialog.test.mjs` 114 行，4 例（仅结构 + 包装器） | 复用（已有），**补生命周期** |
| `save-cancel-buttons.mjs` | 42 | `renderCancelButton` / `renderSaveButton` / `renderSaveCancelGroup` / `createSaveCancelGroup` | 4 模块 / 6 处（settings、device-form、device-card-item、csv-transfer、connection-form） | 无（纯呈现） | 需可访问名称（`t()` 文案）；loading/disabled | **无直接测试** | 复用（已有），**补测试**；后续由 `button.mjs` 收编 |
| `toggle-switch.mjs` | 51 | `renderToggleSwitch` / `createToggleSwitch` | **1 模块**（`settings/settings-page`） | `checked` 受控 | 需可访问名称与 `role=switch`/`aria-checked` | **无直接测试** | **待第二调用方**（见 §2.4） |
| `source-editor.mjs` | 199 | `createSourceEditor` 等 | 3 模块（debug project/runtime 预览） | `EditorView` 内部持有，`props` 变化决定重建 | fallback `<pre>` 需标签；`data-rel`/`data-jump-line` 契约 | **无行为测试**（仅 `ui-module-split` 引用） | 复用（已有），**补生命周期测试** |
| `viz-grid.mjs` | 130 | `createVizGrid` 等 | 3 模块（visualization） | GridStack 实例内部持有；`syncingRef` 防环 | widget 需标签（**当前缺**） | `viz-grid.test.mjs` 269 行，8 例 | 复用（已有），**补重渲染/卸载** |

**汇总**：8 个组件共 29 个生产模块直接使用（与计划 §2 基线一致）；其中 **5 个已调用方充足**，
`toggle-switch` 缺第二调用方，`save-cancel-buttons` / `source-editor` 缺行为测试。

## 2. 候选人逐项结论

计划 §P1-1 列出的 13 个候选项，逐项给出证据与结论。

### 2.1 Dialog（`modal-dialog.mjs`）— **复用**

| 事实 | 值 |
|---|---|
| 实现 | `src/ui/components/modal-dialog.mjs`（264 行） |
| 调用方 | `hmi/connection-overview.mjs:54`、`hmi/connection-panel.mjs:254`、`hmi/connection-workspace.mjs:56` |
| 受保护 class | `dvb-dialog-*`（`dvb-dialog-icon` 等，10 处） |
| 现状缺口 | 无 Escape、无初始焦点、无焦点恢复、无 `role=dialog`/`aria-modal`/`aria-labelledby`；确认按钮无 loading |
| 领域特殊情况 | `hmi/keil-log-dialog` 是日志查看器，**不复用**本 Dialog（结构差异大，登记为领域特有） |

结论：**复用**。P2-1 补直接测试，P2-3 补生命周期契约，P3-3 收敛表单/弹层模式。

### 2.2 Drawer — **领域特有（暂不抽）**

| 事实 | 值 |
|---|---|
| 实现 | `src/ui/monitor/frames/frames-detail-drawer.mjs`；`src/ui/monitor/visualization/components/viz-editor-panel.mjs` |
| class | `dvb-viz-drawer-*`（head/body/footer/close/title，5 个家族） |
| 调用方 | 各 1 个功能域（frames 详情、viz 编辑） |

结论：**领域特有**。两者视觉容器与生命周期细节不同，目前各只有一个调用方。
P3-3 允许 `patterns/drawer` 复用 Dialog 的**焦点/关闭/ARIA 契约**，但不得复制静默实现；
第二个真实调用方出现前不建公共 Drawer。

### 2.3 Select（`custom-select.mjs`）— **复用（已有缺陷）**

| 事实 | 值 |
|---|---|
| 调用方 | 13 个生产模块（debug 4 / hmi 5 / monitor 4） |
| 入口 | `getCustomSelect(React)`（WeakMap 缓存）、`renderCustomSelect`（纯渲染）、`createCustomSelect` |
| **已确认缺陷** | 无显式 `id` 时统一回退 `dvb-select`，同页多个 Select 产生重复 `listbox` ID |
| 测试缺口 | 未覆盖 ArrowUp/Down/Home/End/Tab、disabled option 选择路径、外部点击、监听清理、多实例 ID |

结论：**复用**。P2-3 前先修 ID（`useId()` 优先 + 工厂递增兜底 + 显式 `id` 最高优先）。

### 2.4 Toggle — **重复待合并**

| 实现 | 位置 | class | 调用方 |
|---|---|---|---|
| 公共组件 | `src/ui/components/toggle-switch.mjs` | `dvb-setting-switch` | `settings/settings-page.mjs:146`（**唯一**） |
| 内联实现 | `src/ui/hmi/connection-form.mjs:308-344` | `dvb-setting-switch` + `-thumb` | 仿真连接开关 |

`connection-form.mjs` 自己在 `createElement` 里重建了同一套 `role=switch` + `dvb-setting-switch` 结构。
`debug` / `monitor` 无开关实现（已确认）。

结论：**重复待合并**。公共组件确实成立（第二调用方是 HMI 仿真开关），但顺序必须是
**先迁 HMI 调用方，再改 API**，避免为抽象而抽象。同时 `toggle-switch.mjs` 现有
`onClick` + 手写 Enter/Space `onKeyDown` 有重复触发风险，需先写失败回归测试再定夺。

### 2.5 Tabs / Panel（`primitives.mjs`）— **复用（调用方集中在 debug）**

| 事实 | 值 |
|---|---|
| 调用方 | 5 个 debug 模块 / 11 处 |
| 缺口 | 无 `role=tablist`/`tab`/`tabpanel`、无键盘左右切换 |

结论：**复用**。P3-4 把 `debug/runtime` 的 Panel/Tabs/Hint 用法统一到公共 API，并补 a11y。
若 HMI/监控页出现结构相同的 panel header/body，再评估扩展调用方。

### 2.6 Hint / EmptyState — **重复待合并（新建 `empty-state.mjs`）**

| 事实 | 值 |
|---|---|
| 现有 | `createHint`（debug 用）、`src/ui/monitor/visualization/components/viz-empty-state.mjs`（viz 用） |
| 重复结构 | frames / journal / alarm 页面各自写空状态；`dvb-empty-*` 出现在 5 个 src 文件 |
| 调用方 | Frames、Journal、Alarm（≥2 功能域） |

结论：**重复待合并**。按计划 §5.4 建 `empty-state.mjs`（`kind: empty|loading|error`），
先迁 Frames / Journal / Alarm，业务恢复动作由页面传入；viz 的 `viz-empty-state` 保留领域投影，
在第二个调用方确认后评估是否改为薄投影层。`createHint` 与 EmptyState 语义不同（提示 vs 状态），
不强行合并。

### 2.7 StatusBadge — **重复待合并（新建 `status-badge.mjs`）**

| 事实 | 值 |
|---|---|
| 现有 | 无公共组件 |
| 重复结构 | `settings/settings-page.mjs`、`hmi/device-card-item.mjs` 各自拼状态标签；`dvb-status` 3 文件、`dvb-badge` 18 文件 |
| 调用方 | ≥2 功能域（settings、hmi），展示型 |

结论：**重复待合并**。只负责 `kind + label + title` 呈现，不接收设备/告警/任务对象；
领域模块先投影为公共 `kind`。

### 2.8 FormActions（`save-cancel-buttons.mjs`）— **复用（转型为 pattern）**

| 事实 | 值 |
|---|---|
| 调用方 | 6 处 / 4 模块，分散在 settings、hmi（device-form、device-card-item、csv-transfer、connection-form） |
| 缺口 | 无直接测试；按钮逻辑未来应由 `button.mjs` 收编 |

结论：**复用 → `patterns/form-actions`**。先补直接测试（P2-1），再由 Button 收编（P3-3），
最终移入 `src/ui/patterns/`。

### 2.9 Table（`data-table.mjs`）— **复用（已收敛 3 调用方）**

| 事实 | 值 |
|---|---|
| 调用方 | `journal-page.mjs`、`alarm-page.mjs`、`frames-page.mjs` |
| 周边重复 | `dvb-col-resizer` 13 处；frames 另有 `use-frame-col-widths.mjs` 列宽持久化 |
| 缺口 | 无 `ariaLabel`、无 `aria-selected`、resizer 无可访问名称 |

结论：**复用**。P3-2 收敛 FilterToolbar / Pagination / 列宽持久化 / 详情面板组合，
一个功能域一个提交；保留 5000 行虚拟化回归。

### 2.10 FilterToolbar — **重复待合并**

| 实现 | 位置 |
|---|---|
| `journal-filter-toolbar.mjs` | `src/ui/monitor/journal/` |
| `alarm-filter-toolbar.mjs` | `src/ui/monitor/alarms/` |
| `frames-filter-toolbar.mjs` | `src/ui/monitor/frames/` |

`dvb-filter-item` / `dvb-filter-label` 在 3 个功能域出现，结构一致（过滤控件布局 + 清空区）。

结论：**重复待合并** → `patterns/filter-toolbar`。只负责布局/折叠/clear 区域，**不拥有过滤规则**。
按 Frames → Journal → Alarm 分批迁移，一个功能域一个提交。

### 2.11 Pagination — **不值得抽取（当前）**

| 事实 | 值 |
|---|---|
| 出现 | 仅 `src/ui/monitor/journal/journal-page.mjs` 一个真实调用方（另有 `styles/sidebar.mjs` 定义） |

结论：**不值得抽取**。单调用方，且与 Journal 的分页语义耦合。保持领域私有；
出现第二个调用方再评估。

### 2.12 DetailCard / 详情布局 — **领域特有（暂不抽）**

| 实现 | 调用方 |
|---|---|
| `journal-detail-card.mjs` | Journal |
| `alarm-detail-card.mjs` | Alarm |
| `dvb-detail-k` / `dvb-detail-v` | 3 个 src 文件，11 处 |

结论：**领域特有**。键值行骨架相同，但字段集与操作不同。P3-2 评估
`patterns/detail-layout` 时只抽 **master/detail 布局骨架**（不拥有选中状态），
`journal-detail-card` 与 `alarm-detail-card` 的 `dvb-detail-k/v` 重复**登记为待合并项**，
由 P3-2 在 Frames 迁移后决定是否抽 `detail-kv` 原子。

### 2.13 其它已登记的模式

| 项 | 证据 | 结论 |
|---|---|---|
| Button | `dvb-btn` 151 处、`dvb-btn-sm` 72、`dvb-btn-primary` 40、`dvb-btn-danger` 7，但**无公共 Button** | **重复待合并** → 新建 `button.mjs`（P2-3 → P3-3） |
| 列 resize handle | `dvb-col-resizer` 13 处、`dvb-resizing-col` 10 处 | 复用（`data-table` 已拥有），补可访问名称 |
| 图谱节点 | `dvb-graph-node` 9 处 | 领域特有（专门交互语义），**不改成 Button** |
| 日志查看器 | `hmi/keil-log-dialog` | 领域特有，不复用 Dialog |
| 虚拟化列宽持久化 | `frames/use-frame-col-widths.mjs` | 领域私有，P3-2 评估是否上提 |

## 3. 结论汇总

| 类别 | 项 |
|---|---|
| **复用（已有，补测试/a11y）** | Panel/Tabs/Hint、CustomSelect、DataTable、ModalDialog、SaveCancel、SourceEditor、VizGrid |
| **重复待合并** | ToggleSwitch（HMI 内联）、EmptyState（3 域）、StatusBadge（≥2 域）、FilterToolbar（3 域）、Button（全局）、`detail-kv`（2 域，P3-2 评估） |
| **领域特有** | Drawer（frames/viz）、DetailCard（journal/alarm）、图谱节点、日志查看器、Journal Pagination、frames 列宽 |
| **不值得抽取** | Journal Pagination（单调用方） |

## 4. 对后续任务的输入

1. **P1-2 / P1-3**：以本清单的 8 个现有组件为规范对象；测试 harness 优先服务
   `primitives`、`custom-select`、`data-table`。
2. **P2-1**：组件直接测试缺口 = `toggle-switch`、`source-editor`（**零**行为测试）
   + `save-cancel-buttons`（**零**）+ `modal-dialog`/`primitives`（仅结构）。
3. **P2-3 顺序修正**：`toggle-switch` 必须**先迁 HMI `connection-form` 仿真开关**，
   再改 API；否则该组件仍是单调用方。
4. **P3 新建组件**：`empty-state`、`status-badge`、`button`、`patterns/*` 均需在
   第二个真实调用方完成迁移后才移入公共层（计划 §5.4）。
5. **不做**：Journal Pagination、图谱节点按钮化、日志查看器 Dialog 化、文本容器组件化。

## 5. 证据复现

```sh
cd dsh-vision-bench
# 调用方计数
grep -rn "components/<name>.mjs" src --include='*.mjs'
# class 家族分布
grep -rho "dvb-[a-z0-9-]*" src --include='*.mjs' | sort | uniq -c | sort -rn
# 超限文件
find src -name '*.mjs' -exec wc -l {} + | awk '$1>400'
find test -name '*.mjs' -exec wc -l {} + | awk '$1>350'
```
