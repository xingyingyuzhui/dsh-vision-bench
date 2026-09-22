import assert from 'node:assert/strict'
import test from 'node:test'
import { modbusPoll } from '../../bench-modbus.mjs'
import { loadWorkspace } from '../../bench-store.mjs'
import { createBench } from '../helpers/workspace-factory.mjs'
import { device, hrPoint, rtuSim } from '../hmi/multi-conn-fixtures.mjs'

/**
 * c1 enabled reads safe; c2/c3 disabled but define dup. Must succeed on c1 only.
 * R4 collected all preparedTargets' points before the enabled filter.
 */
test('disabled connections with conflicting pointIds do not block the executable target', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-dis-dup-' })
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
          connections: [rtuSim('c1', 'COM3', { enabled: true })],
          devices: [device('d1', 'c1', 1)],
          points: [hrPoint('safe', 'c1', 'd1', 0)],
        },
        b: {
          connections: [rtuSim('c2', 'COM4', { enabled: false })],
          devices: [device('d2', 'c2', 1)],
          points: [hrPoint('dup', 'c2', 'd2', 0)],
        },
        c: {
          connections: [rtuSim('c3', 'COM5', { enabled: false })],
          devices: [device('d3', 'c3', 1)],
          points: [hrPoint('dup', 'c3', 'd3', 0)],
        },
      },
    },
  })
  const ran = await modbusPoll(home, cwd, {})
  assert.equal(ran.ok, true, `${ran.reason || ''} ${ran.error || ''}`)
  assert.ok(ran.values.some((v) => (v.pointId || v.key) === 'safe'))
  assert.equal(
    ran.values.some((v) => (v.pointId || v.key) === 'dup'),
    false,
  )
  // Explicit safe-only matches batch result.
  const only = await modbusPoll(home, cwd, { connectionId: 'c1' })
  assert.equal(only.ok, true, only.error)
})

test('enabling the conflicting connections rejects the whole round with 0 I/O', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-dis-on-' })
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
          connections: [rtuSim('c1', 'COM3', { enabled: true })],
          devices: [device('d1', 'c1', 1)],
          points: [hrPoint('safe', 'c1', 'd1', 0)],
        },
        b: {
          connections: [rtuSim('c2', 'COM4', { enabled: true })],
          devices: [device('d2', 'c2', 1)],
          points: [hrPoint('dup', 'c2', 'd2', 0)],
        },
        c: {
          connections: [rtuSim('c3', 'COM5', { enabled: true })],
          devices: [device('d3', 'c3', 1)],
          points: [hrPoint('dup', 'c3', 'd3', 0)],
        },
      },
    },
  })
  const before = loadWorkspace(home, cwd)
  const ran = await modbusPoll(home, cwd, {})
  assert.equal(ran.ok, false)
  assert.equal(ran.reason, 'ambiguous-owner')
  const after = loadWorkspace(home, cwd)
  assert.deepEqual(after.modbus.values, before.modbus.values)
})

test('c1 reading p still conflicts when another EFFECTIVE private layer owns p even if that conn is disabled', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-dis-shadow-' })
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
          connections: [rtuSim('c1', 'COM3', { enabled: true })],
          devices: [device('d1', 'c1', 1)],
          points: [hrPoint('p', 'c1', 'd1', 0)],
        },
        b: {
          // Disabled connection — does NOT release the global pointId slot.
          connections: [rtuSim('c2', 'COM4', { enabled: false })],
          devices: [device('d2', 'c2', 1)],
          points: [hrPoint('p', 'c2', 'd2', 9)],
        },
      },
    },
  })
  const ran = await modbusPoll(home, cwd, { connectionId: 'c1' })
  assert.equal(ran.ok, false)
  assert.equal(ran.reason, 'ambiguous-owner')
})

test('all disabled → 无可用连接; empty enabled + non-empty disabled → 无点位/空目标 contract', async (t) => {
  const allOff = await createBench(t, { prefix: 'dvb-dis-all-' })
  allOff.save({
    modbus: {
      version: 3,
      share: { enabled: false, connections: false, points: false, visualization: false },
      connections: [],
      devices: [],
      points: [],
      sessionConfigs: {
        a: {
          connections: [rtuSim('c1', 'COM3', { enabled: false })],
          devices: [device('d1', 'c1', 1)],
          points: [hrPoint('p', 'c1', 'd1', 0)],
        },
      },
    },
  })
  const off = await modbusPoll(allOff.home, allOff.cwd, {})
  assert.equal(off.ok, false)
  assert.match(String(off.error || ''), /无可用连接|连接不存在/)

  const mixed = await createBench(t, { prefix: 'dvb-dis-mixed-' })
  mixed.save({
    modbus: {
      version: 3,
      share: { enabled: false, connections: false, points: false, visualization: false },
      connections: [],
      devices: [],
      points: [],
      sessionConfigs: {
        a: {
          // Enabled but empty
          connections: [rtuSim('c1', 'COM3', { enabled: true })],
          devices: [device('d1', 'c1', 1)],
          points: [],
        },
        b: {
          // Disabled with points — must not make the batch "has points"
          connections: [rtuSim('c2', 'COM4', { enabled: false })],
          devices: [device('d2', 'c2', 1)],
          points: [hrPoint('p', 'c2', 'd2', 0)],
        },
      },
    },
  })
  const empty = await modbusPoll(mixed.home, mixed.cwd, {})
  assert.equal(empty.ok, false)
  assert.match(String(empty.error || ''), /无点位/)
})
