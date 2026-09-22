import assert from 'node:assert/strict'
import test from 'node:test'
import {
  disposeAlarmNotifyRuntime,
  startAlarmNotifyRuntime,
  emitCommittedAlarmTransitions,
  getAgentAlarmWatch,
  recheckAlarmCurrent,
  recipientStillAuthorized,
  resetAlarmNotifyRetryTestHooks,
  resetAlarmNotifyTestHooks,
  revokeAgentAlarmSubscription,
  setAgentAlarmWatch,
  setAlarmNotifyRetryTestHooks,
  setAlarmNotifyTestHooks,
  _internal as alarmInternal,
} from '../../src/application/modbus/poll-alarm-notify.mjs'
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { createBench } from '../helpers/workspace-factory.mjs'
import { device, hrPoint, rtuSim } from '../hmi/multi-conn-fixtures.mjs'

function resetAlarmInternals() {
  resetAlarmNotifyTestHooks()
  resetAlarmNotifyRetryTestHooks()
  disposeAlarmNotifyRuntime()
  startAlarmNotifyRuntime()
  alarmInternal.deliveryLedger.clear()
  alarmInternal.agentAlarmWatchByKey.clear()
}

/**
 * @param {any} t
 */
async function setupWatchBench(t) {
  const bench = await createBench(t, { prefix: 'dvb-retry-auth-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    session: { boundId: 'sess-a' },
    modbus: {
      version: 3,
      connections: [rtuSim('c1', 'COM3'), rtuSim('c2', 'COM4')],
      devices: [device('d1', 'c1', 1), device('d2', 'c2', 1)],
      points: [
        hrPoint('p1', 'c1', 'd1', 0, { alarmEnabled: true, alarmMax: 50, monitorEnabled: true }),
        hrPoint('p2', 'c2', 'd2', 0, { alarmEnabled: true, alarmMax: 50, monitorEnabled: true }),
      ],
      alarmState: {
        p1: { condition: 'active', pointId: 'p1', group: 'process', connectionId: 'c1' },
        p2: { condition: 'active', pointId: 'p2', group: 'process', connectionId: 'c2' },
      },
    },
  })
  return bench
}

test('subscriptionId mints on target change, keeps on pure renewal; pointIds order is irrelevant', async (t) => {
  resetAlarmInternals()
  const bench = await setupWatchBench(t)
  const { cwd } = bench
  const a = setAgentAlarmWatch(cwd, {
    followup: true,
    sessionId: 'sess-a',
    pointIds: ['p1', 'p2'],
    connectionId: 'c1',
  })
  const b = setAgentAlarmWatch(cwd, {
    followup: true,
    sessionId: 'sess-a',
    pointIds: ['p2', 'p1'],
    connectionId: 'c1',
    ttlMs: 60_000,
  })
  assert.equal(b.subscriptionId, a.subscriptionId, 'sorted pointIds are the same target set')

  const c = setAgentAlarmWatch(cwd, {
    followup: true,
    sessionId: 'sess-a',
    pointIds: ['p2'],
    connectionId: 'c2',
    ttlMs: 60_000,
  })
  assert.notEqual(c.subscriptionId, a.subscriptionId, 'target change mints a new id')

  const d = setAgentAlarmWatch(cwd, {
    followup: true,
    sessionId: 'sess-a',
    pointIds: ['p2'],
    connectionId: 'c2',
    ttlMs: 120_000,
  })
  assert.equal(d.subscriptionId, c.subscriptionId, 'pure renewal keeps id')
})

