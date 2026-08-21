import assert from 'node:assert/strict'
import test from 'node:test'
import {
  compactValues,
  csvToSegments,
  decodeValue,
  evaluateAlarm,
  normalizeSegment,
  segmentsToCsv,
} from '../bench-points.mjs'
import { _internal } from '../bench-actions.mjs'

test('normalizeSegment keeps scale, offset, unit and alarm limits', () => {
  const seg = normalizeSegment({
    name: '温度', function: 3, address: 0, count: 2,
    scale: 0.1, offset: -40, unit: '°C', alarmMin: -10, alarmMax: 85,
  })
  assert.equal(seg.scale, 0.1)
  assert.equal(seg.offset, -40)
  assert.equal(seg.unit, '°C')
  assert.equal(seg.alarmMin, -10)
  assert.equal(seg.alarmMax, 85)
  const bare = normalizeSegment({ function: 3, address: 0, count: 1 })
  assert.equal(bare.scale, 1)
  assert.equal(bare.offset, 0)
  assert.equal(bare.unit, '')
  assert.equal(bare.alarmMin, null)
  assert.equal(bare.alarmMax, null)
})

test('decodeValue applies scale and offset, passes booleans through', () => {
  const seg = { scale: 0.5, offset: 10 }
  assert.equal(decodeValue(seg, 4), 12)
  assert.equal(decodeValue({ scale: 2 }, 3), 6)
  assert.equal(decodeValue({}, true), true)
  assert.equal(decodeValue({}, null), null)
})

test('evaluateAlarm reports min and max breaches', () => {
  const seg = { alarmMin: 10, alarmMax: 90 }
  assert.equal(evaluateAlarm(seg, 5), 'min')
  assert.equal(evaluateAlarm(seg, 95), 'max')
  assert.equal(evaluateAlarm(seg, 50), '')
  assert.equal(evaluateAlarm({ alarmMin: null, alarmMax: null }, 999), '')
  assert.equal(evaluateAlarm(seg, 'abc'), '')
})

test('CSV round-trip preserves segment metadata', () => {
  const segments = [
    { name: '温度', function: 3, address: 0, count: 2, scale: 0.1, offset: -40, unit: '°C', alarmMin: -10, alarmMax: 85 },
    { name: '开关', function: 1, address: 10, count: 4, scale: 1, offset: 0, unit: '', alarmMin: null, alarmMax: null },
  ]
  const csv = segmentsToCsv(segments)
  assert.match(csv, /name,function,address,count/)
  const back = csvToSegments(csv)
  assert.equal(back.ok, true)
  assert.equal(back.segments.length, 2)
  assert.equal(back.segments[0].scale, 0.1)
  assert.equal(back.segments[0].offset, -40)
  assert.equal(back.segments[0].unit, '°C')
  assert.equal(back.segments[0].alarmMin, -10)
  assert.equal(back.segments[0].alarmMax, 85)
  assert.equal(back.segments[1].function, 1)
  assert.equal(back.segments[1].alarmMax, null)
})

test('csvToSegments rejects empty input and missing columns', () => {
  assert.equal(csvToSegments('').ok, false)
  assert.equal(csvToSegments('a,b\n1,2').ok, false)
  const ok = csvToSegments('function,address,count\n3,0,4')
  assert.equal(ok.ok, true)
  assert.equal(ok.segments[0].count, 4)
})

test('deviceAlarms fires once per breach and clears on recovery', () => {
  const device = {
    segments: [{ id: 's1', name: '压力', function: 3, address: 0, count: 1, scale: 1, offset: 0, unit: 'kPa', alarmMin: null, alarmMax: 100 }],
    values: [],
  }
  const high = [{ key: 's1:3@0', segmentId: 's1', function: 3, address: 0, value: 120, ok: true }]
  const first = _internal.deviceAlarms(device, high)
  assert.equal(first.fired.length, 1)
  assert.deepEqual(first.next, { 's1:3@0': true })
  const again = _internal.deviceAlarms({ ...device, alarmActive: first.next }, high)
  assert.equal(again.fired.length, 0)
  const normal = [{ key: 's1:3@0', segmentId: 's1', function: 3, address: 0, value: 80, ok: true }]
  const clear = _internal.deviceAlarms({ ...device, alarmActive: first.next }, normal)
  assert.equal(clear.cleared.length, 1)
  assert.deepEqual(clear.next, {})
  const label = _internal.alarmLabel(first.fired[0], 'max')
  assert.match(label, /压力=120>100/)
})

test('compactValues decodes with segment metadata for the agent', () => {
  const segments = [{ id: 's1', name: '温度', function: 3, address: 0, count: 1, scale: 0.1, offset: 0, unit: '°C' }]
  const values = [{ key: 's1:3@0', segmentId: 's1', function: 3, address: 0, name: '温度', value: 255, ok: true }]
  const out = compactValues(values, segments)
  assert.equal(out[0].value, 25.5)
  assert.equal(out[0].raw, 255)
  assert.equal(out[0].unit, '°C')
})
