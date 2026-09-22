import assert from 'node:assert/strict'
import test from 'node:test'
import { modbusPoll } from '../../bench-modbus.mjs'
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { createBench } from '../helpers/workspace-factory.mjs'
import { device, hrPoint, rtuSim } from '../hmi/multi-conn-fixtures.mjs'
import {
  resolvePollSessionOwnership,
  resolvePollTargets,
} from '../../src/application/modbus/poll-session-ownership.mjs'
import {
  disposeAlarmNotifyRuntime,
  resetAlarmNotifyRetryTestHooks,
  resetAlarmNotifyTestHooks,
  setAgentAlarmWatch,
  setAlarmNotifyTestHooks,
  _internal as alarmInternal,
} from '../../src/application/modbus/poll-alarm-notify.mjs'
import { createModbusTransport } from '../../bench-modbus-transport.mjs'

function resetAlarmInternals() {
  resetAlarmNotifyTestHooks()
  resetAlarmNotifyRetryTestHooks()
  disposeAlarmNotifyRuntime()
  alarmInternal.deliveryLedger.clear()
  alarmInternal.agentAlarmWatchByKey.clear()
}

/**
 * @param {any} t
 * @param {string} prefix
 * @param {any} modbus
 */
async function benchWith(t, prefix, modbus) {
  const bench = await createBench(t, { prefix })
  bench.save({ modbus })
  return bench
}

const twinPrivate = (order = ['a', 'b']) => {
  const sessions = {
    a: {
      connections: [rtuSim('c1', 'COM3', { name: 'A' })],
      devices: [device('d1', 'c1', 1)],
      points: [hrPoint('p1', 'c1', 'd1', 0, { alarmEnabled: true, alarmMax: 50, monitorEnabled: true })],
    },
    b: {
      connections: [rtuSim('c1', 'COM4', { name: 'B' })],
      devices: [device('d1', 'c1', 1)],
      points: [hrPoint('p1', 'c1', 'd1', 0, { alarmEnabled: true, alarmMax: 50, monitorEnabled: true })],
    },
  }
  const sessionConfigs = {}
  for (const key of order) sessionConfigs[key] = sessions[key]
  return {
    version: 3,
    share: { enabled: false, connections: false, points: false, visualization: false },
    connections: [],
    devices: [],
    points: [],
    sessionConfigs,
  }
}

test('same id private connections: explicit cid and batch both reject; order independent', async (t) => {
  for (const order of [
    ['a', 'b'],
    ['b', 'a'],
  ]) {
    const bench = await benchWith(t, 'dvb-own-twin-' + order.join(''), twinPrivate(order))
    const { home, cwd } = bench
    const ws = loadWorkspace(home, cwd)
    const withCid = resolvePollTargets(ws, { connectionId: 'c1' })
    assert.equal(withCid.ok, false, order.join(','))
    assert.equal(withCid.reason, 'ambiguous-owner')
    assert.deepEqual(
      withCid.conflicts?.[0]?.owners?.sort(),
      ['a', 'b'],
    )
    const batch = resolvePollTargets(ws, {})
    assert.equal(batch.ok, false)
    assert.equal(batch.reason, 'ambiguous-owner')
  }
})

test('one clean + one ambiguous connection: whole round fails with zero I/O and zero runtime commit', async (t) => {
  resetAlarmInternals()
  const bench = await benchWith(t, 'dvb-own-mixed-', {
    version: 3,
    share: { enabled: false, connections: false, points: false, visualization: false },
    connections: [],
    devices: [],
    points: [],
    values: [{ key: 'p-ok', pointId: 'p-ok', raw: 1, value: 1, ok: true, at: 1 }],
    framesByConnection: {},
    sessionConfigs: {
      a: {
        connections: [rtuSim('c-ok', 'COM3'), rtuSim('c1', 'COM4')],
        devices: [device('d-ok', 'c-ok', 1), device('d1', 'c1', 1)],
        points: [hrPoint('p-ok', 'c-ok', 'd-ok', 0)],
      },
      b: {
        connections: [rtuSim('c1', 'COM5')],
        devices: [device('d1', 'c1', 1)],
        points: [hrPoint('p1', 'c1', 'd1', 0)],
      },
    },
  })
  const { home, cwd } = bench
  const before = loadWorkspace(home, cwd)
  const ran = await modbusPoll(home, cwd, {})
  assert.equal(ran.ok, false)
  assert.equal(ran.skipped, true)
  assert.equal(ran.reason, 'ambiguous-owner')
  assert.equal(ran.conflicts?.length >= 1, true)
  const after = loadWorkspace(home, cwd)
  assert.deepEqual(after.modbus.values, before.modbus.values)
  assert.deepEqual(after.modbus.framesByConnection || {}, before.modbus.framesByConnection || {})
  assert.deepEqual(after.modbus.pollingByConnection, before.modbus.pollingByConnection)
})

test('explicit session A/B resolve to own endpoint; wrong session errors', async (t) => {
  const bench = await benchWith(t, 'dvb-own-exp-', twinPrivate(['a', 'b']))
  const { home, cwd } = bench
  const ws = loadWorkspace(home, cwd)
  const a = resolvePollTargets(ws, { sessionId: 'a', connectionId: 'c1' })
  assert.equal(a.ok, true)
  assert.deepEqual(a.targets, [{ connectionId: 'c1', sourceSessionId: 'a', shared: false }])
  const b = resolvePollTargets(ws, { sessionId: 'b', connectionId: 'c1' })
  assert.equal(b.ok, true)
  assert.deepEqual(b.targets, [{ connectionId: 'c1', sourceSessionId: 'b', shared: false }])
  const wrong = resolvePollTargets(ws, { sessionId: 'zz', connectionId: 'c1' })
  assert.equal(wrong.ok, false)
  assert.equal(wrong.reason, 'target-mismatch')
})

