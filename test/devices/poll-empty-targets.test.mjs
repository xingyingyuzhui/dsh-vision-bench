import assert from 'node:assert/strict'
import test from 'node:test'
import { modbusPoll } from '../../bench-modbus.mjs'
import { loadWorkspace } from '../../bench-store.mjs'
import { createBench } from '../helpers/workspace-factory.mjs'
import { device, hrPoint, rtuSim } from '../hmi/multi-conn-fixtures.mjs'

/**
 * RED first: A has a connection but no points, B has valid points.
 * Current code takes packForTarget(targets[0]) and returns 无点位 for the whole batch.
 */
test('empty target pack must not block a sibling target that has points', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-empty-a-' })
  const { home, cwd } = bench
  bench.save({
    modbus: {
      version: 3,
      share: { enabled: false, connections: false, points: false, visualization: false },
      connections: [],
      devices: [],
      points: [],
      sessionConfigs: {
        a: {
          connections: [rtuSim('c1', 'COM3')],
          devices: [device('d1', 'c1', 1)],
          points: [],
        },
        b: {
          connections: [rtuSim('c2', 'COM4')],
          devices: [device('d2', 'c2', 1)],
          points: [hrPoint('p2', 'c2', 'd2', 0)],
        },
      },
    },
  })
  const ran = await modbusPoll(home, cwd, {})
  assert.equal(ran.ok, true, `expected success, got ${ran.error || ran.reason || ''}`)
  assert.ok(ran.values.some((v) => (v.pointId || v.key) === 'p2'))
  // Order independent: swap — still succeeds.
  const bench2 = await createBench(t, { prefix: 'dvb-empty-b-' })
  bench2.save({
    modbus: {
      version: 3,
      share: { enabled: false, connections: false, points: false, visualization: false },
      connections: [],
      devices: [],
      points: [],
      sessionConfigs: {
        b: {
          connections: [rtuSim('c2', 'COM4')],
          devices: [device('d2', 'c2', 1)],
          points: [hrPoint('p2', 'c2', 'd2', 0)],
        },
        a: {
          connections: [rtuSim('c1', 'COM3')],
          devices: [device('d1', 'c1', 1)],
          points: [],
        },
      },
    },
  })
  const ran2 = await modbusPoll(bench2.home, bench2.cwd, {})
  assert.equal(ran2.ok, true, ran2.error)
  assert.ok(ran2.values.some((v) => (v.pointId || v.key) === 'p2'))
})

test('explicit empty connection yields 无点位; explicit valid connection works', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-empty-exp-' })
  const { home, cwd } = bench
  bench.save({
    modbus: {
      version: 3,
      share: { enabled: false, connections: false, points: false, visualization: false },
      connections: [],
      devices: [],
      points: [],
      sessionConfigs: {
        a: {
          connections: [rtuSim('c1', 'COM3')],
          devices: [device('d1', 'c1', 1)],
          points: [],
        },
        b: {
          connections: [rtuSim('c2', 'COM4')],
          devices: [device('d2', 'c2', 1)],
          points: [hrPoint('p2', 'c2', 'd2', 0)],
        },
      },
    },
  })
  const empty = await modbusPoll(home, cwd, { connectionId: 'c1' })
  assert.equal(empty.ok, false)
  assert.match(String(empty.error || ''), /无点位/)
  const ok = await modbusPoll(home, cwd, { connectionId: 'c2' })
  assert.equal(ok.ok, true, ok.error)
  assert.ok(ok.values.some((v) => (v.pointId || v.key) === 'p2'))
})

test('all empty still reports 无点位 once for the batch', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-empty-all-' })
  const { home, cwd } = bench
  bench.save({
    modbus: {
      version: 3,
      share: { enabled: false, connections: false, points: false, visualization: false },
      connections: [],
      devices: [],
      points: [],
      sessionConfigs: {
        a: { connections: [rtuSim('c1', 'COM3')], devices: [], points: [] },
        b: { connections: [rtuSim('c2', 'COM4')], devices: [], points: [] },
      },
    },
  })
  const ran = await modbusPoll(home, cwd, {})
  assert.equal(ran.ok, false)
  assert.match(String(ran.error || ''), /无点位/)
})
