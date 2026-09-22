import assert from 'node:assert/strict'
import test from 'node:test'
import {
  disposeAlarmNotifyRuntime,
  emitCommittedAlarmTransitions,
  recipientStillAuthorized,
  resetAlarmNotifyRetryTestHooks,
  resetAlarmNotifyTestHooks,
  setAlarmNotifyRetryTestHooks,
  setAlarmNotifyTestHooks,
  startAlarmNotifyRuntime,
  _internal as alarmInternal,
} from '../../src/application/modbus/poll-alarm-notify.mjs'
import {
  focusAuthorizationId,
  focusRecipientSession,
} from '../../src/application/modbus/alarm-notify-match.mjs'
import { runDueAlarmNotifyRetries, _internal as retryInternal } from '../../src/application/modbus/alarm-notify-retry.mjs'
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
 * @param {any} focus
 */
async function setupFocusBench(t, focus) {
  const bench = await createBench(t, { prefix: 'dvb-focus-id-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    session: { boundId: 'sess-a' },
    focus,
    modbus: {
      version: 3,
      connections: [rtuSim('c1', 'COM3'), rtuSim('c2', 'COM4')],
      devices: [device('d1', 'c1', 1), device('d2', 'c2', 2)],
      points: [
        hrPoint('p1', 'c1', 'd1', 0, { alarmEnabled: true, alarmMax: 50, monitorEnabled: true }),
        hrPoint('p1b', 'c2', 'd2', 5, { alarmEnabled: true, alarmMax: 50, monitorEnabled: true }),
      ],
      alarmState: {
        p1: { condition: 'active', pointId: 'p1', group: 'process', connectionId: 'c1' },
      },
    },
  })
  return bench
}

test('focus retry dies when focus moves to another session with the same point', async (t) => {
  resetAlarmInternals()
  const bench = await setupFocusBench(t, {
    sessionId: 'sess-a',
    request: { by: 'agent', pointId: 'p1', kind: 'alarm', at: 100, version: 1 },
  })
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
    clock: () => 50_000,
    setTimer: (fn) => {
      timers.push(fn)
      return fn
    },
    clearTimer: () => {},
  })
  const point = loadWorkspace(home, cwd).modbus.points.find((p) => p.id === 'p1')
  const item = { point, kind: 'max', raw: 99, at: 1, eventId: 'focus-move' }
  const pending = emitCommittedAlarmTransitions(home, cwd, { fired: [item] })
  await new Promise((r) => setImmediate(r))
  await pending
  assert.equal(calls, 1)
  assert.equal(retryInternal.size, 1)
  // Move focus to sess-b, same point.
  saveWorkspace(home, cwd, {
    focus: {
      sessionId: 'sess-b',
      request: { by: 'agent', pointId: 'p1', kind: 'alarm', at: 100, version: 1 },
    },
  })
  await timers[timers.length - 1]()
  assert.equal(calls, 1, 'old session focus auth must not keep retrying')
})