test('retry after target change does not send the old p1 notification', async (t) => {
  resetAlarmInternals()
  const bench = await setupWatchBench(t)
  const { home, cwd } = bench
  let calls = 0
  /** @type {any[]} */
  const timers = []
  setAlarmNotifyTestHooks({
    notify: async () => {
      calls += 1
      return { ok: false, error: 'down' }
    },
  })
  setAlarmNotifyRetryTestHooks({
    clock: () => 10_000,
    setTimer: (fn) => {
      timers.push(fn)
      return fn
    },
    clearTimer: () => {},
  })
  const sub = setAgentAlarmWatch(cwd, {
    followup: true,
    sessionId: 'sess-a',
    pointIds: ['p1'],
    connectionId: 'c1',
    ttlMs: 60_000,
  })
  const point = loadWorkspace(home, cwd).modbus.points.find((p) => p.id === 'p1')
  const item = { point, kind: 'max', raw: 99, at: 1, eventId: 'auth-evt' }
  const ran = await emitCommittedAlarmTransitions(home, cwd, { fired: [item] })
  assert.equal(ran.queued, 1)
  assert.equal(calls, 1)

  // Switch subscription to c2/p2 — new identity.
  const next = setAgentAlarmWatch(cwd, {
    followup: true,
    sessionId: 'sess-a',
    pointIds: ['p2'],
    connectionId: 'c2',
    ttlMs: 60_000,
  })
  assert.notEqual(next.subscriptionId, sub.subscriptionId)
  assert.equal(timers.length >= 1, true)
  await timers[timers.length - 1]()
  assert.equal(calls, 1, 'old p1 task must not fire after target change')
  assert.equal(alarmInternal.getDeliveryEntry('auth-evt', 'sess-a')?.state, 'exhausted')
})

test('pure renewal keeps retrying; shrink of target set cancels; resubscribe same target is a new identity', async (t) => {
  resetAlarmInternals()
  const bench = await setupWatchBench(t)
  const { home, cwd } = bench
  let calls = 0
  /** @type {any[]} */
  const timers = []
  setAlarmNotifyTestHooks({
    notify: async () => {
      calls += 1
      return { ok: false, error: 'down' }
    },
  })
  setAlarmNotifyRetryTestHooks({
    clock: () => 20_000,
    setTimer: (fn) => {
      timers.push(fn)
      return fn
    },
    clearTimer: () => {},
  })
  const first = setAgentAlarmWatch(cwd, {
    followup: true,
    sessionId: 'sess-a',
    pointIds: ['p1', 'p2'],
    connectionId: '',
    ttlMs: 60_000,
  })
  const point = loadWorkspace(home, cwd).modbus.points.find((p) => p.id === 'p1')
  const item = { point, kind: 'max', raw: 99, at: 2, eventId: 'renew-evt' }
  await emitCommittedAlarmTransitions(home, cwd, { fired: [{ ...item }] })
  assert.equal(calls, 1)

  // Pure renewal → same identity → retry still authorized.
  const renewed = setAgentAlarmWatch(cwd, {
    followup: true,
    sessionId: 'sess-a',
    pointIds: ['p2', 'p1'],
    connectionId: '',
    ttlMs: 90_000,
  })
  assert.equal(renewed.subscriptionId, first.subscriptionId)
  await timers[timers.length - 1]()
  assert.equal(calls, 2, 'pure renewal must keep retrying')

  // Shrink target set away from p1 → new identity → old task dies.
  setAgentAlarmWatch(cwd, {
    followup: true,
    sessionId: 'sess-a',
    pointIds: ['p2'],
    connectionId: 'c2',
    ttlMs: 60_000,
  })
  const remaining = timers.slice(-1)
  if (remaining.length) await remaining[0]()
  assert.equal(calls, 2, 'shrunk target must not deliver old p1 event')

  // Revoke then resubscribe same targets → new identity, old tasks stay dead.
  revokeAgentAlarmSubscription(cwd, 'sess-a')
  const again = setAgentAlarmWatch(cwd, {
    followup: true,
    sessionId: 'sess-a',
    pointIds: ['p1', 'p2'],
    connectionId: '',
    ttlMs: 60_000,
  })
  assert.notEqual(again.subscriptionId, first.subscriptionId)
  const still = timers.slice(-1)
  if (still.length) await still[0]()
  assert.equal(calls, 2)
})

