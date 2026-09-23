// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { listPendingWrites } from '../../bench-actions.mjs'
import { runVisionBench } from '../helpers/run-vision-bench.mjs'
import { pendingWrites } from '../../src/application/modbus/modbus-runtime-context.mjs'
import { ERROR_CODES } from '../../src/domain/modbus/errors.mjs'
import { createBench, pointSeries } from '../helpers/workspace-factory.mjs'

const origin = { source: 'agent', sessionId: 's1' }

test('repeating the same agent write reuses the pending request', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-write-dedupe-' })
  const { home, cwd } = bench
  bench.save({ modbus: { conn: { sim: true }, points: pointSeries('保持', 4) } })
  const args = { action: 'write', function: 3, address: 1, values: [9] }
  const first = await runVisionBench(home, args, cwd, origin)
  const second = await runVisionBench(home, args, cwd, origin)
  assert.equal(first.errorCode, ERROR_CODES.APPROVAL_PENDING)
  assert.equal(second.deduped, true)
  assert.equal(second.requestId, first.requestId)
  assert.equal(second.errorCode, ERROR_CODES.APPROVAL_PENDING)
  assert.equal(listPendingWrites(cwd, 's1').length, 1)
  assert.match(String(first.requestId), /^[0-9a-f]{16}$/)
})

test('an expired duplicate is not reused', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-write-dedupe-expired-' })
  const { home, cwd } = bench
  bench.save({ modbus: { conn: { sim: true }, points: pointSeries('保持', 4) } })
  const args = { action: 'write', function: 3, address: 1, values: [3] }
  const first = await runVisionBench(home, args, cwd, origin)
  for (const entry of pendingWrites.values()) {
    if (entry.id === first.requestId) entry.createdAt = Date.now() - 6 * 60 * 1000
  }
  const second = await runVisionBench(home, args, cwd, origin)
  assert.equal(second.deduped, undefined)
  assert.notEqual(second.requestId, first.requestId)
  assert.equal(listPendingWrites(cwd, 's1').length, 1)
})

test('a workspace cannot queue more than 20 pending writes', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-write-queue-full-' })
  const { home, cwd } = bench
  bench.save({ modbus: { conn: { sim: true }, points: pointSeries('保持', 4) } })
  for (let value = 1; value <= 20; value += 1) {
    const ran = await runVisionBench(
      home,
      { action: 'write', function: 3, address: 1, values: [value] },
      cwd,
      origin,
    )
    assert.equal(ran.errorCode, ERROR_CODES.APPROVAL_PENDING, ran.error)
  }
  const full = await runVisionBench(
    home,
    { action: 'write', function: 3, address: 1, values: [21] },
    cwd,
    origin,
  )
  assert.equal(full.ok, false)
  assert.equal(full.errorCode, ERROR_CODES.APPROVAL_QUEUE_FULL)
  assert.equal(listPendingWrites(cwd, 's1').length, 20)
  const again = await runVisionBench(
    home,
    { action: 'write', function: 3, address: 1, values: [1] },
    cwd,
    origin,
  )
  assert.equal(again.deduped, true)
  assert.equal(listPendingWrites(cwd, 's1').length, 20)
})
