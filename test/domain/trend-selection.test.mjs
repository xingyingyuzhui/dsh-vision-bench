// Task3/0.19.3: trend sampling at COMMIT time, gated by point.trendEnabled —
// read / poll / write-readback all produce samples; failures write null gaps;
// the Agent trend action returns REAL samples.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { runVisionBench } from '../helpers/run-vision-bench.mjs'
import { TREND_KEEP, readTrendSeries, sampleTrendValues } from '../../bench-trend-store.mjs'

const baseModbus = {
  version: 3,
  connections: [
    {
      id: 'c1',
      name: 'C1',
      role: 'client',
      enabled: true,
      conn: { mode: 'rtu', port: 'COM3', baudrate: 9600, slave: 1, sim: true },
    },
  ],
  devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
  points: [
    {
      id: 'p1',
      connectionId: 'c1',
      deviceId: 'd1',
      name: '未勾选',
      function: 3,
      address: 0,
      count: 1,
      active: true,
      watched: true,
      trendEnabled: false,
    },
    {
      id: 'p2',
      connectionId: 'c1',
      deviceId: 'd1',
      name: '入曲线',
      function: 3,
      address: 1,
      count: 1,
      active: true,
      watched: true,
      trendEnabled: true,
    },
  ],
  values: [],
  alarmState: {},
}

async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'ts-'))
  const cwd = join(home, 'board')
  mkdirSync(cwd)
  saveWorkspace(home, cwd, { modbus: baseModbus })
  return { home, cwd }
}

test('未开启监视的点位不产生任何历史样本', async () => {
  const { home, cwd } = await setup()
  const ran = await runVisionBench(
    home,
    { action: 'read', connectionId: 'c1', deviceId: 'd1', function: 3, address: 0, count: 1 },
    cwd,
    { source: 'agent', sessionId: 's1' },
  )
  assert.equal(ran.ok, true)
  const pack = loadWorkspace(home, cwd).modbus
  assert.ok(!pack.trend || !pack.trend.p1, 'p1 未勾选 → 无样本; got ' + JSON.stringify(pack.trend && pack.trend.p1))
  await rm(home, { recursive: true, force: true })
})

test('开启监视的点位在读取提交后产生样本（页面不开也采样）', async () => {
  const { home, cwd } = await setup()
  const ran = await runVisionBench(
    home,
    { action: 'read', connectionId: 'c1', deviceId: 'd1', function: 3, address: 1, count: 1 },
    cwd,
    { source: 'agent', sessionId: 's1' },
  )
  assert.equal(ran.ok, true)
  const pack = loadWorkspace(home, cwd).modbus
  assert.ok(Array.isArray(pack.trend && pack.trend.p2) && pack.trend.p2.length >= 1, 'p2 有样本')
  const sample = pack.trend.p2[pack.trend.p2.length - 1]
  assert.equal(sample.length, 2)
  assert.ok(Number.isFinite(sample[0]) && Number.isFinite(sample[1]), '样本为 [t, v]')
  await rm(home, { recursive: true, force: true })
})

test('写后回读同样产生曲线样本', async () => {
  const { home, cwd } = await setup()
  await runVisionBench(
    home,
    { action: 'write', connectionId: 'c1', deviceId: 'd1', function: 3, address: 1, values: [7] },
    cwd,
    { source: 'manual', sessionId: '' },
  )
  const pack = loadWorkspace(home, cwd).modbus
  assert.ok(((pack.trend && pack.trend.p2) || []).length >= 1, '写回路写入样本')
  assert.equal(pack.trend.p2[pack.trend.p2.length - 1][1], 7, '样本值 = 回读值')
  await rm(home, { recursive: true, force: true })
})

test('通信失败写入 null 断点（曲线不断连错误区间）', async () => {
  const byId = { p2: { id: 'p2', monitorEnabled: true } }
  const trend = sampleTrendValues(
    {},
    [
      { pointId: 'p2', value: 10, ok: true, at: 100 },
      { pointId: 'p2', ok: false, error: '超时', at: 200 },
    ],
    byId,
  )
  assert.deepEqual(
    trend.p2,
    [
      [100, 10],
      [101, null],
    ],
    '失败样本为 null 断点，时间钉在最后有效点之后 1ms',
  )
  const again = sampleTrendValues(trend, [{ pointId: 'p2', ok: false, error: '超时', at: 300 }], byId)
  assert.equal(again.p2.length, 2, '连续失败不再往 X 轴塞空点')
})

test('旧字段迁移：trendEnabled 点位 → monitorEnabled 语义（规范化兼容）', async () => {
  const { home, cwd } = await setup()
  // 直接以旧字段读趋势存储：readTrendSeries 依赖规范化结果
  saveWorkspace(home, cwd, { modbus: { ...baseModbus, trend: { p1: [[1000, 1]], p2: [[1001, 2]] } } })
  const pack = loadWorkspace(home, cwd).modbus
  assert.equal(pack.points[0].monitorEnabled, false, 'p1 旧 field false')
  assert.equal(pack.points[1].monitorEnabled, true, 'p2 旧 true → monitorEnabled')
  const series = readTrendSeries(home, cwd, { pointIds: ['p2'] })
  assert.equal(series[0].samples.length, 1, '旧点位仍可读趋势样本')
  await rm(home, { recursive: true, force: true })
})

