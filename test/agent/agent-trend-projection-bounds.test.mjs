import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AGENT_TEXT_CAPS,
  projectAgentResult,
  utf8ByteLength,
} from '../../src/application/commands/agent-result-projection.mjs'
import { runVisionBench } from '../../bench-tool.mjs'
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { createBench } from '../helpers/workspace-factory.mjs'

/**
 * @param {number} nSeries
 * @param {number} nSamples
 * @param {number} [startAt]
 */
function synthSeries(nSeries, nSamples, startAt = 1_000) {
  return Array.from({ length: nSeries }, (_, si) => {
    const pointId = `p${si + 1}`
    const samples = Array.from({ length: nSamples }, (_, i) => [startAt + i, si * 1000 + i])
    return {
      pointId,
      name: `P${si + 1}`,
      connectionId: 'c1',
      deviceId: 'd1',
      unit: 'C',
      count: nSamples,
      returned: nSamples,
      samples,
    }
  })
}

/**
 * @param {any} series
 */
function project(series, args = { action: 'trend' }) {
  return projectAgentResult(args, { ok: true, action: 'trend', trend: { series } })
}

function assertReturnedMatchesSamples(projected) {
  const series = projected.trend.series
  const sum = series.reduce((n, s) => n + s.samples.length, 0)
  assert.equal(projected.trend.returned, sum, 'trend.returned === sum(samples.length)')
  assert.equal(projected.trend.returned, series.reduce((n, s) => n + s.returned, 0))
  for (const s of series) {
    assert.equal(s.returned, s.samples.length)
    if (s.samples.length) {
      assert.equal(s.oldestReturnedAt, s.samples[0][0], 'oldestReturnedAt is first returned sample')
      assert.equal(s.hasMore, s.count > s.samples.length)
    }
  }
}

test('projectTrend 8×600 over budget keeps newest continuous suffix; metadata recomputed last', () => {
  const series = synthSeries(8, 600)
  const projected = project(series, { action: 'trend', limit: 600 })
  assertReturnedMatchesSamples(projected)
  assert.ok(projected.trend.returned < 4800, 'must shrink below full 8×600')
  assert.ok(projected.trend.total >= 4800, 'total keeps window sample count')
  assert.ok(utf8ByteLength(projected) <= AGENT_TEXT_CAPS.trendBytes)
  for (const s of projected.trend.series) {
    // Newest suffix: last returned sample is the original window's newest.
    assert.equal(s.samples[s.samples.length - 1][0], 1_000 + 599)
    // Continuous: adjacent timestamps step by 1.
    for (let i = 1; i < s.samples.length; i++) {
      assert.equal(s.samples[i][0], s.samples[i - 1][0] + 1)
    }
    assert.ok(s.hasMore)
  }
})

test('projectTrend second page from oldestReturnedAt-1 joins without gap/dup', () => {
  // Force budget shrink so page1 is a proper suffix of the window.
  const series = synthSeries(8, 600, 10_000)
  const page1 = project(series, { action: 'trend', limit: 80 })
  assertReturnedMatchesSamples(page1)
  const s1 = page1.trend.series[0]
  assert.ok(s1.hasMore, 'page1 must leave older samples')
  const end = s1.oldestReturnedAt - 1
  const olderAll = series[0].samples.filter((sm) => sm[0] <= end)
  const page2 = project(
    series.map((s, i) => (i === 0 ? { ...s, samples: olderAll } : s)),
    { action: 'trend', limit: 80 },
  )
  assertReturnedMatchesSamples(page2)
  const s2 = page2.trend.series[0]
  assert.ok(s2.samples.length >= 1)
  const merged = [...s2.samples, ...s1.samples]
  const times = merged.map((sm) => sm[0])
  assert.equal(new Set(times).size, times.length, 'no duplicates')
  for (let i = 1; i < times.length; i++) {
    assert.equal(times[i], times[i - 1] + 1, 'no gaps')
  }
  assert.equal(s2.samples[s2.samples.length - 1][0], s1.samples[0][0] - 1)
})

