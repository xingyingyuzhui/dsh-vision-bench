import assert from 'node:assert/strict'
import test from 'node:test'
import {
  csvToPoints,
  decodeValue,
  evaluateAlarm,
  evaluatePointAlarms,
  fillSimValues,
  normalizePoint,
  normalizePoints,
  pointIdOf,
  pointsToCsv,
  scatterBatch,
  setPointValue,
} from '../bench-points.mjs'
import { planReadBatches, MAX_READ_REGS } from '../bench-pollplan.mjs'

test('normalizePoint derives deterministic ids and clamps fields', () => {
  const p = normalizePoint({ name: '温度', function: 3, address: 100, scale: 0.1, offset: -40, unit: '℃', alarmMin: -10, alarmMax: 85 })
  assert.equal(p.id, 'p3_100')
  assert.equal(p.scale, 0.1)
  assert.equal(p.offset, -40)
  assert.equal(p.alarmMin, -10)
  const bare = normalizePoint({ function: 9, address: -5 })
  assert.equal(bare.function, 3)
  assert.equal(bare.address, 0)
  assert.equal(normalizePoints([{ function: 3, address: 1 }, { function: 3, address: 1 }]).length, 1)
})

test('planReadBatches merges contiguous runs and splits per fc', () => {
  const batches = planReadBatches([
    { function: 3, address: 8 },
    { function: 3, address: 6 },
    { function: 3, address: 7 },
    { function: 3, address: 200 },
    { function: 1, address: 3 },
    { function: 1, address: 4 },
  ])
  assert.deepEqual(batches, [
    { fc: 1, address: 3, count: 2 },
    { fc: 3, address: 6, count: 3 },
    { fc: 3, address: 200, count: 1 },
  ])
})

test('planReadBatches respects the register span limit', () => {
  const pts = []
  for (let i = 0; i < MAX_READ_REGS + 1; i++) pts.push({ function: 3, address: i })
  const batches = planReadBatches(pts)
  assert.equal(batches.length, 2)
  assert.equal(batches[0].count, MAX_READ_REGS)
  assert.equal(batches[1].count, 1)
})

test('scatterBatch distributes raw values to covered points only', () => {
  const points = [
    { id: 'a', function: 3, address: 10 },
    { id: 'b', function: 3, address: 11 },
    { id: 'c', function: 3, address: 12 },
    { id: 'far', function: 3, address: 50 },
    { id: 'coil', function: 1, address: 10 },
  ]
  const values = scatterBatch([], points, { fc: 3, address: 10, count: 3 }, [7, 8, 9], true, '')
  const get = (id) => values.find((v) => v.key === id)
  assert.equal(get('a').raw, 7)
  assert.equal(get('c').raw, 9)
  assert.ok(!get('far'))
  assert.ok(!get('coil'))
  const failed = scatterBatch(values, points, { fc: 3, address: 10, count: 3 }, [], false, 'timeout')
  assert.equal(failed.find((v) => v.key === 'a').ok, false)
  assert.match(failed.find((v) => v.key === 'a').error, /timeout/)
})

test('setPointValue decodes with the point config', () => {
  const p = { id: 'x', function: 3, address: 1, scale: 0.1, offset: 2 }
  const values = setPointValue([], p, 255, { ok: true })
  assert.equal(values[0].value, 27.5)
  assert.equal(values[0].raw, 255)
})

test('fillSimValues produces plausible raw values for every point', () => {
  const points = [
    { id: 'c', function: 1, address: 0 },
    { id: 'r', function: 3, address: 4 },
  ]
  const values = fillSimValues([], points, 1000)
  assert.equal(values.length, 2)
  assert.ok([0, 1].includes(values.find((v) => v.key === 'c').raw))
  assert.ok(Number.isFinite(values.find((v) => v.key === 'r').raw))
})

test('evaluateAlarm and evaluatePointAlarms detect breaches with hysteresis', () => {
  const p = { id: 's1', name: '压力', function: 3, address: 0, alarmMax: 100 }
  assert.equal(evaluateAlarm(p, 120), 'max')
  assert.equal(evaluateAlarm(p, 50), '')
  const first = evaluatePointAlarms([p], [{ key: 's1', raw: 120, ok: true }], {})
  assert.equal(first.fired.length, 1)
  const again = evaluatePointAlarms([p], [{ key: 's1', raw: 130, ok: true }], first.next)
  assert.equal(again.fired.length, 0)
  const clear = evaluatePointAlarms([p], [{ key: 's1', raw: 20, ok: true }], first.next)
  assert.equal(clear.cleared.length, 1)
  assert.deepEqual(clear.next, {})
})

test('CSV round-trip preserves per-point metadata', () => {
  const points = [
    { name: '温度', function: 3, address: 0, scale: 0.1, offset: -40, unit: '℃', alarmMin: -10, alarmMax: 85 },
    { name: '开关', function: 1, address: 9 },
  ]
  const back = csvToPoints(pointsToCsv(points))
  assert.equal(back.ok, true)
  assert.equal(back.points.length, 2)
  assert.equal(back.points[0].scale, 0.1)
  assert.equal(back.points[0].unit, '℃')
  assert.equal(back.points[0].alarmMax, 85)
  assert.equal(back.points[1].alarmMax, null)
  assert.equal(csvToPoints('a,b\n1,2').ok, false)
})

test('pointIdOf is stable for write lookups', () => {
  assert.equal(pointIdOf(3, 42), normalizePoint({ function: 3, address: 42 }).id)
})
