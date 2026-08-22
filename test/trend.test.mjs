import assert from 'node:assert/strict'
import test from 'node:test'
import { TREND, TREND_CAP, TREND_WINDOW_MS, trendKey, sampleTrend, computeStats, exportRangeCsv, toUplotData, UPLOT_PROTO } from '../bench-trend.mjs'

function makePoint(connectionId, deviceId, pointId, name, unit) {
  return { id: pointId, connectionId, deviceId, name, unit, scale: 1, offset: 0 }
}

function clean(cwd) {
  // force cwd switch to clear
  sampleTrend(cwd + '-clear-' + Date.now() + Math.random(), { points: [], values: [] })
  // also explicitly clear in case cwd mismatch not triggered
  TREND.series.clear()
  TREND.meta.clear()
  TREND.cwd = ''
}

test('trend quality breakpoint: ok!==true writes null gap for uPlot and key is connectionId:deviceId:pointId', () => {
  const cwd = '/tmp/trend-q-' + Date.now() + Math.random()
  clean(cwd)
  const p1 = makePoint('c1', 'd1', 'p1', 'Temp', 'C')
  const p2 = makePoint('c1', 'd1', 'p2', 'Press', 'kPa')
  const origNow = Date.now
  let t0 = origNow()
  Date.now = () => t0
  const packGood = { points: [p1, p2], values: [{ pointId: 'p1', raw: 10, ok: true }, { pointId: 'p2', raw: 20, ok: true }] }
  sampleTrend(cwd, packGood)
  const k1 = trendKey('c1', 'd1', 'p1')
  const k2 = trendKey('c1', 'd1', 'p2')
  assert.equal(k1, 'c1:d1:p1')
  assert.equal(k2, 'c1:d1:p2')
  let l1 = TREND.series.get(k1)
  assert.ok(l1 && l1.length === 1 && l1[0].v === 10)

  // second tick: p1 bad quality, p2 good
  t0 += 1000
  Date.now = () => t0
  const packBad = { points: [p1, p2], values: [{ pointId: 'p1', ok: false, error: 'timeout' }, { pointId: 'p2', raw: 21, ok: true }] }
  sampleTrend(cwd, packBad)
  l1 = TREND.series.get(k1)
  const l2 = TREND.series.get(k2)
  assert.equal(l1.length, 2)
  assert.equal(l1[1].v, null, 'bad quality should be explicit null gap, not skipped')
  assert.equal(l2.length, 2)
  assert.equal(l2[1].v, 21)

  // recovery: good again should not span gap
  t0 += 1000
  Date.now = () => t0
  const packRecover = { points: [p1, p2], values: [{ pointId: 'p1', raw: 12, ok: true }, { pointId: 'p2', raw: 22, ok: true }] }
  sampleTrend(cwd, packRecover)
  l1 = TREND.series.get(k1)
  assert.equal(l1.length, 3)
  assert.equal(l1[2].v, 12)
  // computeStats should ignore null
  const stats = computeStats(l1)
  assert.equal(stats.valid, 2)
  assert.equal(stats.min, 10)
  assert.equal(stats.max, 12)
  assert.ok(stats.avg > 10 && stats.avg < 12)
  assert.equal(stats.last, 12)

  // toUplotData should preserve null for断线
  const u = toUplotData()
  // data[0] is xs (seconds), data[1] should correspond to k1, contain null at index 1
  assert.ok(Array.isArray(u.data) && u.data.length >= 3)
  // find indices of keys
  const idx1 = u.keys.indexOf(k1)
  assert.ok(idx1 >= 0)
  const ys = u.data[idx1 + 1]
  assert.equal(ys.length, 3)
  assert.equal(ys[0], 10)
  assert.equal(ys[1], null)
  assert.equal(ys[2], 12)
  // csv should export rows including empty value for null gap
  const csv = exportRangeCsv()
  assert.match(csv, /^time,connectionId/)
  assert.match(csv, /Temp/)
  // header + 6 rows (3 per series)
  const lines = csv.split('\n')
  assert.ok(lines.length >= 7)
  // at least one line ends with , (empty value for null)
  assert.ok(lines.some((line) => line.endsWith(',')), 'null gap should produce empty value column in CSV')
  Date.now = origNow
  clean(cwd)
})

test('trend supports 8 sequences sustained updates and uPlot proto preset', () => {
  const cwd = '/tmp/trend-8-' + Date.now() + Math.random()
  clean(cwd)
  assert.equal(TREND_CAP, 600)
  assert.equal(TREND_WINDOW_MS, 5 * 60 * 1000)
  assert.equal(UPLOT_PROTO.spanGaps, false)
  assert.equal(UPLOT_PROTO.width, 560)
  const points = Array.from({ length: 8 }, (_, i) => makePoint('c' + (i % 2 + 1), 'd' + (Math.floor(i / 2) + 1), 'p' + i, 'P' + i, 'U'))
  const origNow = Date.now
  let base = origNow()
  // 10 ticks sustained — ensure distinct timestamps
  for (let t = 0; t < 10; t++) {
    Date.now = () => base + t * 1000
    const values = points.map((p, idx) => ({ pointId: p.id, raw: t * 10 + idx, ok: true }))
    sampleTrend(cwd, { points, values })
  }
  Date.now = origNow
  assert.equal(TREND.series.size, 8)
  for (const p of points) {
    const k = trendKey(p.connectionId, p.deviceId, p.id)
    const lst = TREND.series.get(k)
    assert.ok(lst)
    assert.equal(lst.length, 10)
    assert.equal(lst[0].v, 0 + points.indexOf(p))
    assert.equal(lst[9].v, 90 + points.indexOf(p))
  }
  const u = toUplotData()
  assert.equal(u.keys.length, 8)
  assert.equal(u.data.length, 9) // x + 8 y
  assert.equal(u.data[0].length, 10) // 10 timestamps
  for (let i = 1; i < u.data.length; i++) assert.equal(u.data[i].length, 10)
  // ensure canvas colors still available via UPLOT_PROTO (no uPlot import)
  assert.ok(UPLOT_PROTO.scales.x.time === true)
  clean(cwd)
})
