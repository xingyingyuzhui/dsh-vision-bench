import assert from 'node:assert/strict'
import test from 'node:test'
import { modbusPoll } from '../../bench-modbus.mjs'
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { createBench } from '../helpers/workspace-factory.mjs'
import { device, hrPoint, rtuSim } from '../hmi/multi-conn-fixtures.mjs'
import {
  disposeAlarmNotifyRuntime,
  resetAlarmNotifyRetryTestHooks,
  resetAlarmNotifyTestHooks,
  setAlarmNotifyTestHooks,
  startAlarmNotifyRuntime,
  _internal as alarmInternal,
} from '../../src/application/modbus/poll-alarm-notify.mjs'

function resetAlarmInternals() {
  resetAlarmNotifyTestHooks()
  resetAlarmNotifyRetryTestHooks()
  disposeAlarmNotifyRuntime()
  startAlarmNotifyRuntime()
  alarmInternal.deliveryLedger.clear()
  alarmInternal.agentAlarmWatchByKey.clear()
}

/**
 * RED: private A c1/p and private B c2/p share the runtime pointId slot.
 * Current commit merges by pointId — one logical point survives.
 */
test('same private pointId on two connections rejects the whole batch before I/O', async (t) => {
  resetAlarmInternals()
  const bench = await createBench(t, { prefix: 'dvb-rid-conflict-' })
  const { home, cwd } = bench
  let notifies = 0
  setAlarmNotifyTestHooks({
    notify: async () => {
      notifies += 1
      return { ok: true }
    },
  })
  bench.save({
    modbus: {
      version: 3,
      share: { enabled: false, connections: false, points: false, visualization: false },
      connections: [],
      devices: [],
      points: [],
      values: [{ key: 'p', pointId: 'p', raw: 1, value: 1, ok: true, at: 1 }],
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
  const before = loadWorkspace(home, cwd)
  const ran = await modbusPoll(home, cwd, {})
  assert.equal(ran.ok, false)
  assert.equal(ran.reason, 'ambiguous-owner')
  const after = loadWorkspace(home, cwd)
  assert.deepEqual(after.modbus.values, before.modbus.values)
  assert.deepEqual(after.modbus.trend || {}, before.modbus.trend || {})
  assert.deepEqual(after.modbus.alarmState || {}, before.modbus.alarmState || {})
  assert.equal(notifies, 0)
  // Order independent
  const bench2 = await createBench(t, { prefix: 'dvb-rid-conflict2-' })
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
          points: [hrPoint('p', 'c2', 'd2', 10)],
        },
        a: {
          connections: [rtuSim('c1', 'COM3')],
          devices: [device('d1', 'c1', 1)],
          points: [hrPoint('p', 'c1', 'd1', 0)],
        },
      },
    },
  })
  const ran2 = await modbusPoll(bench2.home, bench2.home && bench2.cwd, {})
  assert.equal(ran2.ok, false)
  assert.equal(ran2.reason, 'ambiguous-owner')
})

test('explicit session / single connection still rejects conflicting pointId slot', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-rid-exp-' })
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
  for (const args of [
    { sessionId: 'a', connectionId: 'c1' },
    { sessionId: 'b', connectionId: 'c2' },
    { connectionId: 'c1' },
  ]) {
    const ran = await modbusPoll(home, cwd, args)
    assert.equal(ran.ok, false, JSON.stringify(args))
    assert.equal(ran.reason, 'ambiguous-owner')
  }
})

test('safe point is not blocked by an unrelated conflicting pointId', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-rid-safe-' })
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
          points: [hrPoint('safe', 'c1', 'd1', 0), hrPoint('p', 'c1', 'd1', 1)],
        },
        b: {
          connections: [rtuSim('c2', 'COM4')],
          devices: [device('d2', 'c2', 1)],
          points: [hrPoint('p', 'c2', 'd2', 10)],
        },
      },
    },
  })
  // c1 also has the conflict on p — whole batch involving c1+ c2 must fail.
  const both = await modbusPoll(home, cwd, {})
  assert.equal(both.ok, false)
  // Unrelated safe-only connection would still work if we only poll a third clean conn.
  // Add a clean c3 and poll it alone.
  saveWorkspace(home, cwd, {
    modbus: {
      ...loadWorkspace(home, cwd).modbus,
      sessionConfigs: {
        ...loadWorkspace(home, cwd).modbus.sessionConfigs,
        c: {
          connections: [rtuSim('c3', 'COM5')],
          devices: [device('d3', 'c3', 1)],
          points: [hrPoint('safe3', 'c3', 'd3', 0)],
        },
      },
    },
  })
  const clean = await modbusPoll(home, cwd, { connectionId: 'c3' })
  assert.equal(clean.ok, true, clean.error)
  assert.ok(clean.values.some((v) => (v.pointId || v.key) === 'safe3'))
})