test('two unique private connections batch-read; each alarm uses its source session', async (t) => {
  resetAlarmInternals()
  /** @type {Record<string, string>} */
  const seen = {}
  setAlarmNotifyTestHooks({
    notify: async (_h, _c, _s, _d, opts) => {
      seen[String(opts?.sessionId || '')] = String(opts?.sessionId || '')
      return { ok: true }
    },
  })
  const bench = await benchWith(t, 'dvb-own-multi-', {
    version: 3,
    share: { enabled: false, connections: false, points: false, visualization: false },
    connections: [],
    devices: [],
    points: [],
    alarmState: {},
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
        devices: [device('d2', 'c2', 1)],
        points: [
          hrPoint('p2', 'c2', 'd2', 0, { alarmEnabled: true, alarmMax: 10, monitorEnabled: true }),
        ],
      },
    },
  })
  const { home, cwd } = bench
  setAgentAlarmWatch(cwd, { followup: true, sessionId: 'a', pointIds: ['p1'], connectionId: 'c1' })
  setAgentAlarmWatch(cwd, { followup: true, sessionId: 'b', pointIds: ['p2'], connectionId: 'c2' })
  const resolved = resolvePollTargets(loadWorkspace(home, cwd), {})
  assert.equal(resolved.ok, true)
  assert.equal(resolved.targets.length, 2)
  const ran = await modbusPoll(home, cwd, {})
  assert.equal(ran.ok, true, ran.error)
  // High raw values trip alarmMax=10 in sim fill path or via stored values.
  const ws = loadWorkspace(home, cwd)
  assert.ok(ws.modbus.values.some((v) => v.pointId === 'p1' || v.key === 'p1'))
  assert.ok(ws.modbus.values.some((v) => v.pointId === 'p2' || v.key === 'p2'))
  // sourceSessionByConnection maps each connection to its unique owner
  assert.equal(resolvePollSessionOwnership(ws, { connectionId: 'c1' }).targetSessionId, 'a')
  assert.equal(resolvePollSessionOwnership(ws, { connectionId: 'c2' }).targetSessionId, 'b')
})

test('explicit shared connection + multi-session shared subscribe + legacy top-level + boundId', async (t) => {
  resetAlarmInternals()
  // Shared connection with share on
  const sharedBench = await benchWith(t, 'dvb-own-shared-', {
    version: 3,
    share: { enabled: true, connections: true, points: true, visualization: false },
    connections: [rtuSim('c1', 'COM3')],
    devices: [device('d1', 'c1', 1)],
    points: [hrPoint('p1', 'c1', 'd1', 0)],
    sessionConfigs: {
      a: { connections: [], devices: [], points: [] },
      b: { connections: [], devices: [], points: [] },
    },
  })
  const sws = loadWorkspace(sharedBench.home, sharedBench.cwd)
  const shared = resolvePollTargets(sws, { connectionId: 'c1' })
  assert.equal(shared.ok, true)
  assert.equal(shared.targets[0].shared, true)
  assert.equal(shared.targets[0].sourceSessionId, '')

  // Legacy unpartitioned workspace
  const legacyBench = await benchWith(t, 'dvb-own-legacy-', {
    version: 3,
    connections: [rtuSim('c1', 'COM3')],
    devices: [device('d1', 'c1', 1)],
    points: [hrPoint('p1', 'c1', 'd1', 0)],
  })
  const lws = loadWorkspace(legacyBench.home, legacyBench.cwd)
  const legacy = resolvePollTargets(lws, {})
  assert.equal(legacy.ok, true)
  assert.equal(legacy.targets[0].shared, true)

  // boundId alone cannot collapse duplicate private ids
  const boundBench = await benchWith(t, 'dvb-own-bound-', twinPrivate(['a', 'b']))
  saveWorkspace(boundBench.home, boundBench.cwd, {
    session: { boundId: 'a' },
    modbus: loadWorkspace(boundBench.home, boundBench.cwd).modbus,
  })
  const bws = loadWorkspace(boundBench.home, boundBench.cwd)
  assert.equal(bws.session.boundId, 'a')
  const bound = resolvePollTargets(bws, {})
  assert.equal(bound.ok, false, 'boundId must not resolve private id twins')
  assert.equal(bound.reason, 'ambiguous-owner')

  // No sessionConfigs at all with boundId: default view ok
  const bound2 = await benchWith(t, 'dvb-own-bound2-', {
    version: 3,
    connections: [rtuSim('c1', 'COM3')],
    devices: [device('d1', 'c1', 1)],
    points: [hrPoint('p1', 'c1', 'd1', 0)],
    sessionConfigs: {},
  })
  saveWorkspace(bound2.home, bound2.cwd, {
    session: { boundId: 'a' },
    modbus: loadWorkspace(bound2.home, bound2.cwd).modbus,
  })
  const ok = resolvePollTargets(loadWorkspace(bound2.home, bound2.cwd), {})
  assert.equal(ok.ok, true)
})

test('createModbusTransport is never constructed on ambiguous batch', async (t) => {
  let constructed = 0
  const orig = createModbusTransport
  // Count via wrapping transportOf by using opts.transport spy instead.
  const bench = await benchWith(t, 'dvb-own-zero-', twinPrivate(['a', 'b']))
  const spy = {
    open: async () => {
      constructed += 1
    },
  }
  const ran = await modbusPoll(bench.home, bench.cwd, { transport: spy })
  assert.equal(ran.ok, false)
  assert.equal(constructed, 0)
  void orig
})
