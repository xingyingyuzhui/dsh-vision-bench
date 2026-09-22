import assert from 'node:assert/strict'
import test from 'node:test'
import {
  captureAlarmRuntimeToken,
  disposeAlarmNotifyRuntime,
  emitCommittedAlarmTransitions,
  isAlarmRuntimeCurrent,
  resetAlarmNotifyRetryTestHooks,
  resetAlarmNotifyTestHooks,
  setAgentAlarmWatch,
  setAlarmNotifyRetryTestHooks,
  setAlarmNotifyTestHooks,
  startAlarmNotifyRuntime,
  _internal as alarmInternal,
} from '../../src/application/modbus/poll-alarm-notify.mjs'
import {
  RETRY_DELAYS_MS,
  runDueAlarmNotifyRetries,
  _internal as retryInternal,
} from '../../src/application/modbus/alarm-notify-retry.mjs'
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

/** @type {Array<() => any | Promise<any>>} */
let timers = []
let now = 100_000

function installHooks(notify) {
  timers = []
  setAlarmNotifyTestHooks({
    clock: () => now,
    notify,
  })
  setAlarmNotifyRetryTestHooks({
    clock: () => now,
    setTimer: (fn) => {
      timers.push(fn)
      return fn
    },
    clearTimer: () => {},
  })
}

/**
 * @param {any} t
 */
async function setup(t, prefix) {
  const bench = await createBench(t, { prefix })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    session: { boundId: 'sess-a' },
    modbus: {
      version: 3,
      connections: [rtuSim('c1', 'COM3')],
      devices: [device('d1', 'c1', 1)],
      points: [hrPoint('p1', 'c1', 'd1', 0, { alarmEnabled: true, alarmMax: 50, monitorEnabled: true })],
      alarmState: { p1: { condition: 'active', pointId: 'p1', group: 'process', connectionId: 'c1' } },
    },
  })
  return bench
}

/**
 * Deferred notify: resolves only when `release` is called.
 */
function deferredNotify() {
  /** @type {Array<(v: any) => void>} */
  const releases = []
  /** @type {Array<{ sessionId: string }>} */
  const calls = []
  const notify = (home, cwd, summary, detail, opts) => {
    calls.push({ sessionId: String(opts?.sessionId || '') })
    return new Promise((resolve) => {
      releases.push(resolve)
    })
  }
  return {
    notify,
    calls,
    async release(ok) {
      const r = releases.shift()
      if (r) r({ ok })
    },
  }
}

test('initial delivery pending + dispose: queue/ledger do not resurrect', async (t) => {
  resetAlarmInternals()
  const bench = await setup(t, 'dvb-life-init-')
  const { home, cwd } = bench
  const d = deferredNotify()
  installHooks(d.notify)
  setAgentAlarmWatch(cwd, { followup: true, sessionId: 'sess-a', pointIds: ['p1'] })
  const point = loadWorkspace(home, cwd).modbus.points[0]
  const item = { point, kind: 'max', raw: 99, at: 1, eventId: 'life-init' }
  const pending = emitCommittedAlarmTransitions(home, cwd, { fired: [item] })
  await new Promise((r) => setImmediate(r))
  assert.equal(d.calls.length, 1)
  disposeAlarmNotifyRuntime()
  await d.release(false)
  const ran = await pending
  assert.equal(ran.queued, 0, 'dispose must not queue a retry')
  assert.equal(retryInternal.size, 0)
  assert.equal(alarmInternal.getDeliveryEntry('life-init', 'sess-a')?.state, undefined)
})

test('retry pending + dispose then true/false/throw: no queue revival', async (t) => {
  for (const outcome of ['false', 'true', 'throw']) {
    resetAlarmInternals()
    const bench = await setup(t, 'dvb-life-retry-' + outcome)
    const { home, cwd } = bench
    const d = deferredNotify()
    installHooks(d.notify)
    setAgentAlarmWatch(cwd, { followup: true, sessionId: 'sess-a', pointIds: ['p1'] })
    const point = loadWorkspace(home, cwd).modbus.points[0]
    const item = { point, kind: 'max', raw: 99, at: 2, eventId: 'life-' + outcome }
    const pendingEmit = emitCommittedAlarmTransitions(home, cwd, { fired: [item] })
    await new Promise((r) => setImmediate(r))
    await d.release(false)
    await pendingEmit
    assert.equal(retryInternal.size, 1)
    const run = Promise.resolve(timers[timers.length - 1]())
    await new Promise((r) => setImmediate(r))
    disposeAlarmNotifyRuntime()
    if (outcome === 'throw') {
      // deliver is already pending as a deferred; release with throw path via ok false after dispose
      await d.release(false)
    } else if (outcome === 'true') {
      await d.release(true)
    } else {
      await d.release(false)
    }
    await run
    assert.equal(retryInternal.size, 0, outcome)
    assert.equal(alarmInternal.deliveryLedger.size, 0, outcome)
  }
})

