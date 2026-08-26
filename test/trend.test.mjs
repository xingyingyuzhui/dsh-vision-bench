import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  getTrendState,
  clearTrendState,
  TREND_CAP,
  TREND_WINDOW_MS,
  trendKey,
  sampleTrend,
  computeStats,
  exportRangeCsv,
  toUplotData,
  trendDataForComponents,
  UPLOT_PROTO,
} from '../bench-trend.mjs'

function makePoint(connectionId, deviceId, pointId, name, unit) {
  return { id: pointId, connectionId, deviceId, name, unit, scale: 1, offset: 0 }
}

function clean(cwd) {
  clearTrendState(cwd)
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
  let l1 = getTrendState(cwd).series.get(k1)
  assert.ok(l1 && l1.length === 1 && l1[0].v === 10)

  // second tick: p1 bad quality, p2 good
  t0 += 1000
  Date.now = () => t0
  const packBad = { points: [p1, p2], values: [{ pointId: 'p1', ok: false, error: 'timeout' }, { pointId: 'p2', raw: 21, ok: true }] }
  sampleTrend(cwd, packBad)
  l1 = getTrendState(cwd).series.get(k1)
  const l2 = getTrendState(cwd).series.get(k2)
  assert.equal(l1.length, 2)
  assert.equal(l1[1].v, null, 'bad quality should be explicit null gap, not skipped')
  assert.equal(l2.length, 2)
  assert.equal(l2[1].v, 21)

  // recovery: good again should not span gap
  t0 += 1000
  Date.now = () => t0
  const packRecover = { points: [p1, p2], values: [{ pointId: 'p1', raw: 12, ok: true }, { pointId: 'p2', raw: 22, ok: true }] }
  sampleTrend(cwd, packRecover)
  l1 = getTrendState(cwd).series.get(k1)
  assert.equal(l1.length, 3)
  assert.equal(l1[2].v, 12)
  // computeStats should ignore null
  const stats = computeStats(cwd, l1)
  assert.equal(stats.valid, 2)
  assert.equal(stats.min, 10)
  assert.equal(stats.max, 12)
  assert.ok(stats.avg > 10 && stats.avg < 12)
  assert.equal(stats.last, 12)

  // toUplotData should preserve null for断线
  const u = toUplotData(cwd)
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
  const csv = exportRangeCsv(cwd)
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
  assert.equal(getTrendState(cwd).series.size, 8)
  for (const p of points) {
    const k = trendKey(p.connectionId, p.deviceId, p.id)
    const lst = getTrendState(cwd).series.get(k)
    assert.ok(lst)
    assert.equal(lst.length, 10)
    assert.equal(lst[0].v, 0 + points.indexOf(p))
    assert.equal(lst[9].v, 90 + points.indexOf(p))
  }
  const u = toUplotData(cwd)
  assert.equal(u.keys.length, 8)
  assert.equal(u.data.length, 9) // x + 8 y
  assert.equal(u.data[0].length, 10) // 10 timestamps
  for (let i = 1; i < u.data.length; i++) assert.equal(u.data[i].length, 10)
  assert.ok(UPLOT_PROTO.scales.x.time === true)
  clean(cwd)
})

test('Task3: trend buffers are isolated per cwd (same pointId, different values)', () => {
  const cwdA = '/tmp/trend-a-' + Date.now() + Math.random()
  const cwdB = '/tmp/trend-b-' + Date.now() + Math.random()
  clean(cwdA)
  clean(cwdB)
  const pA = makePoint('c1', 'd1', 'p1', 'TempA', 'C')
  const pB = makePoint('c1', 'd1', 'p1', 'TempB', 'C')
  const origNow = Date.now
  const base = origNow()
  Date.now = () => base
  sampleTrend(cwdA, { points: [pA], values: [{ pointId: 'p1', raw: 100, ok: true }] })
  Date.now = () => base + 1000
  sampleTrend(cwdB, { points: [pB], values: [{ pointId: 'p1', raw: 200, ok: true }] })
  Date.now = origNow
  const k = trendKey('c1', 'd1', 'p1')
  // A value only 100; B value only 200 — same key, different cwd
  const aList = getTrendState(cwdA).series.get(k)
  const bList = getTrendState(cwdB).series.get(k)
  assert.ok(aList && aList.length === 1 && aList[0].v === 100, 'A sees only its own value')
  assert.ok(bList && bList.length === 1 && bList[0].v === 200, 'B sees only its own value')
  // sampling B must not clear A
  Date.now = () => base + 2000
  sampleTrend(cwdB, { points: [pB], values: [{ pointId: 'p1', raw: 300, ok: true }] })
  Date.now = origNow
  assert.equal(getTrendState(cwdA).series.get(k).length, 1, 'A not cleared by B sampling')
  // A CSV must not contain B values
  const csvA = exportRangeCsv(cwdA)
  assert.ok(!csvA.includes(',300'), 'A CSV must not contain B values')
  assert.ok(csvA.includes(',100'), 'A CSV contains its own value')
  const uA = toUplotData(cwdA)
  assert.equal(uA.data.length, 2) // x + 1 series
  assert.equal(uA.data[1][0], 100)
  clean(cwdA)
  clean(cwdB)
})

