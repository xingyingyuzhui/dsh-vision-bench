import assert from 'node:assert/strict'
import test from 'node:test'
import { applyPointPatch } from '../../src/domain/modbus/point-patch.mjs'

test('applyPointPatch rejects a negative or non-finite alarmDeadband and keeps 0', () => {
  const base = {
    id: 'p1',
    connectionId: 'c1',
    deviceId: 'd1',
    name: 'T',
    alarmEnabled: true,
    alarmMax: 1,
  }
  const negative = applyPointPatch(base, { alarmDeadband: -0.1 })
  assert.equal(negative.ok, false)
  assert.equal(negative.errorCode, 'INVALID_FIELD')
  assert.equal(base.alarmDeadband, undefined, 'rejected patch must not mutate the input')
  const nan = applyPointPatch(base, { alarmDeadband: Number.NaN })
  assert.equal(nan.ok, false)
  assert.equal(nan.errorCode, 'INVALID_FIELD')
  const blank = applyPointPatch(base, { alarmDeadband: '' })
  assert.equal(blank.ok, true)
  assert.equal(blank.point.alarmDeadband, null)
  const zero = applyPointPatch(base, { alarmDeadband: 0 })
  assert.equal(zero.ok, true)
  assert.equal(zero.point.alarmDeadband, 0)
})