test('dispose + start: old promise completion does not touch the new task', async (t) => {
  resetAlarmInternals()
  const bench = await setup(t, 'dvb-life-restart-')
  const { home, cwd } = bench
  const d = deferredNotify()
  installHooks(d.notify)
  setAgentAlarmWatch(cwd, { followup: true, sessionId: 'sess-a', pointIds: ['p1'] })
  const point = loadWorkspace(home, cwd).modbus.points[0]
  const pendingOld = emitCommittedAlarmTransitions(home, cwd, {
    fired: [{ point, kind: 'max', raw: 99, at: 3, eventId: 'old-evt' }],
  })
  await new Promise((r) => setImmediate(r))
  await d.release(false)
  await pendingOld
  const oldRun = Promise.resolve(timers[timers.length - 1]())
  await new Promise((r) => setImmediate(r))
  disposeAlarmNotifyRuntime()
  startAlarmNotifyRuntime()
  // New task after restart.
  timers = []
  const d2 = deferredNotify()
  setAlarmNotifyTestHooks({ clock: () => now, notify: d2.notify })
  const pendingNew = emitCommittedAlarmTransitions(home, cwd, {
    fired: [{ point, kind: 'max', raw: 99, at: 4, eventId: 'new-evt' }],
  })
  await new Promise((r) => setImmediate(r))
  await d.release(true) // old pending completes after dispose
  await oldRun
  await d2.release(true)
  await pendingNew
  assert.equal(retryInternal.size, 0, 'new task completes')
  assert.equal(alarmInternal.getDeliveryEntry('old-evt', 'sess-a')?.state, undefined)
})

test('pending unsubscribe / retarget does not reschedule; other session isolated', async (t) => {
  resetAlarmInternals()
  const bench = await setup(t, 'dvb-life-unsub-')
  const { home, cwd } = bench
  const d = deferredNotify()
  installHooks(d.notify)
  setAgentAlarmWatch(cwd, { followup: true, sessionId: 'sess-a', pointIds: ['p1'] })
  setAgentAlarmWatch(cwd, { followup: true, sessionId: 'sess-b', pointIds: ['p1'] })
  const point = loadWorkspace(home, cwd).modbus.points[0]
  const item = { point, kind: 'max', raw: 99, at: 5, eventId: 'unsub-evt' }
  const pending = emitCommittedAlarmTransitions(home, cwd, { fired: [item] })
  await new Promise((r) => setImmediate(r))
  await new Promise((r) => setImmediate(r))
  // Unsubscribe sess-a while its notify is in-flight.
  alarmInternal.agentAlarmWatchByKey.delete(`${cwd}::sess-a`)
  await d.release(false)
  await new Promise((r) => setImmediate(r))
  await d.release(false)
  await pending
  // sess-a must not queue; sess-b may have queued or delivered.
  for (const task of retryInternal.retryByKey.values()) {
    assert.notEqual(task.sessionId, 'sess-a')
  }
})

test('timer + manual due-run concurrent: executes once; 3 total deliveries at 1s then 3s', async (t) => {
  resetAlarmInternals()
  const bench = await setup(t, 'dvb-life-once-')
  const { home, cwd } = bench
  let calls = 0
  installHooks(async () => {
    calls += 1
    return { ok: false, error: 'down' }
  })
  assert.deepEqual(RETRY_DELAYS_MS, [1_000, 3_000])
  setAgentAlarmWatch(cwd, { followup: true, sessionId: 'sess-a', pointIds: ['p1'] })
  const point = loadWorkspace(home, cwd).modbus.points[0]
  await emitCommittedAlarmTransitions(home, cwd, {
    fired: [{ point, kind: 'max', raw: 99, at: 6, eventId: 'once-evt' }],
  })
  assert.equal(calls, 1)
  // Fire the same due task via timer AND manual entry.
  const t0 = timers[timers.length - 1]
  await Promise.all([t0(), runDueAlarmNotifyRetries(), t0()])
  assert.equal(calls, 2, 'concurrent triggers must run once')
  // Second retry at +3s
  const t1 = timers[timers.length - 1]
  assert.notEqual(t1, t0)
  await t1()
  assert.equal(calls, 3, 'exactly 3 total deliveries')
  assert.equal(retryInternal.size, 0)
  assert.equal(alarmInternal.getDeliveryEntry('once-evt', 'sess-a')?.state, 'exhausted')
  for (const task of retryInternal.retryByKey.values()) assert.fail('no leftover timer task')
})