test('new at/version is a new identity; user focus / cleared focus stop retries', async (t) => {
  resetAlarmInternals()
  const bench = await setupFocusBench(t, {
    sessionId: 'sess-a',
    request: { by: 'agent', pointId: 'p1', kind: 'alarm', at: 100, version: 1 },
  })
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
    clock: () => 60_000,
    setTimer: (fn) => {
      timers.push(fn)
      return fn
    },
    clearTimer: () => {},
  })
  const point = loadWorkspace(home, cwd).modbus.points.find((p) => p.id === 'p1')
  await emitCommittedAlarmTransitions(home, cwd, {
    fired: [{ point, kind: 'max', raw: 99, at: 2, eventId: 'focus-ver' }],
  })
  assert.equal(calls, 1)
  // Same request (same at/version) → retry allowed
  await timers[timers.length - 1]()
  assert.equal(calls, 2, 'identical request identity keeps retrying')
  // New at → new identity → old task dies
  saveWorkspace(home, cwd, {
    focus: {
      sessionId: 'sess-a',
      request: { by: 'agent', pointId: 'p1', kind: 'alarm', at: 200, version: 1 },
    },
  })
  if (timers[timers.length - 1]) await timers[timers.length - 1]()
  const afterNewAt = calls
  if (timers[timers.length - 1]) await timers[timers.length - 1]()
  assert.equal(calls, afterNewAt, 'new request.at revokes old auth')
  // User focus stops agent-focus retries
  saveWorkspace(home, cwd, {
    focus: {
      sessionId: 'sess-a',
      request: { by: 'user', pointId: 'p1', at: 300, version: 2 },
    },
  })
  const item = {
    point: loadWorkspace(home, cwd).modbus.points.find((p) => p.id === 'p1'),
    kind: 'max',
    eventId: 'x',
  }
  assert.equal(
    recipientStillAuthorized(home, cwd, item, {
      sessionId: 'sess-a',
      reason: 'agent-focus',
      authId: 'stale',
    }),
    false,
  )
})

test('explicit focus.sessionId survives boundId change; boundId fallback dies on switch', async (t) => {
  resetAlarmInternals()
  const bench = await setupFocusBench(t, {
    sessionId: 'sess-x',
    request: { by: 'agent', pointId: 'p1', kind: 'alarm', at: 1, version: 1 },
  })
  const { home, cwd } = bench
  assert.equal(focusRecipientSession(loadWorkspace(home, cwd)), 'sess-x')
  saveWorkspace(home, cwd, { session: { boundId: 'sess-y' } })
  assert.equal(focusRecipientSession(loadWorkspace(home, cwd)), 'sess-x')

  // No explicit focus session → boundId is the identity base
  saveWorkspace(home, cwd, {
    session: { boundId: 'sess-a' },
    focus: { request: { by: 'agent', pointId: 'p1', kind: 'alarm', at: 5, version: 1 } },
  })
  const ws = loadWorkspace(home, cwd)
  assert.equal(focusRecipientSession(ws), 'sess-a')
  const authA = focusAuthorizationId(ws.focus, 'sess-a')
  saveWorkspace(home, cwd, { session: { boundId: 'sess-b' }, focus: ws.focus })
  const authB = focusAuthorizationId(loadWorkspace(home, cwd).focus, focusRecipientSession(loadWorkspace(home, cwd)))
  assert.notEqual(authA, authB)
})

test('connection/device change with same pointId revokes focus auth; emit→retry path uses real counts', async (t) => {
  resetAlarmInternals()
  const bench = await setupFocusBench(t, {
    sessionId: 'sess-a',
    request: {
      by: 'agent',
      pointId: 'p1',
      connectionId: 'c1',
      deviceId: 'd1',
      kind: 'alarm',
      at: 9,
      version: 1,
    },
  })
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
    clock: () => 70_000,
    setTimer: (fn) => {
      timers.push(fn)
      return fn
    },
    clearTimer: () => {},
  })
  const point = loadWorkspace(home, cwd).modbus.points.find((p) => p.id === 'p1')
  await emitCommittedAlarmTransitions(home, cwd, {
    fired: [{ point, kind: 'max', raw: 99, at: 3, eventId: 'focus-conn' }],
  })
  assert.equal(calls, 1)
  // Same pointId but focus now targets c2
  saveWorkspace(home, cwd, {
    focus: {
      sessionId: 'sess-a',
      request: {
        by: 'agent',
        pointId: 'p1',
        connectionId: 'c2',
        deviceId: 'd2',
        kind: 'alarm',
        at: 9,
        version: 1,
      },
    },
  })
  await timers[timers.length - 1]()
  assert.equal(calls, 1, 'connection change must revoke old focus auth')
  await runDueAlarmNotifyRetries()
  assert.equal(calls, 1)
  assert.equal(alarmInternal.getDeliveryEntry('focus-conn', 'sess-a')?.state, 'exhausted')
})