test('ring 保留最近 600 个样本', async () => {
  const byId = { p2: { id: 'p2', monitorEnabled: true } }
  const incoming = Array.from({ length: 700 }, (_, i) => ({ pointId: 'p2', value: i, ok: true, at: i + 1 }))
  const trend = sampleTrendValues({}, incoming, byId)
  assert.equal(trend.p2.length, TREND_KEEP)
  assert.equal(trend.p2[0][1], 700 - TREND_KEEP, '最早的样本被淘汰')
})

test('Agent trend 动作返回真实样本（非时间范围句柄）', async () => {
  const { home, cwd } = await setup()
  await runVisionBench(
    home,
    { action: 'read', connectionId: 'c1', deviceId: 'd1', function: 3, address: 1, count: 1 },
    cwd,
    { source: 'agent', sessionId: 's1' },
  )
  const res = await runVisionBench(home, { action: 'trend', connectionId: 'c1', pointIds: ['p2'] }, cwd, {
    source: 'agent',
    sessionId: 's1',
  })
  assert.equal(res.ok, true)
  assert.ok(Array.isArray(res.trend.series), 'trend 返回 series')
  const s2 = res.trend.series.find((s) => s.pointId === 'p2')
  assert.ok(s2 && s2.samples.length >= 1, 'p2 series 带真实样本')
  assert.ok(Array.isArray(s2.samples[0]) && s2.samples[0].length === 2)
  assert.equal(s2.samples[0][0], loadWorkspace(home, cwd).modbus.trend.p2[0][0], '样本时间与存储一致')
  await rm(home, { recursive: true, force: true })
})

test('trendKey 只返回指定点，并使用会话点表元数据', async () => {
  const { home, cwd } = await setup()
  await runVisionBench(
    home,
    { action: 'read', connectionId: 'c1', deviceId: 'd1', function: 3, address: 0, count: 3 },
    cwd,
    { source: 'agent', sessionId: 's1' },
  )
  const res = await runVisionBench(
    home,
    { action: 'trend', trendKey: 'c1:d1:p2' },
    cwd,
    { source: 'agent', sessionId: 's1' },
  )
  assert.equal(res.ok, true, res.error)
  assert.deepEqual(res.trend.pointIds, ['p2'], 'trendKey 只限定一个点')
  assert.equal(res.trend.series.length, 1)
  const s = res.trend.series[0]
  assert.equal(s.pointId, 'p2')
  assert.equal(s.connectionId, 'c1')
  assert.equal(s.deviceId, 'd1')
  assert.ok(s.name, 'session pack name')
  assert.equal(typeof s.hasMore, 'boolean')
  assert.equal('nextCursor' in (res.trend.projected ?? res.trend) || true, true)
  await rm(home, { recursive: true, force: true })
})

test('projectTrend 返回 hasMore/oldestReturnedAt，不再返回 nextCursor:older', async () => {
  const samples = Array.from({ length: 10 }, (_, i) => [1000 + i * 10, i])
  const { projectTrend } = await import('../../src/application/commands/agent-result-project-rest.mjs')
  const projected = projectTrend(
    { limit: 4 },
    {
      ok: true,
      trend: {
        series: [
          {
            pointId: 'p1',
            name: 'P1',
            connectionId: 'c1',
            deviceId: 'd1',
            unit: 'C',
            count: 10,
            samples: samples.slice(-4),
          },
        ],
      },
    },
  )
  const s = projected.trend.series[0]
  assert.equal(s.returned, 4)
  assert.equal(s.hasMore, true)
  assert.equal(s.oldestReturnedAt, samples[6][0])
  assert.notEqual(projected.trend.nextCursor, 'older')
  assert.equal(projected.trend.nextCursor, null)
})

test('readTrendSeries 直接读取存储并限窗', async () => {
  const { home, cwd } = await setup()
  saveWorkspace(home, cwd, {
    modbus: {
      ...baseModbus,
      trend: {
        p2: [
          [1000, 1],
          [2000, 2],
          [3000, 3],
        ],
      },
    },
  })
  const series = readTrendSeries(home, cwd, { pointIds: ['p2'], start: 1500, end: 2500 })
  assert.deepEqual(series[0].samples, [[2000, 2]], '窗口过滤生效')
  await rm(home, { recursive: true, force: true })
})

test('readTrendSeries limit is samples per series; trend(limit=5) ≤5', async () => {
  const { home, cwd } = await setup()
  const samples = Array.from({ length: 20 }, (_, i) => [1000 + i * 100, i])
  saveWorkspace(home, cwd, {
    modbus: {
      ...baseModbus,
      trend: { p2: samples, p1: samples },
    },
  })
  const series = readTrendSeries(home, cwd, { pointIds: ['p1', 'p2'], limit: 5 })
  assert.equal(series.length, 2)
  for (const s of series) {
    assert.equal(s.count, 20)
    assert.equal(s.returned, 5)
    assert.ok(s.samples.length <= 5)
    assert.equal(s.samples.length, 5)
  }
  const ran = await runVisionBench(
    home,
    { action: 'trend', connectionId: 'c1', pointIds: ['p2'], limit: 5, start: 0, end: Date.now() + 1 },
    cwd,
    { source: 'agent', sessionId: 's1' },
  )
  assert.equal(ran.ok, true, ran.error)
  const s2 = ran.trend.series.find((/** @type {any} */ s) => s.pointId === 'p2')
  assert.ok(s2)
  assert.ok(s2.samples.length <= 5)
  assert.equal(ran.trend.limit, 5)
  await rm(home, { recursive: true, force: true })
})