test('projectTrend single point / empty series / unequal lengths / under budget', () => {
  const single = project(synthSeries(1, 3))
  assertReturnedMatchesSamples(single)
  assert.equal(single.trend.returned, 3)
  assert.equal(single.trend.series[0].hasMore, false)

  const empty = project([
    { pointId: 'pX', name: 'X', connectionId: 'c1', deviceId: 'd1', unit: '', count: 0, samples: [] },
  ])
  assertReturnedMatchesSamples(empty)
  assert.equal(empty.trend.returned, 0)
  assert.equal(empty.trend.series[0].oldestReturnedAt, null)
  assert.equal(empty.trend.series[0].hasMore, false)

  const unequal = project([
    { pointId: 'a', name: 'A', count: 10, samples: synthSeries(1, 10)[0].samples.slice(0, 2) },
    { pointId: 'b', name: 'B', count: 2, samples: synthSeries(1, 2, 5_000)[0].samples },
    { pointId: 'c', name: 'C', count: 0, samples: [] },
  ])
  assertReturnedMatchesSamples(unequal)
  assert.equal(unequal.trend.series[0].returned, 2)
  assert.equal(unequal.trend.series[0].hasMore, true)
  assert.equal(unequal.trend.series[1].hasMore, false)

  const under = project(synthSeries(2, 5))
  assertReturnedMatchesSamples(under)
  assert.equal(under.trend.returned, 10)
  assert.equal(under.truncated, undefined)
})

test('projectTrend metadata-only overrun returns explicit overrun, not empty ok page', () => {
  const hugeNames = Array.from({ length: 8 }, (_, i) => ({
    pointId: `p${i}`,
    name: 'N'.repeat(2000),
    connectionId: 'c1',
    deviceId: 'd1',
    unit: 'x'.repeat(500),
    count: 600,
    samples: [[1, 1]],
  }))
  const projected = project(hugeNames)
  assert.equal(projected.overrun, true)
  assert.match(String(projected.hint || ''), /pointIds|limit/)
  assert.ok(projected.trend.returned === projected.trend.series.reduce((n, s) => n + s.samples.length, 0))
  // Never a silent empty complete page without overrun marker.
  if (projected.trend.returned === 0) {
    assert.equal(projected.overrun, true)
  }
})

test('real handler + projection: trendKey path keeps newest samples and consistent counters', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-trend-real-' })
  const { home, cwd } = bench
  const samples1 = Array.from({ length: 30 }, (_, i) => [2_000 + i, i])
  const samples2 = Array.from({ length: 30 }, (_, i) => [2_000 + i, 100 + i])
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [
        { id: 'c1', name: 'C1', conn: { mode: 'sim', sim: true, port: 'COM3' } },
        { id: 'c2', name: 'C2', conn: { mode: 'sim', sim: true, port: 'COM4' } },
      ],
      devices: [
        { id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 },
        { id: 'd2', connectionId: 'c2', name: 'D2', unitId: 2 },
      ],
      points: [
        {
          id: 'p1',
          name: 'T1',
          function: 3,
          address: 0,
          connectionId: 'c1',
          deviceId: 'd1',
          monitorEnabled: true,
          unit: 'C',
        },
        {
          id: 'p2',
          name: 'T2',
          function: 3,
          address: 1,
          connectionId: 'c2',
          deviceId: 'd2',
          monitorEnabled: true,
          unit: 'F',
        },
      ],
      trend: { p1: samples1, p2: samples2 },
    },
  })
  const origin = { source: 'agent', sessionId: 's1' }
  const raw = await runVisionBench(home, { action: 'trend', trendKey: 'c1:d1:p1', start: 0 }, cwd, origin)
  assert.equal(raw.ok, true, raw.error)
  const projected = projectAgentResult(
    { action: 'trend', trendKey: 'c1:d1:p1', start: 0 },
    { ...raw, action: 'trend' },
  )
  assertReturnedMatchesSamples(projected)
  assert.deepEqual(projected.trend.pointIds, ['p1'])
  assert.equal(projected.trend.series.length, 1)
  const s = projected.trend.series[0]
  assert.equal(s.pointId, 'p1')
  assert.equal(s.connectionId, 'c1')
  assert.equal(s.unit, 'C')
  // Newest sample of the window is the last one returned.
  assert.equal(s.samples[s.samples.length - 1][0], samples1[samples1.length - 1][0])
  // Second page via end=oldestReturnedAt-1 continues older samples.
  const olderRaw = await runVisionBench(
    home,
    {
      action: 'trend',
      trendKey: 'c1:d1:p1',
      start: 0,
      end: s.oldestReturnedAt - 1,
    },
    cwd,
    origin,
  )
  const older = projectAgentResult(
    { action: 'trend', trendKey: 'c1:d1:p1', start: 0, end: s.oldestReturnedAt - 1 },
    { ...olderRaw, action: 'trend' },
  )
  assertReturnedMatchesSamples(older)
  const os = older.trend.series[0]
  if (os.samples.length) {
    assert.equal(os.samples[os.samples.length - 1][0], s.samples[0][0] - 1)
    const times = [...os.samples, ...s.samples].map((sm) => sm[0])
    assert.equal(new Set(times).size, times.length)
    for (let i = 1; i < times.length; i++) assert.equal(times[i], times[i - 1] + 1)
  }
  void loadWorkspace
})
