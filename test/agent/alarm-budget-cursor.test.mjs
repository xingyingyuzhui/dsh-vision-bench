// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { AGENT_TEXT_CAPS, utf8ByteLength } from '../../src/application/commands/agent-result-caps.mjs'
import { projectAgentResult } from '../../src/application/commands/agent-result-projection.mjs'

/**
 * @param {number} count
 * @param {string} ackedBy
 */
function alarms(count, ackedBy) {
  /** @type {Record<string, any>} */
  const out = {}
  for (let i = 0; i < count; i += 1) {
    const id = `p${String(i).padStart(3, '0')}`
    out[id] = {
      group: 'process',
      pointId: id,
      condition: 'active',
      status: 'acked',
      acknowledged: true,
      occurredAt: 1_000 + i,
      clearedAt: 2_000 + i,
      ackedAt: 3_000 + i,
      ackedBy,
      count: 1,
    }
  }
  return out
}

test('alarm budget shrink keeps a continuous cursor across 100 ids', () => {
  const raw = { ok: true, action: 'alarm', alarms: alarms(100, 'user-'.repeat(180)) }
  /** @type {string[]} */
  const seen = []
  let offset = 0
  for (let guard = 0; guard < 100; guard += 1) {
    const page = projectAgentResult({ action: 'alarm', limit: 40, offset }, raw)
    assert.equal(page.ok, true, page.error)
    assert.ok(utf8ByteLength(page) <= AGENT_TEXT_CAPS.alarmBytes)
    const ids = Object.keys(page.alarms)
    assert.equal(page.returned, ids.length)
    assert.ok(ids.length > 0)
    const kept = ids[0]
    assert.equal(page.alarms[kept].acknowledged, true)
    assert.equal(page.alarms[kept].occurredAt > 0, true)
    assert.equal(page.alarms[kept].ackedBy.length > 0, true)
    seen.push(...ids)
    if (!page.nextCursor) break
    const next = Number(page.nextCursor)
    assert.equal(next, offset + ids.length)
    offset = next
  }
  assert.equal(seen.length, 100)
  assert.equal(new Set(seen).size, 100)
  assert.deepEqual(seen, Array.from({ length: 100 }, (_, i) => `p${String(i).padStart(3, '0')}`))
})

test('a single oversized alarm is RESULT_TOO_LARGE and is not consumed', () => {
  const id = 'p-fat'
  const raw = {
    ok: true,
    action: 'alarm',
    commandId: 'cmd-1',
    alarms: {
      [id]: {
        group: 'process',
        pointId: id,
        acknowledged: true,
        occurredAt: 5,
        clearedAt: 6,
        ackedAt: 7,
        ackedBy: 'x'.repeat(40_000),
        count: 2,
      },
    },
  }
  const detail = projectAgentResult({ action: 'alarm', alarmId: id }, raw)
  assert.equal(detail.ok, false)
  assert.equal(detail.errorCode, 'RESULT_TOO_LARGE')
  assert.equal(detail.overrun, true)
  assert.equal(detail.truncated, true)
  assert.equal(detail.retryable, false)
  assert.equal(detail.returned, 0)
  assert.equal(detail.nextCursor, null)
  assert.equal(detail.alarmId, id)
  assert.equal(detail.commandId, 'cmd-1')
  assert.match(detail.error, /Vision UI/)
  assert.equal(detail.alarms, undefined)

  const page = projectAgentResult({ action: 'alarm', limit: 40 }, raw)
  assert.equal(page.ok, false)
  assert.equal(page.errorCode, 'RESULT_TOO_LARGE')
  assert.equal(page.nextCursor, null)
  assert.equal(page.alarmId, id)
})

test('an extreme alarm id is fingerprinted inside RESULT_TOO_LARGE', () => {
  const id = 'p'.repeat(400)
  const raw = {
    ok: true,
    action: 'alarm',
    alarms: { [id]: { group: 'process', pointId: 'p', ackedBy: 'x'.repeat(40_000), occurredAt: 1 } },
  }
  const page = projectAgentResult({ action: 'alarm', alarmId: id }, raw)
  assert.equal(page.ok, false)
  assert.equal(page.errorCode, 'RESULT_TOO_LARGE')
  assert.equal(page.alarmId.length <= 16, true)
  assert.notEqual(page.alarmId, id)
  assert.ok(utf8ByteLength(page) <= AGENT_TEXT_CAPS.alarmBytes)
})
