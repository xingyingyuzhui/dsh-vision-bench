import assert from 'node:assert/strict'
import test from 'node:test'
import { buildLineOption } from '../../src/ui/monitor/visualization/hooks/viz-chart-options.mjs'
import {
  chartState,
  dataFingerprint,
  latestFingerprint,
  seriesIdentityFingerprint,
} from '../../src/ui/monitor/visualization/viz-helpers.mjs'
import { sampleTrendValues } from '../../src/application/modbus/trend-store.mjs'

test('buildLineOption max uses real lastSampleMs (not interval-floored)', () => {
  // 90s past a minute boundary → floor would clip the newest sample out of range
  const lastSec = Math.floor(Date.UTC(2026, 0, 1, 12, 0, 90) / 1000)
  const payload = {
    data: [
      [lastSec - 60, lastSec],
      [1, 2],
    ],
    keys: ['p1'],
    meta: [{ label: 'A', unit: '℃' }],
  }
  const opt = buildLineOption({ windowMs: 300000 }, payload, false)
  assert.equal(opt.xAxis.max, lastSec * 1000)
  assert.ok(opt.xAxis.min < opt.xAxis.max)
})

test('buildLineOption falls back to wall clock when there are no samples', () => {
  const before = Date.now()
  const opt = buildLineOption({ windowMs: 300000 }, { data: [] }, false)
  const after = Date.now()
  assert.ok(opt.xAxis.max >= before && opt.xAxis.max <= after)
})

test('chartState splits series / data / option fingerprints', () => {
  const payload = {
    data: [
      [100, 101],
      [1, 2],
    ],
    keys: ['p1'],
    meta: [{ label: 'Temp', unit: '℃' }],
  }
  const a = chartState({ settings: { windowMs: 300000 } }, payload, false, { __rev: 3 })
  const b = chartState({ settings: { windowMs: 300000 } }, payload, false, { __rev: 3 })
  assert.deepEqual(a, b)
  assert.equal(a.data, 'r:3')
  assert.match(a.series, /p1:Temp:℃/)

  const renamed = {
    ...payload,
    meta: [{ label: 'Renamed', unit: '℃' }],
  }
  const c = chartState({ settings: { windowMs: 300000 } }, renamed, false, { __rev: 3 })
  assert.notEqual(a.series, c.series)
  assert.equal(a.data, c.data)

  const theme = chartState({ settings: { windowMs: 300000 } }, payload, true, { __rev: 3 })
  assert.notEqual(a.option, theme.option)
})

test('dataFingerprint falls back to window hash without revision', () => {
  const payload = {
    data: [
      [10, 20, 30],
      [1, 2, 3],
    ],
  }
  const fp = dataFingerprint(payload, {})
  assert.ok(fp.includes('10') && fp.includes('30'))
  const midChanged = {
    data: [
      [10, 20, 30],
      [1, 9, 3],
    ],
  }
  assert.notEqual(dataFingerprint(midChanged, {}), fp)
})

test('latestFingerprint includes name unit and point identity', () => {
  const a = latestFingerprint([{ pointId: 'p1', name: 'A', unit: 'V', ok: true, value: 1, at: 1 }])
  const b = latestFingerprint([{ pointId: 'p1', name: 'B', unit: 'V', ok: true, value: 1, at: 1 }])
  assert.notEqual(a, b)
})

test('sampleTrendValues bumps __rev when monitored points are sampled', () => {
  const pointsById = { p1: { id: 'p1', monitorEnabled: true } }
  const t1 = sampleTrendValues({}, [{ pointId: 'p1', value: 1, ok: true, at: 1000 }], pointsById)
  assert.equal(t1.__rev, 1)
  const t2 = sampleTrendValues(t1, [{ pointId: 'p1', value: 2, ok: true, at: 2000 }], pointsById)
  assert.equal(t2.__rev, 2)
  const t3 = sampleTrendValues(t2, [], pointsById)
  assert.equal(t3.__rev, 2)
})

test('seriesIdentityFingerprint ignores sample values', () => {
  const base = {
    keys: ['p1', 'p2'],
    meta: [
      { label: 'A', unit: '' },
      { label: 'B', unit: 'A' },
    ],
    data: [
      [1, 2],
      [3, 4],
      [5, 6],
    ],
  }
  const changedData = {
    ...base,
    data: [
      [1, 2],
      [9, 9],
      [8, 8],
    ],
  }
  assert.equal(seriesIdentityFingerprint(base), seriesIdentityFingerprint(changedData))
})
