import assert from 'node:assert/strict'
import test from 'node:test'
import { buildLineOption, padLineYMax, resolveLineTimeRange } from '../../src/ui/monitor/visualization/hooks/viz-chart-options.mjs'
import {
  chartState,
  dataFingerprint,
  latestFingerprint,
  seriesIdentityFingerprint,
} from '../../src/ui/monitor/visualization/viz-helpers.mjs'
import { sampleTrendValues } from '../../src/application/modbus/trend-store.mjs'

test('buildLineOption keeps the newest sample inside the axis (not interval-floored)', () => {
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
  assert.ok(opt.xAxis.min <= (lastSec - 60) * 1000)
  assert.ok(opt.xAxis.max >= lastSec * 1000)
  assert.ok(opt.xAxis.min < opt.xAxis.max)
})

test('resolveLineTimeRange starts at the first sample while the window is still filling', () => {
  const firstSec = 1_700_000_000
  const lastSec = firstSec + 15
  const payload = { data: [[firstSec, lastSec], [1, 2]] }
  const range = resolveLineTimeRange({ windowMs: 60000 }, payload)
  assert.equal(range.min, firstSec * 1000)
  assert.equal(range.max, firstSec * 1000 + 60000)
  assert.ok(range.max > lastSec * 1000, 'latest point is inside the window, not on the right edge')
  const opt = buildLineOption({ windowMs: 60000 }, payload, false)
  assert.equal(opt.xAxis.min, range.min)
  assert.equal(opt.xAxis.max, range.max)
})

test('resolveLineTimeRange with xAutoScroll false stays pinned to the first sample', () => {
  const firstSec = 1_700_000_000
  const lastSec = firstSec + 180
  const range = resolveLineTimeRange({ windowMs: 60000, xAutoScroll: false }, { data: [[firstSec, lastSec], [1, 2]] })
  assert.equal(range.min, firstSec * 1000)
  assert.equal(range.max, firstSec * 1000 + 60000)
})

test('resolveLineTimeRange slides after the window is full', () => {
  const firstSec = 1_700_000_000
  const lastSec = firstSec + 180
  const range = resolveLineTimeRange({ windowMs: 60000 }, { data: [[firstSec, lastSec], [1, 2]] })
  assert.equal(range.min, lastSec * 1000 - 60000)
  assert.ok(range.max > lastSec * 1000, 'right pad so the last symbol is not clipped')
})

test('padLineYMax leaves headroom above the latest peak', () => {
  assert.ok(padLineYMax(0, 80) > 80)
})

test('padLineYMax snaps to a nice tick instead of a raw 8% float', () => {
  assert.equal(padLineYMax(0, 6.154), 8)
  assert.equal(padLineYMax(0, 52), 60)
  assert.equal(padLineYMax(0, 80), 100)
  assert.equal(String(padLineYMax(0, 61.54)).includes('.'), false)
})

test('buildLineOption falls back to wall clock when there are no samples', () => {
  const before = Date.now()
  const opt = buildLineOption({ windowMs: 300000 }, { data: [] }, false)
  const after = Date.now()
  assert.ok(opt.xAxis.min <= after)
  assert.ok(opt.xAxis.max >= before)
  assert.ok(opt.xAxis.max - opt.xAxis.min === 300000 + Math.max(250, Math.round(300000 * 0.02)))
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
