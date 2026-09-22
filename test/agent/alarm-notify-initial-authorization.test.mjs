import assert from 'node:assert/strict'
import test from 'node:test'
import {
  disposeAlarmNotifyRuntime,
  emitCommittedAlarmTransitions,
  resetAlarmNotifyRetryTestHooks,
  resetAlarmNotifyTestHooks,
  setAgentAlarmWatch,
  setAlarmNotifyRetryTestHooks,
  setAlarmNotifyTestHooks,
  startAlarmNotifyRuntime,
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
async function setupShared(t) {
  const bench = await createBench(t, { prefix: 'dvb-init-auth-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    session: { boundId: 'sess-a' },
    modbus: {
      version: 3,
      share: { enabled: true, connections: true, points: true, visualization: false },
      connections: [rtuSim('c1', 'COM3')],
      devices: [device('d1', 'c1', 1)],
      points: [hrPoint('p1', 'c1', 'd1', 0, { alarmEnabled: true, alarmMax: 50, monitorEnabled: true })],
      alarmState: { p1: { condition: 'active', pointId: 'p1', group: 'process', connectionId: 'c1' } },
      sessionConfigs: {
        'sess-a': { connections: [], devices: [], points: [] },
        'sess-b': { connections: [], devices: [], points: [] },
      },
    },
  })
  return bench
}

test('A pending while B unsubscribes: B never gets a first send or retry', async (t) => {
  resetAlarmInternals()
  const bench = await setupShared(t)
  const { home, cwd } = bench
  /** @type {string[]} */
  const calls = []
  /** @type {Array<(v: any) => void>} */
  const releases = []
  setAlarmNotifyTestHooks({
    notify: async (_h, _c, _s, _d, opts) => {
      calls.push(String(opts?.sessionId || ''))
      return new Promise((resolve) => releases.push(resolve))
    },
  })
  /** @type {any[]} */
  const timers = []
  setAlarmNotifyRetryTestHooks({
    clock: () => 80_000,
    setTimer: (fn) => {
      timers.push(fn)
      return fn
    },
    clearTimer: () => {},
  })
  setAgentAlarmWatch(cwd, { followup: true, sessionId: 'sess-a', pointIds: ['p1'] })
  setAgentAlarmWatch(cwd, { followup: true, sessionId: 'sess-b', pointIds: ['p1'] })
  const point = loadWorkspace(home, cwd).modbus.points[0]
  const item = { point, kind: 'max', raw: 99, at: 1, eventId: 'init-auth' }
  const pending = emitCommittedAlarmTransitions(home, cwd, { fired: [item] })
  await new Promise((r) => setImmediate(r))
  // First recipient in-flight; second not yet claimed.
  assert.equal(calls.length, 1)
  // B unsubscribes while A is pending.
  const { revokeAgentAlarmSubscription } = await import(
    '../../src/application/modbus/poll-alarm-notify.mjs'
  )
  revokeAgentAlarmSubscription(cwd, 'sess-b')
  await (releases.shift())?.({ ok: true })
  await new Promise((r) => setImmediate(r))
  // If a second send was started, release it too.
  while (releases.length) {
    await (releases.shift())?.({ ok: true })
    await new Promise((r) => setImmediate(r))
  }
  await pending
  assert.deepEqual(calls, ['sess-a'], `calls=${JSON.stringify(calls)}`)
  assert.equal(alarmInternal.getDeliveryEntry('init-auth', 'sess-b'), null)
})

test('B retarget / TTL expiry / resubscribe same target: old recipient is not sent', async (t) => {
  resetAlarmInternals()
  const bench = await setupShared(t)
  const { home, cwd } = bench
  /** @type {string[]} */
  const calls = []
  setAlarmNotifyTestHooks({
    notify: async (_h, _c, _s, _d, opts) => {
      calls.push(String(opts?.sessionId || ''))
      return { ok: true }
    },
  })
  // TTL path
  setAgentAlarmWatch(cwd, { followup: true, sessionId: 'sess-a', pointIds: ['p1'] })
  setAgentAlarmWatch(cwd, { followup: true, sessionId: 'sess-b', pointIds: ['p1'], ttlMs: 1 })
  await new Promise((r) => setTimeout(r, 5))
  const point = loadWorkspace(home, cwd).modbus.points[0]
  const item = { point, kind: 'max', raw: 99, at: 2, eventId: 'init-ttl' }
  await emitCommittedAlarmTransitions(home, cwd, { fired: [item] })
  assert.deepEqual(calls, ['sess-a'])

  // Retarget / resubscribe
  calls.length = 0
  setAgentAlarmWatch(cwd, { followup: true, sessionId: 'sess-b', pointIds: ['p2'], connectionId: 'c2' })
  await emitCommittedAlarmTransitions(home, cwd, { fired: [{ ...item, eventId: 'init-re' }] })
  assert.deepEqual(calls, ['sess-a'], 'retargeted b does not receive p1')
})

test('pure renewal still delivers once; A self-unsub mid-flight can record success but not retry on failure', async (t) => {
  resetAlarmInternals()
  const bench = await setupShared(t)
  const { home, cwd } = bench
  let mode = 'ok'
  /** @type {string[]} */
  const calls = []
  /** @type {Array<(v: any) => void>} */
  const releases = []
  setAlarmNotifyTestHooks({
    notify: async (_h, _c, _s, _d, opts) => {
      calls.push(String(opts?.sessionId || ''))
      if (mode === 'defer') return new Promise((resolve) => releases.push(resolve))
      return { ok: mode === 'ok' }
    },
  })
  setAgentAlarmWatch(cwd, { followup: true, sessionId: 'sess-a', pointIds: ['p1'] })
  const point = loadWorkspace(home, cwd).modbus.points[0]
  // Pure renewal
  setAgentAlarmWatch(cwd, { followup: true, sessionId: 'sess-a', pointIds: ['p1'], ttlMs: 120_000 })
  await emitCommittedAlarmTransitions(home, cwd, {
    fired: [{ point, kind: 'max', raw: 99, at: 3, eventId: 'init-renew' }],
  })
  assert.deepEqual(calls, ['sess-a'])

  // A unsubscribes while its own notify is in-flight and fails → no retry
  calls.length = 0
  mode = 'defer'
  const { revokeAgentAlarmSubscription } = await import(
    '../../src/application/modbus/poll-alarm-notify.mjs'
  )
  const pending = emitCommittedAlarmTransitions(home, cwd, {
    fired: [{ point, kind: 'max', raw: 99, at: 4, eventId: 'init-unsub' }],
  })
  await new Promise((r) => setImmediate(r))
  revokeAgentAlarmSubscription(cwd, 'sess-a')
  await releases[0]({ ok: false })
  await pending
  assert.equal(alarmInternal.getDeliveryEntry('init-unsub', 'sess-a')?.state, 'exhausted')
})
