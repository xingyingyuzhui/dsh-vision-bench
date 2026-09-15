// @ts-check
/**
 * Public UI component contract ledger (ADR-025).
 *
 * This is the machine-readable companion to the component inventory
 * (`docs/plans/2026-09-15-002-component-and-pattern-inventory.md`). It records,
 * for every module in the public UI layer, how it relates to the ADR-025
 * contract today so later tasks (P2-3 unification, P5 gates) have one owner
 * list to converge on instead of re-deriving it.
 *
 * It is inert data: nothing in the client imports this module. The P5 gates
 * (`check-component-api`, `check-ui-ownership`) read it.
 */

/** ADR-025 contract rule ids, kept short for the matrix below. */
export const CONTRACT_RULES = /** @type {const} */ ({
  D1: 'factory entry point createX(React), stable across renders',
  D2: 'renderX only for pure, hook-free rendering',
  D3: 'i18n / vendor / host deps injected, no globals',
  D4: 'intent reported through props only',
  D5: 'uniform className/style/disabled/loading/aria props',
  D6: 'component owns ARIA structure, feature owns content',
  D7: 'controlled vs uncontrolled is explicit',
  D8: 'no throw on user data; i18n fallback never empty',
  D9: 'unmount cleanup asserted in tests',
  D10: '@ts-check plus src/types/ui-*.d.ts references',
  D11: 'direct file imports, no barrel index.mjs',
})

/**
 * @typedef {'compliant' | 'gap' | 'n/a'} RuleStatus
 * @typedef {{
 *   id: string,
 *   path: string,
 *   exports: string[],
 *   callers: number,
 *   stateOwner: string,
 *   tests: string[],
 *   ruleStatus: Record<string, RuleStatus>,
 *   gaps: string[],
 *   migrationTask: string,
 * }} ComponentEntry
 */

