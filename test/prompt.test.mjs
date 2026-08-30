import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeLog, normalizeEvent } from '../bench-prompt.mjs'

test('normalizeEvent caps summary and defaults action', async () => {
  const ev = normalizeEvent({ action: 'read', ok: true, summary: 'x'.repeat(400), at: 1 })
  assert.equal(ev.action, 'read')
  assert.equal(ev.ok, true)
  assert.equal(ev.at, 1)
  assert.ok(ev.summary.length <= 180)
})

test('mergeLog keeps newest first with a hard cap', async () => {
  let log = []
  for (let i = 0; i < 12; i++) log = mergeLog(log, { action: 'build', ok: true, summary: 'n' + i, at: i + 1 })
  assert.equal(log.length, 8)
  assert.equal(log[0].summary, 'n11')
})