test('Task5/6 guards: no hard-coded configVersion collapse and no window.uPlot reliance', () => {
  // TaskP2/0.20.0: 曲线已迁移为「可视化」组件页（bench-visualization-view.mjs）
  const live = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'bench-visualization-view.mjs'), 'utf8')
  assert.doesNotMatch(live, /window\.uPlot|globalThis\.uPlot/, 'must not rely on host uPlot globals')
  assert.match(live, /vendorUPlot\(\)/, 'should consume bundled uPlot constructor lazily')
  assert.match(live, /destroy/, 'should destroy uPlot on teardown')
  assert.match(live, /\.setData\(/, 'should update via setData, not re-create chart')
  assert.match(live, /setSize/, 'should resize via setSize')
  assert.match(live, /spanGaps: false/, 'curve does not connect error gaps')
})
test('Task2/0.20.1: trendDataForComponents aligned uPlot data (multi-series, seconds, null gaps)', () => {
  const base = Date.now() - 60000
  const store = {
    p1: [[base, 1], [base + 1000, 2], [base + 2000, null]],
    p2: [[base + 1000, 20], [base + 2000, 30], [base + 3000, 40]],
  }
  const points = [{ id: 'p1', name: 'A', unit: '°C' }, { id: 'p2', name: 'B' }]
  const r = trendDataForComponents(store, points, ['p1', 'p2'], 300000)
  assert.equal(r.data.length, r.keys.length + 1, 'data.length === keys.length + 1')
  assert.deepEqual(r.keys, ['p1', 'p2'], '点位顺序稳定')
  for (const row of r.data) assert.equal(row.length, r.data[0].length, '所有数组等长')
  assert.deepEqual(r.data[0].map((v) => typeof v), ['number', 'number', 'number', 'number'], '时间轴为秒数值')
  assert.ok(Math.abs(r.data[0][0] - base / 1000) < 0.001, '毫秒→秒')
  assert.deepEqual(r.data[1], [1, 2, null, null], 'p1 对齐 + 通信失败 null 断点')
  assert.deepEqual(r.data[2], [null, 20, 30, 40], 'p2 对齐')
})

test('Task2/0.20.1: 同时间戳合并去重；窗口过滤；零样本点保留 key 顺序', () => {
  const base = Date.now() - 60000
  const store = {
    p1: [[base, 1], [base, 2], [base + 500, 3]],
    p2: [[base + 500, 30]],
  }
  const points = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]
  const r = trendDataForComponents(store, points, ['p1', 'p2', 'p3'], 300000)
  assert.deepEqual(r.keys, ['p1', 'p2', 'p3'], '零样本点保留位置（p3 keys 存在）')
  assert.deepEqual(r.data[1], [2, 3], '同时间戳去重(1,2 取后者)')
  assert.deepEqual(r.data[3], [null, null], 'p3 全 null')
  // 窗口过滤（now≈测试时间；2000ms 前样本应被 1500ms 窗口滤掉）
  const nowRef = Date.now()
  const narrow = trendDataForComponents({ p1: [[nowRef - 2000, 1], [nowRef - 1000, 2]] }, points, ['p1'], 1500)
  assert.equal(narrow.data[0].length, 1, '窗口外样本被过滤')
  assert.equal(narrow.data[1][0], 2)
})
