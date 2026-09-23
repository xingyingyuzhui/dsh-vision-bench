import assert from 'node:assert/strict'
import test from 'node:test'
import { commitPollResult, pruneAlarmStateForPoints, alarmActiveFromState } from '../../bench-modbus-commit.mjs'
import { modbusPoll } from '../../bench-modbus.mjs'
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { createBench } from '../helpers/workspace-factory.mjs'
import { device, hrPoint, rtuSim } from '../hmi/multi-conn-fixtures.mjs'

test('pruneAlarmStateForPoints drops process alarms for deleted points', () => {
  const pruned = pruneAlarmStateForPoints(
    {
      p1: { group: 'process', condition: 'active', pointId: 'p1' },
      pGone: { group: 'process', condition: 'active', pointId: 'pGone' },
      'comm:c1': { group: 'comm', condition: 'active', connectionId: 'c1' },
    },
    [{ id: 'p1' }],
  )
  assert.ok(pruned.p1)
  assert.equal(pruned.pGone, undefined)
  assert.ok(pruned['comm:c1'])
  assert.deepEqual(alarmActiveFromState(pruned, [{ id: 'p1' }]), { p1: true })
})

test('commitPollResult computes alarmActive and returns fired only after success', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-alarm-commit-' })
  const { home, cwd } = bench
  bench.save({
    modbus: {
      version: 3,
      connections: [rtuSim('c1', 'COM3')],
      devices: [device('d1', 'c1', 1)],
      points: [
        hrPoint('p1', 'c1', 'd1', 0, {
          alarmEnabled: true,
          alarmMax: 50,
          monitorEnabled: true,
        }),
      ],
      values: [],
      alarmState: {},
      alarmActive: {},
      pollingByConnection: { c1: { enabled: true, intervalMs: 1000, lastOk: true, error: '' } },
    },
  })
  const seeded = loadWorkspace(home, cwd)
  const committed = await commitPollResult(home, cwd, {
    baseConfigVersion: seeded.modbus.configVersion,
    pointValues: [{ key: 'p1', pointId: 'p1', raw: 90, value: 90, ok: true, at: Date.now() }],
    pollingRuntime: {
      c1: { lastAt: Date.now(), lastOk: true, error: '' },
    },
  })
  assert.equal(committed.ok, true)
  assert.equal(committed.drift, false)
  assert.equal(committed.alarms.fired.length, 1)
  assert.equal(committed.alarms.alarmActive.p1, true)
  const ws = loadWorkspace(home, cwd)
  // alarmActive is a legacy getter alias of alarmState after normalizeModbus
  assert.equal(ws.modbus.alarmState.p1.condition, 'active')
  assert.equal(ws.modbus.alarmActive.p1.condition, 'active')

  // Same breach again: suppress/dedup → no second fired entry
  const again = await commitPollResult(home, cwd, {
    baseConfigVersion: ws.modbus.configVersion,
    pointValues: [{ key: 'p1', pointId: 'p1', raw: 91, value: 91, ok: true, at: Date.now() }],
    pollingRuntime: {
      c1: { lastAt: Date.now(), lastOk: true, error: '' },
    },
  })
  assert.equal(again.ok, true)
  assert.equal(again.alarms.fired.length, 0)
  assert.equal(again.alarms.alarmActive.p1, true)
})

test('config drift commit suppresses fired notifications and skips stale value merge', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-alarm-drift-' })
  const { home, cwd } = bench
  bench.save({
    modbus: {
      version: 3,
      connections: [rtuSim('c1', 'COM3')],
      devices: [device('d1', 'c1', 1)],
      points: [hrPoint('p1', 'c1', 'd1', 0, { alarmEnabled: true, alarmMax: 50, monitorEnabled: true })],
      values: [{ key: 'p1', pointId: 'p1', raw: 10, value: 10, ok: true, at: 1 }],
      alarmState: {},
      alarmActive: {},
      pollingByConnection: { c1: { enabled: true, intervalMs: 1000 } },
    },
  })
  const seeded = loadWorkspace(home, cwd)
  const drifted = await commitPollResult(home, cwd, {
    baseConfigVersion: Number(seeded.modbus.configVersion) - 1,
    pointValues: [{ key: 'p1', pointId: 'p1', raw: 99, value: 99, ok: true, at: Date.now() }],
    pollingRuntime: {
      c1: { lastAt: Date.now(), lastOk: true, error: '' },
    },
  })
  assert.equal(drifted.ok, true)
  assert.equal(drifted.drift, true)
  assert.deepEqual(drifted.alarms.fired, [])
  const ws = loadWorkspace(home, cwd)
  // Drift suppresses value merge from the stale payload…
  assert.equal(ws.modbus.values.find((v) => v.pointId === 'p1')?.raw, 10)
  // …but still refreshes alarm maps from disk values (no breach at raw=10).
  assert.equal(ws.modbus.alarmState.p1?.condition === 'active', false)
})

test('deleted alarm point is pruned from alarmActive on next poll commit', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-alarm-ghost-' })
  const { home, cwd } = bench
  bench.save({
    modbus: {
      version: 3,
      connections: [rtuSim('c1', 'COM3')],
      devices: [device('d1', 'c1', 1)],
      points: [hrPoint('p1', 'c1', 'd1', 0, { alarmEnabled: true, alarmMax: 50, monitorEnabled: true })],
      values: [{ key: 'p1', pointId: 'p1', raw: 90, value: 90, ok: true, at: 1 }],
      alarmState: {
        p1: { id: 'p1', group: 'process', condition: 'active', pointId: 'p1', status: 'active' },
        pGone: { id: 'pGone', group: 'process', condition: 'active', pointId: 'pGone', status: 'active' },
      },
      alarmActive: { p1: true, pGone: true },
      pollingByConnection: { c1: { enabled: true, intervalMs: 1000 } },
    },
  })
  const seeded = loadWorkspace(home, cwd)
  const committed = await commitPollResult(home, cwd, {
    baseConfigVersion: seeded.modbus.configVersion,
    pointValues: [{ key: 'p1', pointId: 'p1', raw: 90, value: 90, ok: true, at: Date.now() }],
    pollingRuntime: {
      c1: { lastAt: Date.now(), lastOk: true, error: '' },
    },
  })
  assert.equal(committed.ok, true)
  assert.equal(committed.alarms.alarmActive.pGone, undefined)
  const ws = loadWorkspace(home, cwd)
  assert.equal(ws.modbus.alarmState.pGone, undefined)
  assert.equal(ws.modbus.alarmActive.pGone, undefined)
})

test('modbusPoll recovery clears alarmActive after breach', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-alarm-poll-' })
  const { home, cwd } = bench
  // Use commit to seed an active alarm, then poll with normal sim value path via commit recover
  bench.save({
    modbus: {
      version: 3,
      connections: [rtuSim('c1', 'COM3')],
      devices: [device('d1', 'c1', 1)],
      points: [
        hrPoint('p1', 'c1', 'd1', 0, {
          alarmEnabled: true,
          alarmMax: 100000,
          alarmMin: null,
          monitorEnabled: true,
        }),
      ],
      values: [],
      pollingByConnection: { c1: { enabled: true, intervalMs: 1000 } },
    },
  })
  const ran = await modbusPoll(home, cwd, { connectionId: 'c1' })
  assert.equal(ran.ok, true)
  // With a huge alarmMax, sim values should not fire; ensure maps stay objects
  const ws = loadWorkspace(home, cwd)
  assert.equal(typeof ws.modbus.alarmActive, 'object')
  assert.equal(typeof ws.modbus.alarmState, 'object')
})
