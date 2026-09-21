import assert from 'node:assert/strict'
import test from 'node:test'
import { TYPOGRAPHY_CSS } from '../../src/ui/styles/typography.mjs'
import { CSS } from '../../src/ui/styles/index.mjs'

test('typography declares semantic Vision tokens mapped to host aliases', () => {
  const root = TYPOGRAPHY_CSS[0]
  for (const name of [
    '--dvb-color-danger',
    '--dvb-color-brand',
    '--dvb-color-exec-line',
    '--dvb-space-control',
    '--dvb-radius-dialog',
    '--dvb-z-modal',
    '--dvb-mask-bg',
    '--dvb-bdr',
    '--dvb-focus-ring',
  ]) {
    assert.ok(root.includes(name), `missing ${name}`)
  }
  assert.ok(root.includes('--dsw-alias-label-danger'))
  assert.ok(root.includes('--dsw-alias-brand-primary'))
})

test('bundled CSS consumes Vision tokens for dialog and select chrome', () => {
  assert.ok(CSS.includes('var(--dvb-z-modal'))
  assert.ok(CSS.includes('var(--dvb-radius-dialog'))
  assert.ok(CSS.includes('var(--dvb-z-select'))
  assert.ok(CSS.includes('var(--dvb-z-popover'))
  assert.ok(CSS.includes('var(--dvb-color-exec-line'))
})