test('another session is unaffected when one session retargets', async (t) => {
  resetAlarmInternals()
  const bench = await setupWatchBench(t)
  const { home, cwd } = bench
  /** @type {string[]} */
  const notified = []
  let failA = true
  setAlarmNotifyTestHooks({
    notify: async (_h, _c, _s, _d, opts) => {
      const sid = String(opts?.sessionId || '')
      if (sid === 'sess-a' && failA) return { ok: false, error: 'down' }
      notified.push(sid)
      return { ok: true }
    },
  })
  /** @type {any[]} */
  const timers = []
  setAlarmNotifyRetryTestHooks({
    clock: () => 30_000,
    setTimer: (fn) => {
      timers.push(fn)
      return fn
    },
    clearTimer: () => {},
  })
  setAgentAlarmWatch(cwd, { followup: true, sessionId: 'sess-a', pointIds: ['p1'], connectionId: 'c1' })
  setAgentAlarmWatch(cwd, { followup: true, sessionId: 'sess-b', pointIds: ['p1'], connectionId: 'c1' })
  const point = loadWorkspace(home, cwd).modbus.points.find((p) => p.id === 'p1')
  const item = { point, kind: 'max', raw: 99, at: 3, eventId: 'iso-evt' }
  await emitCommittedAlarmTransitions(home, cwd, { fired: [item] })
  // sess-b succeeded; sess-a queued.
  assert.deepEqual(notified, ['sess-b'])
  setAgentAlarmWatch(cwd, { followup: true, sessionId: 'sess-a', pointIds: ['p2'], connectionId: 'c2' })
  failA = false
  for (const fn of timers) await fn()
  assert.deepEqual(notified, ['sess-b'], 'retargeted session must not get the old event; other session already done')
})

test('focus/command auth retries without requiring a watch; dies with the original request', async (t) => {
  resetAlarmInternals()
  const bench = await createBench(t, { prefix: 'dvb-focus-auth-' })
  const { home, cwd } = bench
  let calls = 0
  /** @type {any[]} */
  const timers = []
  setAlarmNotifyTestHooks({
    notify: async () => {
      calls += 1
      return { ok: false, error: 'down' }
    },
  })
  setAlarmNotifyRetryTestHooks({
    clock: () => 40_000,
    setTimer: (fn) => {
      timers.push(fn)
      return fn
    },
    clearTimer: () => {},
  })
  saveWorkspace(home, cwd, {
    session: { boundId: 'sess-a' },
    focus: {
      sessionId: 'sess-a',
      request: { by: 'agent', pointId: 'p1', kind: 'alarm' },
    },
    modbus: {
      version: 3,
      connections: [rtuSim('c1', 'COM3')],
      devices: [device('d1', 'c1', 1)],
      points: [hrPoint('p1', 'c1', 'd1', 0, { alarmEnabled: true, alarmMax: 50, monitorEnabled: true })],
      alarmState: { p1: { condition: 'active', pointId: 'p1', group: 'process', connectionId: 'c1' } },
    },
  })
  const point = loadWorkspace(home, cwd).modbus.points[0]
  const item = { point, kind: 'max', raw: 99, at: 4, eventId: 'focus-evt' }
  const ran = await emitCommittedAlarmTransitions(home, cwd, { fired: [item] })
  assert.equal(ran.queued, 1)
  assert.equal(calls, 1)
  // Focus still valid → retry (even though there is no watch).
  await timers[0]()
  assert.equal(calls, 2)
  // Clear focus → further retries must stop.
  saveWorkspace(home, cwd, { focus: { sessionId: 'sess-a', request: null } })
  if (timers[1]) await timers[1]()
  const after = calls
  if (timers[2]) await timers[2]()
  assert.equal(calls, after, 'no send after focus is gone')
})

test('recipientStillAuthorized rejects a different subscriptionId on the same session', async (t) => {
  resetAlarmInternals()
  const bench = await setupWatchBench(t)
  const { home, cwd } = bench
  const sub = setAgentAlarmWatch(cwd, {
    followup: true,
    sessionId: 'sess-a',
    pointIds: ['p1'],
    connectionId: 'c1',
  })
  const item = {
    point: { id: 'p1', connectionId: 'c1', alarmMax: 50 },
    kind: 'max',
    eventId: 'x',
  }
  const ok = recipientStillAuthorized(home, cwd, item, {
    sessionId: 'sess-a',
    reason: 'agent-watch',
    explicitWatch: true,
    subscriptionId: sub.subscriptionId,
  })
  assert.equal(ok, true)
  const stale = recipientStillAuthorized(home, cwd, item, {
    sessionId: 'sess-a',
    reason: 'agent-watch',
    explicitWatch: true,
    subscriptionId: 'sub-gone',
  })
  assert.equal(stale, false)
  assert.equal(typeof recheckAlarmCurrent, 'function')
  assert.equal(getAgentAlarmWatch(cwd, 'sess-a')?.subscriptionId, sub.subscriptionId)
})
