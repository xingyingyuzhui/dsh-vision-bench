// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeLog, normalizeEvent } from '../../src/domain/prompt/prompt-log.mjs'
import { recordBenchEvent } from '../../src/infrastructure/store/journal-store.mjs'
import { loadWorkspace } from '../../bench-store.mjs'
import { createBench } from '../helpers/workspace-factory.mjs'

test('normalizeEvent: unknown action becomes event, never build', () => {
  const row = normalizeEvent({ action: 'weird-thing', ok: true, summary: 'x' })
  assert.equal(row.action, 'event')
  assert.equal(row.kind, 'event')
  assert.equal(row.schemaVersion, 2)
  assert.equal(row.legacyTypeUnverified, undefined)
})

test('normalizeEvent: known alarm/focus keep type; legacy build marked unverified', () => {
  assert.equal(normalizeEvent({ action: 'alarm', ok: false, summary: 'a' }).kind, 'alarm')
  assert.equal(normalizeEvent({ action: 'focus', ok: true, summary: 'f' }).kind, 'focus')
  const legacy = normalizeEvent({ action: 'build', ok: true, summary: 'old' })
  assert.equal(legacy.action, 'build')
  assert.equal(legacy.legacyTypeUnverified, true)
  const v2Build = normalizeEvent({ action: 'build', kind: 'build', schemaVersion: 2, ok: true, summary: 'new' })
  assert.equal(v2Build.legacyTypeUnverified, undefined)
})

test('mergeLog: remormalize does not demote alarm to build', () => {
  const once = mergeLog([], { action: 'alarm', ok: false, summary: 'trip' })
  assert.equal(once[0].action, 'alarm')
  const twice = mergeLog(once, { action: 'alarm-clear', ok: true, summary: 'clear' })
  assert.equal(twice[0].action, 'alarm-clear')
  assert.equal(twice[1].action, 'alarm')
  const thrice = mergeLog(twice, { action: 'focus', ok: true, summary: 'focus' })
  assert.deepEqual(
    thrice.map((r) => r.action),
    ['focus', 'alarm-clear', 'alarm'],
  )
})

test('recordBenchEvent: alarm→alarm-clear→focus→build stay typed after reload merge', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-log-kind-' })
  const { home, cwd } = bench
  await recordBenchEvent(home, cwd, { action: 'alarm', ok: false, summary: 'trip' }, { source: 'system' })
  await recordBenchEvent(home, cwd, { action: 'alarm-clear', ok: true, summary: 'clear' }, { source: 'system' })
  await recordBenchEvent(home, cwd, { action: 'focus', ok: true, summary: 'focus x' }, { source: 'user', sessionId: 's1' })
  await recordBenchEvent(home, cwd, { action: 'build', ok: true, summary: 'built', kind: 'build' }, { source: 'user' })
  const ws = loadWorkspace(home, cwd)
  const actions = (ws.log || []).map((/** @type {any} */ r) => r.action)
  assert.deepEqual(actions.slice(0, 4), ['build', 'focus', 'alarm-clear', 'alarm'])
  assert.ok((ws.log || []).every((/** @type {any} */ r) => r.schemaVersion === 2))
  const timelineKinds = (ws.timeline || []).map((/** @type {any} */ e) => e.kind)
  assert.ok(timelineKinds.includes('alarm'))
  assert.ok(timelineKinds.includes('focus'))
  assert.ok(timelineKinds.includes('build'))
  // Merge again via empty-ish event should not demote.
  const remapped = mergeLog(ws.log, { action: 'read', ok: true, summary: 'r' })
  assert.equal(remapped.find((r) => r.summary === 'trip')?.action, 'alarm')
})
