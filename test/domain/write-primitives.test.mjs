import assert from 'node:assert/strict'
import test from 'node:test'
import { recipePair } from '../../bench-devices.mjs'
import { isWritableFunction, normalizeWriteValues, segmentCovering, writeTargetOf } from '../../bench-points.mjs'
import { handlePdu } from '../../bench-slave.mjs'

test('writeTargetOf marks coils and holding registers writable', async () => {
  assert.equal(writeTargetOf(1).writable, true)
  assert.equal(writeTargetOf(1).single, 5)
  assert.equal(writeTargetOf(1).multi, 15)
  assert.equal(writeTargetOf(3).writable, true)
  assert.equal(writeTargetOf(3).single, 6)
  assert.equal(writeTargetOf(3).multi, 16)
  assert.equal(writeTargetOf(2).writable, false)
  assert.equal(writeTargetOf(4).writable, false)
  assert.equal(isWritableFunction(3), true)
  assert.equal(isWritableFunction(4), false)
})

test('normalizeWriteValues validates kinds, ranges and batch caps', async () => {
  assert.deepEqual(normalizeWriteValues(3, [12], 10), {
    ok: true,
    kind: 'register',
    fc: 6,
    values: [12],
  })
  assert.deepEqual(normalizeWriteValues(3, [1, 2, 3], 10), {
    ok: true,
    kind: 'register',
    fc: 16,
    values: [1, 2, 3],
  })
  assert.deepEqual(normalizeWriteValues(1, [true], 10).fc, 5)
  assert.equal(normalizeWriteValues(1, [2], 10).ok, false)
  assert.equal(normalizeWriteValues(3, [-1], 10).ok, false)
  assert.equal(normalizeWriteValues(3, [70000], 10).ok, false)
  assert.equal(normalizeWriteValues(3, [1.5], 10).ok, false)
  assert.equal(normalizeWriteValues(2, [1], 10).ok, false)
  assert.equal(normalizeWriteValues(4, [1], 10).ok, false)
  const tooMany = new Array(124).fill(1)
  assert.equal(normalizeWriteValues(3, tooMany, 1968).ok, false)
})

test('segmentCovering finds the owning segment only inside its range', async () => {
  const segments = [
    { id: 'a', function: 3, address: 0, count: 10 },
    { id: 'b', function: 1, address: 20, count: 4 },
  ]
  assert.equal(segmentCovering(segments, 3, 9).id, 'a')
  assert.equal(segmentCovering(segments, 3, 10), null)
  assert.equal(segmentCovering(segments, 1, 23).id, 'b')
  assert.equal(segmentCovering(segments, 3, 23), null)
})

test('slave handlePdu echoes single writes and reports them', async () => {
  const device = {
    ...recipePair().devices[1],
    segments: [
      { id: 'hr', name: '保持', function: 3, address: 0, count: 10 },
      { id: 'coil', name: '线圈', function: 1, address: 0, count: 8 },
    ],
  }
  const seen = []
  const fc6 = Buffer.from([6, 0, 3, 0x12, 0x34])
  const resp = handlePdu(device, fc6, 1_000_000, (fn, address, values) => seen.push({ fn, address, values }))
  assert.equal(resp[0], 6)
  assert.equal(resp.readUInt16BE(1), 3)
  assert.equal(resp.readUInt16BE(3), 0x1234)
  assert.deepEqual(seen, [{ fn: 3, address: 3, values: [0x1234] }])
  seen.length = 0
  const fc5 = Buffer.from([5, 0, 2, 0xff, 0])
  handlePdu(device, fc5, 1_000_000, (fn, address, values) => seen.push({ fn, address, values }))
  assert.deepEqual(seen, [{ fn: 1, address: 2, values: [1] }])
})

test('slave handlePdu applies batch writes FC15/FC16', async () => {
  const device = {
    ...recipePair().devices[1],
    segments: [
      { id: 'hr', name: '保持', function: 3, address: 0, count: 10 },
      { id: 'coil', name: '线圈', function: 1, address: 20, count: 8 },
    ],
  }
  const seen = []
  const regs = Buffer.alloc(6 + 4)
  regs[0] = 16
  regs.writeUInt16BE(4, 1)
  regs.writeUInt16BE(2, 3)
  regs[5] = 4
  regs.writeUInt16BE(100, 6)
  regs.writeUInt16BE(200, 8)
  const resp = handlePdu(device, regs, 1_000_000, (fn, address, values) => seen.push({ fn, address, values }))
  assert.equal(resp[0], 16)
  assert.deepEqual(seen, [{ fn: 3, address: 4, values: [100, 200] }])
  seen.length = 0
  const coils = Buffer.alloc(6 + 1)
  coils[0] = 15
  coils.writeUInt16BE(20, 1)
  coils.writeUInt16BE(3, 3)
  coils[5] = 1
  coils[6] = 0b101
  handlePdu(device, coils, 1_000_000, (fn, address, values) => seen.push({ fn, address, values }))
  assert.deepEqual(seen, [{ fn: 1, address: 20, values: [1, 0, 1] }])
})

test('slave handlePdu rejects writes outside declared segments', async () => {
  const device = recipePair().devices[1]
  const outside = Buffer.from([6, 0, 50, 0, 7])
  const resp = handlePdu(device, outside, 1_000_000, () => {
    throw new Error('should not persist')
  })
  assert.equal(resp[0], 6 | 0x80)
  assert.equal(resp[1], 2)
  const badCoil = Buffer.from([5, 0, 0, 0x12, 0x34])
  assert.equal(handlePdu(device, badCoil, 1_000_000)[1], 3)
})