test('unique pointIds succeed with per-connection values and metadata', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-rid-ok-' })
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
          points: [
            hrPoint('p1', 'c1', 'd1', 0, { alarmEnabled: true, alarmMax: 10, monitorEnabled: true }),
          ],
        },
        b: {
          connections: [rtuSim('c2', 'COM4')],
          devices: [device('d2', 'c2', 2)],
          points: [
            hrPoint('p2', 'c2', 'd2', 5, { alarmEnabled: true, alarmMax: 10, monitorEnabled: true }),
          ],
        },
      },
    },
  })
  const ran = await modbusPoll(home, cwd, {})
  assert.equal(ran.ok, true, ran.error)
  const v1 = ran.values.find((v) => (v.pointId || v.key) === 'p1')
  const v2 = ran.values.find((v) => (v.pointId || v.key) === 'p2')
  assert.ok(v1 && v2, 'both values present')
  assert.equal(v1.connectionId, 'c1')
  assert.equal(v2.connectionId, 'c2')
  assert.equal(v1.deviceId, 'd1')
  assert.equal(v2.deviceId, 'd2')
  const ws = loadWorkspace(home, cwd)
  assert.ok(ws.modbus.trend?.p1?.length >= 1)
  assert.ok(ws.modbus.trend?.p2?.length >= 1)
})

test('shared point visible twice still collects with unique deviceIds', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-rid-shared-' })
  const { home, cwd } = bench
  bench.save({
    modbus: {
      version: 3,
      share: { enabled: true, connections: true, points: true, visualization: false },
      connections: [rtuSim('c1', 'COM3'), rtuSim('c2', 'COM4')],
      devices: [device('d1', 'c1', 1), device('d2', 'c2', 2)],
      points: [
        hrPoint('p1', 'c1', 'd1', 0),
        hrPoint('p2', 'c2', 'd2', 5),
      ],
      sessionConfigs: {
        a: { connections: [], devices: [], points: [] },
        b: { connections: [], devices: [], points: [] },
      },
    },
  })
  const ran = await modbusPoll(home, cwd, {})
  assert.equal(ran.ok, true, ran.error)
  const v1 = ran.values.find((v) => (v.pointId || v.key) === 'p1')
  const v2 = ran.values.find((v) => (v.pointId || v.key) === 'p2')
  assert.ok(v1 && v2)
  assert.equal(v1.connectionId, 'c1')
  assert.equal(v2.connectionId, 'c2')
  assert.equal(v1.deviceId, 'd1')
  assert.equal(v2.deviceId, 'd2')
})

test('same-layer duplicate deviceId is rejected before save; config and version unchanged', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-rid-devdup-' })
  const { home, cwd } = bench
  const before = loadWorkspace(home, cwd)
  const { saveWorkspace } = await import('../../bench-store.mjs')
  const ran = saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [rtuSim('c1', 'COM3'), rtuSim('c2', 'COM4')],
      // Same-layer two d1 rows — must CONFLICT before normalizeDevices drops one.
      devices: [device('d1', 'c1', 1), device('d1', 'c2', 2)],
      points: [hrPoint('p1', 'c1', 'd1', 0)],
    },
  })
  assert.equal(ran.ok, false)
  assert.equal(ran.errorCode, 'CONFLICT')
  assert.ok(Array.isArray(ran.conflicts) && ran.conflicts.length >= 1)
  assert.equal(ran.conflicts[0].deviceId, 'd1')
  const after = loadWorkspace(home, cwd)
  assert.deepEqual(after.modbus.devices, before.modbus.devices)
  assert.equal(after.modbus.configVersion, before.modbus.configVersion)
})
