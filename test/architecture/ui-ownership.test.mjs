import assert from 'node:assert/strict'
import test from 'node:test'
import { checkUiOwnership, extractClassTokens } from '../../scripts/check-ui-ownership.mjs'
import { UI_OWNERS } from '../../scripts/ui-ownership-policy.mjs'

test('extractClassTokens splits className literals into CSS tokens', () => {
  const tokens = extractClassTokens(`
    { className: 'dvb-select is-open' }
    { className: \`dvb-dialog \${x}\` }
    { className: "dvb-data-table-row" }
  `)
  assert.ok(tokens.has('dvb-select'))
  assert.ok(tokens.has('dvb-dialog'))
  assert.ok(tokens.has('dvb-data-table-row'))
  assert.equal(tokens.has('dvb-data-table'), false)
})

test('UI_OWNERS covers the five protected roots', () => {
  assert.deepEqual(Object.keys(UI_OWNERS).sort(), [
    'dvb-data-table',
    'dvb-debug-panel',
    'dvb-dialog',
    'dvb-select',
    'dvb-setting-switch',
  ])
})

test('production UI graph respects ownership policy', () => {
  const result = checkUiOwnership()
  assert.equal(result.ok, true, result.violations.join('\n'))
})