/** @type {ComponentEntry[]} */
export const COMPONENT_ENTRIES = [
  {
    id: 'primitives',
    path: 'src/ui/components/primitives.mjs',
    exports: ['createPanel', 'createTabs', 'createHint'],
    callers: 6,
    stateOwner: 'caller (activeTab, open)',
    tests: ['test/ui/primitives.test.mjs'],
    ruleStatus: { D1: 'compliant', D2: 'n/a', D3: 'compliant', D4: 'compliant', D5: 'gap', D6: 'gap', D7: 'compliant', D8: 'gap', D9: 'n/a', D10: 'compliant', D11: 'compliant' },
    gaps: ['Tabs 无 role=tablist/tab 与键盘切换', 'className/style/aria 参数未统一', '测试仅验 class 名'],
    migrationTask: 'P2-1 补行为测试；P2-3 统一 API；P3-4 迁移调用方',
  },
  {
    id: 'custom-select',
    path: 'src/ui/components/custom-select.mjs',
    exports: ['renderCustomSelect', 'getCustomSelect', 'createCustomSelect'],
    callers: 13,
    stateOwner: 'controlled open/value, internal highlight',
    tests: ['test/ui/custom-select.test.mjs'],
    ruleStatus: { D1: 'compliant', D2: 'compliant', D3: 'compliant', D4: 'compliant', D5: 'gap', D6: 'gap', D7: 'gap', D8: 'gap', D9: 'gap', D10: 'gap', D11: 'compliant' },
    gaps: ['无 id 时回退 dvb-select，同页多实例重复 ID', 'open/value 受控与非受控混用', '键盘 Home/End/Tab 与监听清理未测', '未声明 @ts-check'],
    migrationTask: 'P2-3 修 ID 与受控模式；P2-1 补键盘/清理测试',
  },
  {
    id: 'data-table',
    path: 'src/ui/components/data-table.mjs',
    exports: ['createDataTable'],
    callers: 3,
    stateOwner: 'caller holds selection, component holds virtualization',
    tests: ['test/ui/data-table.test.mjs', 'test/ui/frame-col-widths.test.mjs'],
    ruleStatus: { D1: 'compliant', D2: 'n/a', D3: 'compliant', D4: 'compliant', D5: 'gap', D6: 'gap', D7: 'compliant', D8: 'gap', D9: 'gap', D10: 'gap', D11: 'compliant' },
    gaps: ['无 ariaLabel/ariaLabelledBy', '选中行无 aria-selected', 'resizer 无可访问名称', 'onRowClick 与 extraOnClick 顺序未写契约', '未声明 @ts-check'],
    migrationTask: 'P2-1 补 a11y/选择/顺序；P3-2 收敛表格工具模式',
  },
  {
    id: 'modal-dialog',
    path: 'src/ui/components/modal-dialog.mjs',
    exports: ['renderModalDialog', 'createModalDialog'],
    callers: 3,
    stateOwner: 'caller holds open, component will own focus',
    tests: ['test/ui/modal-dialog.test.mjs'],
    ruleStatus: { D1: 'compliant', D2: 'gap', D3: 'compliant', D4: 'compliant', D5: 'gap', D6: 'gap', D7: 'compliant', D8: 'gap', D9: 'gap', D10: 'gap', D11: 'compliant' },
    gaps: ['无 Escape/初始焦点/焦点恢复', '无 role=dialog/aria-modal/aria-labelledby', 'renderModalDialog 承担了生命周期相关结构', '确认按钮无 loading', '未声明 @ts-check'],
    migrationTask: 'P2-3 补生命周期契约；P3-3 收敛表单/弹层模式',
  },
  {
    id: 'save-cancel-buttons',
    path: 'src/ui/components/save-cancel-buttons.mjs',
    exports: ['renderCancelButton', 'renderSaveButton', 'renderSaveCancelGroup', 'createSaveCancelGroup'],
    callers: 4,
    stateOwner: 'caller (pure presentation)',
    tests: [],
    ruleStatus: { D1: 'compliant', D2: 'compliant', D3: 'compliant', D4: 'compliant', D5: 'gap', D6: 'gap', D7: 'n/a', D8: 'gap', D9: 'n/a', D10: 'gap', D11: 'compliant' },
    gaps: ['无直接测试', 'className/aria 参数未统一', '缺 loading 语义', '未声明 @ts-check'],
    migrationTask: 'P2-1 补直接测试；P3-3 由 patterns/form-actions + Button 收编',
  },
  {
    id: 'toggle-switch',
    path: 'src/ui/components/toggle-switch.mjs',
    exports: ['renderToggleSwitch', 'createToggleSwitch'],
    callers: 1,
    stateOwner: 'controlled checked',
    tests: [],
    ruleStatus: { D1: 'compliant', D2: 'compliant', D3: 'compliant', D4: 'compliant', D5: 'gap', D6: 'gap', D7: 'compliant', D8: 'gap', D9: 'gap', D10: 'gap', D11: 'compliant' },
    gaps: ['单调用方（settings-page），HMI connection-form 自行重建同一结构', 'onClick + 手写 Enter/Space onKeyDown 可能重复触发', '无可访问名称强制', '无直接测试', '未声明 @ts-check'],
    migrationTask: 'P2-1 先写失败回归测试；P2-3 迁入 HMI 第二调用方后再改 API',
  },
  {
    id: 'source-editor',
    path: 'src/ui/components/source-editor.mjs',
    exports: ['createSourceEditor'],
    callers: 3,
    stateOwner: 'component holds EditorView instance',
    tests: [],
    ruleStatus: { D1: 'compliant', D2: 'n/a', D3: 'compliant', D4: 'compliant', D5: 'gap', D6: 'gap', D7: 'compliant', D8: 'gap', D9: 'gap', D10: 'gap', D11: 'compliant' },
    gaps: ['无行为测试（仅 ui-module-split 引用）', 'destroy 恰好一次未验证', 'fallback <pre> 无可访问标签', '未声明 @ts-check'],
    migrationTask: 'P2-1 补生命周期测试',
  },
  {
    id: 'viz-grid',
    path: 'src/ui/components/viz-grid.mjs',
    exports: ['createVizGrid'],
    callers: 3,
    stateOwner: 'component holds GridStack instance, syncingRef anti-loop',
    tests: ['test/ui/viz-grid.test.mjs'],
    ruleStatus: { D1: 'compliant', D2: 'n/a', D3: 'compliant', D4: 'compliant', D5: 'gap', D6: 'gap', D7: 'compliant', D8: 'gap', D9: 'gap', D10: 'gap', D11: 'compliant' },
    gaps: ['widget 无可访问标签', '重渲染/卸载顺序未测', '未声明 @ts-check'],
    migrationTask: 'P2-1 补重渲染与卸载用例',
  },
]

/** Modules the P5 gates expect to exist but that land with P2/P3. */
export const PLANNED_COMPONENTS = /** @type {const} */ ([
  { id: 'button', path: 'src/ui/components/button.mjs', task: 'P2-3 / P3-3' },
  { id: 'empty-state', path: 'src/ui/components/empty-state.mjs', task: 'P3-1' },
  { id: 'status-badge', path: 'src/ui/components/status-badge.mjs', task: 'P3-1' },
  { id: 'form-actions', path: 'src/ui/patterns/form-actions.mjs', task: 'P3-3' },
  { id: 'filter-toolbar', path: 'src/ui/patterns/filter-toolbar.mjs', task: 'P3-2' },
  { id: 'detail-layout', path: 'src/ui/patterns/detail-layout.mjs', task: 'P3-2' },
  { id: 'drawer', path: 'src/ui/patterns/drawer.mjs', task: 'P3-3' },
])

/**
 * Every public module is exempt from exactly these rules, with a reason.
 * Empty for now: the ledger above is the work list, not a permission list.
 *
 * @type {Array<{ path: string, rule: string, reason: string, until: string }>}
 */
export const CONTRACT_EXEMPTIONS = []
