/**
 * Protected UI class roots → sole implementation owner (P5-2 / ADR-025 D12).
 * Styles under src/ui/styles/ and tests are excluded by the checker.
 */
export const UI_OWNERS = {
  'dvb-select': 'src/ui/components/custom-select.mjs',
  'dvb-data-table': 'src/ui/components/data-table.mjs',
  'dvb-dialog': 'src/ui/components/modal-dialog.mjs',
  'dvb-setting-switch': 'src/ui/components/toggle-switch.mjs',
  'dvb-debug-panel': 'src/ui/components/primitives.mjs',
}

/**
 * Exact production paths temporarily allowed to emit a protected root class.
 * Each entry: { file, token, owner, reason, stage }
 */
export const UI_OWNERSHIP_ALLOWLIST = [
  // Filter toolbars use layout hooks named dvb-select-* but not the root `dvb-select` token.
  // Kept empty on purpose — root-token matching avoids those false positives.
]
