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
    id: 'empty-state',
    path: 'src/ui/components/empty-state.mjs',
    exports: ['renderEmptyState', 'createEmptyState'],
    callers: 3,
    stateOwner: 'caller (pure presentation)',
    tests: ['test/ui/empty-state.test.mjs'],
    ruleStatus: { D1: 'compliant', D2: 'compliant', D3: 'compliant', D4: 'compliant', D5: 'compliant', D6: 'compliant', D7: 'n/a', D8: 'compliant', D9: 'n/a', D10: 'gap', D11: 'compliant' },
    gaps: ['未声明 @ts-check'],
    migrationTask: 'P3-1 Journal/Alarm/Frames detail 已迁移；HMI/Viz CTA 空态后续接入',
  },
  {
    id: 'primitives',
    path: 'src/ui/components/primitives.mjs',
    exports: ['createPanel', 'createTabs', 'createHint'],
    callers: 6,
    stateOwner: 'caller (activeTab, open)',
    tests: ['test/ui/primitives.test.mjs'],
    ruleStatus: { D1: 'compliant', D2: 'n/a', D3: 'compliant', D4: 'compliant', D5: 'gap', D6: 'compliant', D7: 'compliant', D8: 'gap', D9: 'n/a', D10: 'compliant', D11: 'compliant' },
    gaps: ['className/style/aria 参数未完全统一'],
    migrationTask: 'P2-3 Tabs a11y/键盘已落地；P3-4 迁移调用方',
  },
  {
    id: 'custom-select',
    path: 'src/ui/components/custom-select.mjs',
    exports: ['renderCustomSelect', 'getCustomSelect', 'createCustomSelect'],
    callers: 13,
    stateOwner: 'controlled open/value, internal highlight',
    tests: ['test/ui/custom-select.test.mjs'],
    ruleStatus: { D1: 'compliant', D2: 'compliant', D3: 'compliant', D4: 'compliant', D5: 'gap', D6: 'compliant', D7: 'gap', D8: 'gap', D9: 'gap', D10: 'gap', D11: 'compliant' },
    gaps: ['open/value 受控与非受控仍可混用（未强制）', '键盘 Home/End/Tab 与监听清理未全测', '未声明 @ts-check'],
    migrationTask: 'P2-3 多实例 useId 已落地；后续补受控模式强制',
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
    stateOwner: 'caller holds open; createModalDialog owns focus/Escape/titleId',
    tests: ['test/ui/modal-dialog.test.mjs', 'test/ui/modal-dialog-lifecycle.test.mjs'],
    ruleStatus: { D1: 'compliant', D2: 'compliant', D3: 'compliant', D4: 'compliant', D5: 'gap', D6: 'compliant', D7: 'compliant', D8: 'gap', D9: 'compliant', D10: 'gap', D11: 'compliant' },
    gaps: ['确认按钮无独立 loading 文案', '未声明 @ts-check'],
    migrationTask: 'P2-3 生命周期 + 生产接线已落地；P3-3 收敛表单/弹层模式',
  },
  {
    id: 'save-cancel-buttons',
    path: 'src/ui/components/save-cancel-buttons.mjs',
    exports: ['renderCancelButton', 'renderSaveButton', 'renderSaveCancelGroup', 'createSaveCancelGroup'],
    callers: 4,
    stateOwner: 'caller (pure presentation)',
    tests: ['test/ui/save-cancel-buttons.test.mjs'],
    ruleStatus: { D1: 'compliant', D2: 'compliant', D3: 'compliant', D4: 'compliant', D5: 'compliant', D6: 'compliant', D7: 'n/a', D8: 'gap', D9: 'n/a', D10: 'gap', D11: 'compliant' },
    gaps: ['未声明 @ts-check'],
    migrationTask: 'P2-3 loading≡saving + aria-busy 已落地；P3-3 由 patterns/form-actions + Button 收编',
  },
  {
    id: 'toggle-switch',
    path: 'src/ui/components/toggle-switch.mjs',
    exports: ['renderToggleSwitch', 'createToggleSwitch'],
    callers: 2,
    stateOwner: 'controlled checked',
    tests: ['test/ui/toggle-switch.test.mjs'],
    ruleStatus: { D1: 'compliant', D2: 'compliant', D3: 'compliant', D4: 'compliant', D5: 'gap', D6: 'compliant', D7: 'compliant', D8: 'gap', D9: 'compliant', D10: 'gap', D11: 'compliant' },
    gaps: ['无可访问名称强制（调用方负责）', '未声明 @ts-check'],
    migrationTask: 'P2-3 第二调用方已落地（connection-form）',
  },
  {
    id: 'source-editor',
    path: 'src/ui/components/source-editor.mjs',
    exports: ['createSourceEditor'],
    callers: 3,
    stateOwner: 'component holds EditorView instance',
    tests: ['test/ui/source-editor.test.mjs'],
    ruleStatus: { D1: 'compliant', D2: 'n/a', D3: 'compliant', D4: 'compliant', D5: 'gap', D6: 'gap', D7: 'compliant', D8: 'gap', D9: 'compliant', D10: 'gap', D11: 'compliant' },
    gaps: ['未声明 @ts-check'],
    migrationTask: 'P2-1 生命周期测试已落地',
  },
  {
    id: 'viz-grid',
    path: 'src/ui/components/viz-grid.mjs',
    exports: ['createVizGrid'],
    callers: 3,
    stateOwner: 'component holds GridStack instance, syncingRef anti-loop',
    tests: ['test/ui/viz-grid.test.mjs'],
    ruleStatus: { D1: 'compliant', D2: 'n/a', D3: 'compliant', D4: 'compliant', D5: 'gap', D6: 'gap', D7: 'compliant', D8: 'gap', D9: 'compliant', D10: 'gap', D11: 'compliant' },
    gaps: ['widget 标签可再补', '未声明 @ts-check'],
    migrationTask: 'P2-1 重渲染/卸载/只读测试已有',
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
