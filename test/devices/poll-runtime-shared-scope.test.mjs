import assert from 'node:assert/strict'
import test from 'node:test'
import { modbusPoll } from '../../bench-modbus.mjs'
import { loadWorkspace } from '../../bench-store.mjs'
import { createBench } from '../helpers/workspace-factory.mjs'
import { device, hrPoint, rtuSim } from '../hmi/multi-conn-fixtures.mjs'

/**
 * Shared p overrides a shadowed private backup. Must collect shared p (addr 0),
 * never the private addr 99. R4 falsely rejected this as a conflict.
 */
test('shared point overrides shadowed private backup and collects addr 0', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-shared-shadow-' })
  const { home, cwd } = bench
  bench.save({
    modbus: {
      version: 3,
      share: { enabled: true, connections: true, points: true, visualization: false },
      connections: [rtuSim('c1', 'COM3')],
      devices: [device('d1', 'c1', 1)],
      points: [hrPoint('p', 'c1', 'd1', 0)],
      sessionConfigs: {
        a: {
          connections: [],
          devices: [],
          // Shadowed backup of the same pointId at a different address.
          points: [hrPoint('p', 'c1', 'd1', 99)],
        },
        b: {
          connections: [],
          devices: [],
          points: [hrPoint('p', 'c1', 'd1', 98)],
        },
      },
    },
  })
  const ran = await modbusPoll(home, cwd, {})
  assert.equal(ran.ok, true, ran.error)
  assert.equal(ran.reason, undefined)
  const v = ran.values.find((x) => (x.pointId || x.key) === 'p')
  assert.ok(v, 'shared p collected')
  // Address 0 is the shared definition — never 98/99 from the shadowed backups.
  assert.notEqual(v.raw, 98)
  assert.notEqual(v.raw, 99)
  const explicit = await modbusPoll(home, cwd, { sessionId: 'a' })
  assert.equal(explicit.ok, true, explicit.error)
})

test('points share master disabled is not shared; two private p still conflict', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-shared-off-' })
  const { home, cwd } = bench
  bench.save({
    modbus: {
      version: 3,
      // Category checkbox on but master off → NOT shared.
      share: { enabled: false, connections: true, points: true, visualization: false },
      connections: [],
      devices: [],
      points: [],
      sessionConfigs: {
        a: {
          connections: [rtuSim('c1', 'COM3')],
          devices: [device('d1', 'c1', 1)],
          points: [hrPoint('p', 'c1', 'd1', 0)],
        },
        b: {
          connections: [rtuSim('c2', 'COM4')],
          devices: [device('d2', 'c2', 1)],
          points: [hrPoint('p', 'c2', 'd2', 10)],
        },
      },
    },
  })
  const ran = await modbusPoll(home, cwd, {})
  assert.equal(ran.ok, false)
  assert.equal(ran.reason, 'ambiguous-owner')
})

test('same shared object visible to many sessions is not double-counted; order independent', async (t) => {
  for (const order of [
    ['a', 'b'],
    ['b', 'a'],
  ]) {
    const sessionConfigs = {
      [order[0]]: { connections: [], devices: [], points: [] },
      [order[1]]: { connections: [], devices: [], points: [] },
    }
    const bench = await createBench(t, { prefix: 'dvb-shared-multi-' + order.join('') })
    bench.save({
      modbus: {
        version: 3,
        share: { enabled: true, connections: true, points: true, visualization: false },
        connections: [rtuSim('c1', 'COM3')],
        devices: [device('d1', 'c1', 1)],
        points: [hrPoint('p', 'c1', 'd1', 0)],
        sessionConfigs,
      },
    })
    const ran = await modbusPoll(bench.home, bench.cwd, {})
    assert.equal(ran.ok, true, ran.error)
  }
})

test('IDs with quotes/backslashes/separators do not false-conflict via string surgery', async (t) => {
  const weird = 'p"x\\y:z'
  const bench = await createBench(t, { prefix: 'dvb-shared-weird-' })
  const { home, cwd } = bench
  bench.save({
    modbus: {
      version: 3,
      share: { enabled: true, connections: true, points: true, visualization: false },
      connections: [rtuSim('c1', 'COM3')],
      devices: [device('d1', 'c1', 1)],
      points: [hrPoint(weird, 'c1', 'd1', 0)],
      sessionConfigs: {
        a: { connections: [], devices: [], points: [hrPoint(weird, 'c1', 'd1', 77)] },
      },
    },
  })
  const ran = await modbusPoll(home, cwd, {})
  assert.equal(ran.ok, true, `${ran.reason || ''} ${ran.error || ''}`)
  const v = ran.values.find((x) => (x.pointId || x.key) === weird)
  assert.ok(v)
})

test('unpartitioned legacy workspace still collects; private twin regression still rejects', async (t) => {
  const legacy = await createBench(t, { prefix: 'dvb-shared-legacy-' })
  legacy.save({
    modbus: {
      version: 3,
      connections: [rtuSim('c1', 'COM3')],
      devices: [device('d1', 'c1', 1)],
      points: [hrPoint('p', 'c1', 'd1', 0)],
    },
  })
  const ok = await modbusPoll(legacy.home, legacy.cwd, {})
  assert.equal(ok.ok, true, ok.error)

  const twins = await createBench(t, { prefix: 'dvb-shared-twins-' })
  twins.save({
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
          points: [hrPoint('p', 'c1', 'd1', 0)],
        },
        b: {
          connections: [rtuSim('c2', 'COM4')],
          devices: [device('d2', 'c2', 1)],
          points: [hrPoint('p', 'c2', 'd2', 5)],
        },
      },
    },
  })
  const bad = await modbusPoll(twins.home, twins.cwd, {})
  assert.equal(bad.ok, false)
  assert.equal(bad.reason, 'ambiguous-owner')
})
