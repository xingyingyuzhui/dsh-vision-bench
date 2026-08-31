import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { focusEventKey } from '../../src/ui/hmi/hooks/use-agent-focus.mjs'

test('focusEventKey is stable for the same at/kind/target ids', () => {
  const a = {
    request: {
      at: 10,
      kind: 'frame',
      frameId: 'f1',
      connectionId: 'c1',
      visualizationId: '',
      alarmId: '',
      trendKey: '',
    },
  }
  const b = { request: { ...a.request } }
  assert.equal(focusEventKey(a), focusEventKey(b))
  assert.notEqual(focusEventKey(a), focusEventKey({ request: { ...a.request, at: 11 } }))
  assert.ok(focusEventKey({ request: { at: 1, visualizationId: 'v1', kind: 'visualization' } }).includes('v1'))
  assert.ok(focusEventKey({ request: { at: 1, alarmId: 'a1', kind: 'alarm' } }).includes('a1'))
  assert.ok(focusEventKey({ request: { at: 1, trendKey: 'c:d:p', kind: 'trend' } }).includes('c:d:p'))
})

test('useAgentFocus records lastShownFocusKey and depends on visualization/alarm/trend ids', () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../src/ui/hmi/hooks/use-agent-focus.mjs'),
    'utf8',
  )
  assert.match(src, /lastShownFocusKey/)
  assert.match(src, /visualizationId/)
  assert.match(src, /alarmId/)
  assert.match(src, /trendKey/)
  assert.match(src, /5000/)
})
