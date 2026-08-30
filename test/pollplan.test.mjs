import assert from 'node:assert/strict'
import test from 'node:test'
import { planReadBatches, planScopedReadBatches } from '../bench-pollplan.mjs'

test('planReadBatches merges contiguous same-FC addresses', async () => {
  const batches = planReadBatches([
    { function: 3, address: 2 },
    { function: 3, address: 0 },
    { function: 3, address: 1 },
    { function: 1, address: 0 },
  ])
  assert.deepEqual(
    batches.find((b) => b.fc === 3),
    { fc: 3, address: 0, count: 3 },
  )
})

test('planScopedReadBatches never merge across connection/device/unit', async () => {
  const scopes = planScopedReadBatches([
    { connectionId: 'c1', deviceId: 'd1', unitId: 1, function: 3, address: 0 },
    { connectionId: 'c1', deviceId: 'd1', unitId: 1, function: 3, address: 1 },
    { connectionId: 'c1', deviceId: 'd2', unitId: 2, function: 3, address: 2 },
    { connectionId: 'c2', deviceId: 'd3', unitId: 1, function: 3, address: 0 },
  ])
  assert.equal(scopes.length, 3)
  const same = scopes.find((s) => s.deviceId === 'd1')
  assert.equal(same.batches.length, 1)
  assert.equal(same.batches[0].count, 2)
  assert.equal(same.batches[0].connectionId, 'c1')
  assert.ok(
    scopes.every((s) =>
      s.batches.every((b) => b.connectionId === s.connectionId && b.deviceId === s.deviceId && b.unitId === s.unitId),
    ),
  )
})
