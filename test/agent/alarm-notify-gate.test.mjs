import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearAgentAlarmWatch,
  disposeAlarmNotifyRuntime,
  emitCommittedAlarmTransitions,
  matchingAlarmRecipients,
  recheckAlarmCurrent,
  resetAlarmNotifyRetryTestHooks,
  resetAlarmNotifyTestHooks,
  setAgentAlarmWatch,
  setAlarmNotifyRetryTestHooks,
  setAlarmNotifyTestHooks,
  shouldNotifyAgentOfProcessAlarm,
  _internal as alarmInternal,
} from '../../src/application/modbus/poll-alarm-notify.mjs'
import { commitPollResult, stampAlarmTransitionIdentity } from '../../bench-modbus-commit.mjs'
import { evaluateAlarms } from '../../src/domain/modbus/alarm-model.mjs'
import { setAgentsRegistry } from '../../bench-notify.mjs'
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { createBench } from '../helpers/workspace-factory.mjs'
import { device, hrPoint, rtuSim } from '../hmi/multi-conn-fixtures.mjs'

function resetAlarmInternals() {
  resetAlarmNotifyTestHooks()
  resetAlarmNotifyRetryTestHooks()
  disposeAlarmNotifyRuntime()
  alarmInternal.deliveryLedger.clear()
  alarmInternal.agentAlarmWatchByKey.clear()
}

test('process alarms record journal but do not followup Agent by default', async (t) => {
  resetAlarmInternals()
  const bench = await createBench(t, { prefix: 'dvb-alarm-gate-' })
  const { home, cwd } = bench
  const followups = []
  setAgentsRegistry({
    get(id) {
      if (id !== 'sess-a') return null
      return {
        followup(msg) {
          followups.push(msg)
        },
      }
    },
  })
  saveWorkspace(home, cwd, {
    session: { boundId: 'sess-a' },
    modbus: {
      version: 3,
      connections: [rtuSim('c1', 'COM3')],
      devices: [device('d1', 'c1', 1)],
      points: [hrPoint('p1', 'c1', 'd1', 0, { alarmEnabled: true, alarmMax: 50, monitorEnabled: true })],
      alarmState: { p1: { condition: 'active', pointId: 'p1', group: 'process' } },
    },
  })
  clearAgentAlarmWatch(cwd)
  const point = loadWorkspace(home, cwd).modbus.points[0]
  const ran = await emitCommittedAlarmTransitions(home, cwd, {
    fired: [{ point, kind: 'max', raw: 90, at: Date.now() }],
    recovered: [],
  })
  assert.equal(ran.recorded >= 1, true)
  assert.equal(ran.notified, 0)
  assert.equal(followups.length, 0)
  assert.equal(shouldNotifyAgentOfProcessAlarm(home, cwd, { point, kind: 'max' }).shouldNotify, false)
})

test('explicit agent watch notifies once with eventId metadata; deleted point is historical', async (t) => {
  resetAlarmInternals()
  const bench = await createBench(t, { prefix: 'dvb-alarm-watch-' })
  const { home, cwd } = bench
  const followups = []
  setAgentsRegistry({
    get() {
      return {
        followup(msg) {
          followups.push(msg)
        },
      }
    },
  })
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
  setAgentAlarmWatch(cwd, { followup: true, sessionId: 'sess-a', pointIds: ['p1'] })
  const point = loadWorkspace(home, cwd).modbus.points[0]
  const first = await emitCommittedAlarmTransitions(home, cwd, {
    fired: [{ point, kind: 'max', raw: 99, at: 1000, eventId: 'evt-1' }],
  })
  assert.equal(first.notified, 1)
  assert.equal(followups.length, 1)
  assert.match(String(followups[0]?.content?.[0]?.text || ''), /eventId/)

  const again = await emitCommittedAlarmTransitions(home, cwd, {
    fired: [{ point, kind: 'max', raw: 99, at: 1000, eventId: 'evt-1' }],
  })
  assert.equal(again.notified, 0, 'idempotent by eventId')

  saveWorkspace(home, cwd, {
    modbus: {
      ...loadWorkspace(home, cwd).modbus,
      points: [],
      alarmState: {},
    },
  })
  const live = recheckAlarmCurrent(home, cwd, { point, kind: 'max', eventId: 'evt-2' }, 'sess-a')
  assert.equal(live.current, false)
  assert.equal(live.historical, true)
  const afterDelete = await emitCommittedAlarmTransitions(home, cwd, {
    fired: [{ point, kind: 'max', raw: 99, at: 2000, eventId: 'evt-2' }],
  })
  assert.equal(afterDelete.notified, 0, 'deleted/cleared alarms must not wake Agent as current faults')
  clearAgentAlarmWatch(cwd)
})

test('session-scoped watch: other session/connection receives zero; two independent events notify twice', async (t) => {
  resetAlarmInternals()
  let now = 1_000_000
  /** @type {string[]} */
  const notifiedSessions = []
  setAlarmNotifyTestHooks({
    clock: () => now,
    notify: async (_h, _c, _summary, _detail, opts) => {
      notifiedSessions.push(String(opts?.sessionId || ''))
      return { ok: true }
    },
  })
  const bench = await createBench(t, { prefix: 'dvb-alarm-session-' })
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
  const sub = setAgentAlarmWatch(cwd, {
    followup: true,
    sessionId: 'sess-a',
    pointIds: ['p1'],
    connectionId: 'c1',
    ttlMs: 60_000,
  })
  assert.equal(sub?.sessionId, 'sess-a')
  assert.ok(sub && sub.expiresAt > sub.createdAt)

  const p1 = loadWorkspace(home, cwd).modbus.points.find((p) => p.id === 'p1')
  const p2 = loadWorkspace(home, cwd).modbus.points.find((p) => p.id === 'p2')

  const a = await emitCommittedAlarmTransitions(home, cwd, {
    fired: [{ point: p1, kind: 'max', raw: 90, at: 1000, eventId: 'e-a' }],
  })
  assert.equal(a.notified, 1)
  assert.deepEqual(notifiedSessions, ['sess-a'])

  const b = await emitCommittedAlarmTransitions(home, cwd, {
    fired: [{ point: p2, kind: 'max', raw: 90, at: 1001, eventId: 'e-b' }],
  })
  assert.equal(b.notified, 0)

  const c = await emitCommittedAlarmTransitions(home, cwd, {
    fired: [{ point: p1, kind: 'max', raw: 91, at: 2000, eventId: 'e-c' }],
  })
  assert.equal(c.notified, 1)
  assert.deepEqual(notifiedSessions, ['sess-a', 'sess-a'])

  setAgentAlarmWatch(cwd, { followup: true, sessionId: 'sess-b', pointIds: ['p1'], connectionId: 'c1' })
  const gateB = shouldNotifyAgentOfProcessAlarm(home, cwd, { point: p1, kind: 'max', connectionId: 'c1' })
  assert.equal(gateB.sessionId, 'sess-a')
  void now
})

test('notify ok:false does not count; bounded retry can succeed; alarm.id is never preferred eventId', async (t) => {
  resetAlarmInternals()
  const bench = await createBench(t, { prefix: 'dvb-alarm-retry-' })
  const { home, cwd } = bench
  let calls = 0
  /** @type {any[]} */
  const timers = []
  setAlarmNotifyTestHooks({
    notify: async () => {
      calls += 1
      if (calls === 1) return { ok: false, error: 'down' }
      return { ok: true }
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
  setAgentAlarmWatch(cwd, { followup: true, sessionId: 'sess-a', pointIds: ['p1'] })
  const point = loadWorkspace(home, cwd).modbus.points[0]
  const item = {
    point,
    kind: 'max',
    raw: 99,
    at: 4242,
    alarm: { id: 'p1', eventId: undefined },
  }
  const meta = alarmInternal.alarmEventMeta(item, { cwd, sessionId: 'sess-a' })
  assert.notEqual(meta.eventId, 'p1', 'must never prefer alarm.id as eventId')
  assert.match(meta.eventId, /4242/)

  const first = await emitCommittedAlarmTransitions(home, cwd, { fired: [{ ...item, eventId: meta.eventId }] })
  assert.equal(first.notified, 0)
  assert.equal(first.queued, 1)
  assert.equal(calls, 1)
  assert.equal(alarmInternal.getDeliveryEntry(meta.eventId, 'sess-a')?.state, 'queued')

  // Injected timer: retry succeeds without a duplicate `fired`.
  assert.equal(timers.length, 1)
  await timers[0]()
  assert.equal(calls, 2)
  assert.equal(alarmInternal.getDeliveryEntry(meta.eventId, 'sess-a')?.state, 'delivered')

  const again = await emitCommittedAlarmTransitions(home, cwd, { fired: [{ ...item, eventId: meta.eventId }] })
  assert.equal(again.notified, 0, 'delivered stays idempotent')
  assert.equal(calls, 2)
})

test('two sessions on one shared point each receive exactly once; pending claim blocks double delivery', async (t) => {
  resetAlarmInternals()
  const bench = await createBench(t, { prefix: 'dvb-alarm-multi-' })
  const { home, cwd } = bench
  /** @type {string[]} */
  const notifiedSessions = []
  setAlarmNotifyTestHooks({
    notify: async (_h, _c, _s, _d, opts) => {
      notifiedSessions.push(String(opts?.sessionId || ''))
      return { ok: true }
    },
  })
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
  setAgentAlarmWatch(cwd, { followup: true, sessionId: 'sess-a', pointIds: ['p1'] })
  setAgentAlarmWatch(cwd, { followup: true, sessionId: 'sess-b', pointIds: ['p1'] })
  const point = loadWorkspace(home, cwd).modbus.points[0]
  const item = { point, kind: 'max', raw: 99, at: 1, eventId: 'shared-evt' }
  const match = matchingAlarmRecipients(home, cwd, item, undefined)
  assert.equal(match.recipients.length, 2)
  assert.deepEqual(
    match.recipients.map((r) => r.sessionId).sort(),
    ['sess-a', 'sess-b'],
  )

  const ran = await emitCommittedAlarmTransitions(home, cwd, { fired: [item] })
  assert.equal(ran.notified, 2)
  assert.deepEqual(notifiedSessions.sort(), ['sess-a', 'sess-b'])

  // Concurrent double emit: pending claim blocks a second delivery.
  alarmInternal.deliveryLedger.clear()
  notifiedSessions.length = 0
  const item2 = { ...item, eventId: 'shared-evt-2' }
  alarmInternal.beginDeliveryAttempt('shared-evt-2', 'sess-a')
  const blocked = await emitCommittedAlarmTransitions(home, cwd, { fired: [item2] })
  assert.equal(notifiedSessions.includes('sess-a'), false)
  assert.ok(blocked.notified <= 1)
})

test('sourceSessionId private event only reaches that session; ambiguous-owner blocks notify', async (t) => {
  resetAlarmInternals()
  const bench = await createBench(t, { prefix: 'dvb-alarm-src-' })
  const { home, cwd } = bench
  /** @type {string[]} */
  const notifiedSessions = []
  setAlarmNotifyTestHooks({
    notify: async (_h, _c, _s, _d, opts) => {
      notifiedSessions.push(String(opts?.sessionId || ''))
      return { ok: true }
    },
  })
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      share: { enabled: false, connections: false, points: false, visualization: false },
      connections: [],
      devices: [],
      points: [],
      alarmState: { p1: { condition: 'active', pointId: 'p1', group: 'process', connectionId: 'c1' } },
      sessionConfigs: {
        'sess-a': {
          connections: [rtuSim('c1', 'COM3')],
          devices: [device('d1', 'c1', 1)],
          points: [hrPoint('p1', 'c1', 'd1', 0, { alarmEnabled: true, alarmMax: 50, monitorEnabled: true })],
        },
        'sess-b': {
          connections: [rtuSim('c1', 'COM3')],
          devices: [device('d1', 'c1', 1)],
          points: [hrPoint('p1', 'c1', 'd1', 0, { alarmEnabled: true, alarmMax: 50, monitorEnabled: true })],
        },
      },
    },
  })
  setAgentAlarmWatch(cwd, { followup: true, sessionId: 'sess-a', pointIds: ['p1'], connectionId: 'c1' })
  setAgentAlarmWatch(cwd, { followup: true, sessionId: 'sess-b', pointIds: ['p1'], connectionId: 'c1' })
  const item = {
    point: { id: 'p1', connectionId: 'c1', deviceId: 'd1', alarmMax: 50 },
    kind: 'max',
    raw: 99,
    at: 2,
    eventId: 'priv-evt',
  }

  const ambiguous = matchingAlarmRecipients(home, cwd, item, undefined)
  assert.equal(ambiguous.ambiguousOwner, true)
  const blockedEmit = await emitCommittedAlarmTransitions(home, cwd, { fired: [item] })
  assert.equal(blockedEmit.ambiguousOwner, true)
  assert.equal(blockedEmit.notified, 0)
  assert.equal(notifiedSessions.length, 0)

  const scoped = matchingAlarmRecipients(home, cwd, item, 'sess-a')
  assert.equal(scoped.ambiguousOwner, false)
  assert.deepEqual(
    scoped.recipients.map((r) => r.sessionId),
    ['sess-a'],
  )
  const okEmit = await emitCommittedAlarmTransitions(
    home,
    cwd,
    { fired: [{ ...item, eventId: 'priv-evt-2' }] },
    { sourceSessionId: 'sess-a' },
  )
  assert.equal(okEmit.notified, 1)
  assert.deepEqual(notifiedSessions, ['sess-a'])
})

test('retry cancels when watch cleared before due; dispose clears queue', async (t) => {
  resetAlarmInternals()
  const bench = await createBench(t, { prefix: 'dvb-alarm-cancel-' })
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
  setAgentAlarmWatch(cwd, { followup: true, sessionId: 'sess-a', pointIds: ['p1'] })
  const point = loadWorkspace(home, cwd).modbus.points[0]
  const item = { point, kind: 'max', raw: 99, at: 9, eventId: 'cancel-evt' }
  const ran = await emitCommittedAlarmTransitions(home, cwd, { fired: [item] })
  assert.equal(ran.queued, 1)
  clearAgentAlarmWatch(cwd, 'sess-a')
  await timers[0]()
  assert.equal(calls, 1, 'retry must not fire after unsubscribe')
  disposeAlarmNotifyRuntime()
})

test('poll ownership: unique private owner inferred; multi private owners → ambiguous-owner', async () => {
  const bench = await createBench(null, { prefix: 'dvb-alarm-own-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      share: { enabled: false, connections: false, points: false, visualization: false },
      connections: [],
      devices: [],
      points: [],
      sessionConfigs: {
        'sess-a': { connections: [rtuSim('c1', 'COM3')], devices: [], points: [] },
        'sess-b': { connections: [rtuSim('c2', 'COM4')], devices: [], points: [] },
      },
    },
  })
  const { resolvePollSessionOwnership } = await import('../../src/application/modbus/polling-service.mjs')
  const unique = resolvePollSessionOwnership(loadWorkspace(home, cwd), { connectionId: 'c1' })
  assert.equal(unique.ok, true)
  assert.equal(unique.targetSessionId, 'sess-a')

  saveWorkspace(home, cwd, {
    modbus: {
      ...loadWorkspace(home, cwd).modbus,
      sessionConfigs: {
        'sess-a': { connections: [rtuSim('c1', 'COM3')], devices: [], points: [] },
        'sess-b': { connections: [rtuSim('c1', 'COM3')], devices: [], points: [] },
      },
    },
  })
  const amb = resolvePollSessionOwnership(loadWorkspace(home, cwd), { connectionId: 'c1' })
  assert.equal(amb.ok, false)
  assert.equal(amb.reason, 'ambiguous-owner')
  assert.deepEqual(amb.owners?.sort(), ['sess-a', 'sess-b'])

  const mismatch = resolvePollSessionOwnership(loadWorkspace(home, cwd), {
    sessionId: 'sess-a',
    connectionId: 'c9',
  })
  assert.equal(mismatch.ok, false)
})

test('module boundaries: match / retry / registry stay separable', async () => {
  const registry = await import('../../src/application/modbus/alarm-notify-registry.mjs')
  const match = await import('../../src/application/modbus/alarm-notify-match.mjs')
  const retry = await import('../../src/application/modbus/alarm-notify-retry.mjs')
  assert.equal(typeof registry.beginDeliveryAttempt, 'function')
  assert.equal(typeof match.matchingAlarmRecipients, 'function')
  assert.equal(typeof retry.enqueueAlarmNotifyRetry, 'function')
  assert.equal(typeof retry.clearAlarmNotifyRetryRuntime, 'function')
  const { readFileSync } = await import('node:fs')
  const regSrc = readFileSync(
    new URL('../../src/application/modbus/alarm-notify-registry.mjs', import.meta.url),
    'utf8',
  )
  assert.equal(/alarm-notify-retry|alarm-notify-match/.test(regSrc), false)
})

test('watch expiry and watch:false clear yield zero notifications', async (t) => {
  resetAlarmInternals()
  let now = 5_000
  let notifies = 0
  setAlarmNotifyTestHooks({
    clock: () => now,
    notify: async () => {
      notifies += 1
      return { ok: true }
    },
  })
  const bench = await createBench(t, { prefix: 'dvb-alarm-ttl-' })
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
  setAgentAlarmWatch(cwd, { followup: true, sessionId: 'sess-a', pointIds: ['p1'], ttlMs: 1000 })
  const point = loadWorkspace(home, cwd).modbus.points[0]
  now = 5_000 + 2_000
  const expired = await emitCommittedAlarmTransitions(home, cwd, {
    fired: [{ point, kind: 'max', raw: 99, at: 3000, eventId: 'ttl-1' }],
  })
  assert.equal(expired.notified, 0)
  assert.equal(notifies, 0)

  setAgentAlarmWatch(cwd, { followup: true, sessionId: 'sess-a', pointIds: ['p1'], ttlMs: 60_000 })
  clearAgentAlarmWatch(cwd, 'sess-a')
  const cleared = await emitCommittedAlarmTransitions(home, cwd, {
    fired: [{ point, kind: 'max', raw: 99, at: 4000, eventId: 'ttl-2' }],
  })
  assert.equal(cleared.notified, 0)
})

test('cleared alarm (condition recovered) is historical — zero current notify', async (t) => {
  resetAlarmInternals()
  const bench = await createBench(t, { prefix: 'dvb-alarm-clear-' })
  const { home, cwd } = bench
  setAlarmNotifyTestHooks({ notify: async () => ({ ok: true }) })
  saveWorkspace(home, cwd, {
    session: { boundId: 'sess-a' },
    modbus: {
      version: 3,
      connections: [rtuSim('c1', 'COM3')],
      devices: [device('d1', 'c1', 1)],
      points: [hrPoint('p1', 'c1', 'd1', 0, { alarmEnabled: true, alarmMax: 50, monitorEnabled: true })],
      alarmState: { p1: { condition: 'recovered', pointId: 'p1', group: 'process', connectionId: 'c1' } },
    },
  })
  setAgentAlarmWatch(cwd, { followup: true, sessionId: 'sess-a', pointIds: ['p1'] })
  const point = loadWorkspace(home, cwd).modbus.points[0]
  const live = recheckAlarmCurrent(home, cwd, { point, kind: 'max', at: 1 }, 'sess-a')
  assert.equal(live.historical, true)
  const ran = await emitCommittedAlarmTransitions(home, cwd, {
    fired: [{ point, kind: 'max', raw: 99, at: 1, eventId: 'cleared-1' }],
  })
  assert.equal(ran.notified, 0)
})

test('unrelated running agent task must not wake for other point alarms', async (t) => {
  resetAlarmInternals()
  const bench = await createBench(t, { prefix: 'dvb-alarm-unrelated-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    session: { boundId: 'sess-a' },
    tasks: [{ id: 't1', type: 'read', status: 'running', source: 'agent', sessionId: 'sess-a', pointId: 'p9' }],
    modbus: {
      version: 3,
      connections: [rtuSim('c1', 'COM3')],
      devices: [device('d1', 'c1', 1)],
      points: [hrPoint('p1', 'c1', 'd1', 0, { alarmEnabled: true, alarmMax: 50, monitorEnabled: true })],
      alarmState: { p1: { condition: 'active', pointId: 'p1', group: 'process', connectionId: 'c1' } },
    },
  })
  const point = loadWorkspace(home, cwd).modbus.points[0]
  const gate = shouldNotifyAgentOfProcessAlarm(home, cwd, { point, kind: 'max', connectionId: 'c1' })
  assert.equal(gate.shouldNotify, false)
  assert.equal(gate.reason, 'no-watch')
})

test('suppress-window re-fire via commitPollResult yields distinct eventIds; redelivery is idempotent', async (t) => {
  resetAlarmInternals()
  const bench = await createBench(t, { prefix: 'dvb-alarm-identity-' })
  const { home, cwd } = bench
  /** @type {any[]} */
  const followups = []
  setAgentsRegistry({
    get() {
      return {
        followup(msg) {
          followups.push(msg)
        },
      }
    },
  })
  bench.save({
    session: { boundId: 'sess-a' },
    modbus: {
      version: 3,
      connections: [rtuSim('c1', 'COM3')],
      devices: [device('d1', 'c1', 1)],
      points: [hrPoint('p1', 'c1', 'd1', 0, { alarmEnabled: true, alarmMax: 50, monitorEnabled: true })],
      values: [],
      alarmState: {},
      alarmActive: {},
      pollingByConnection: { c1: { enabled: true, intervalMs: 1000, lastOk: true, error: '' } },
    },
  })
  setAgentAlarmWatch(cwd, { followup: true, sessionId: 'sess-a', pointIds: ['p1'] })

  const fire = async (raw) => {
    const ws = loadWorkspace(home, cwd)
    return commitPollResult(home, cwd, {
      baseConfigVersion: ws.modbus.configVersion,
      pointValues: [{ key: 'p1', pointId: 'p1', raw, value: raw, ok: true, at: Date.now() }],
      pollingByConnection: {
        c1: { enabled: true, intervalMs: 1000, lastAt: Date.now(), lastOk: true, error: '' },
      },
    })
  }

  const firstFire = await fire(90)
  assert.equal(firstFire.alarms.fired.length, 1)
  const firstId = firstFire.alarms.fired[0].eventId
  assert.ok(firstId, 'committed fired must carry eventId')
  assert.notEqual(firstId, 'p1')
  const firstEmit = await emitCommittedAlarmTransitions(home, cwd, { fired: firstFire.alarms.fired })
  assert.equal(firstEmit.notified, 1)
  assert.equal(followups.length, 1)

  // Same eventId redelivery must stay idempotent.
  const redelivery = await emitCommittedAlarmTransitions(home, cwd, { fired: firstFire.alarms.fired })
  assert.equal(redelivery.notified, 0)
  assert.equal(followups.length, 1)

  // Recover, then re-fire inside the suppress window: firstAt is reused by the
  // alarm object, but the committed transition must get a NEW eventId.
  const recovered = await fire(10)
  assert.equal(recovered.alarms.recovered.length >= 1, true)
  const secondFire = await fire(90)
  assert.equal(secondFire.alarms.fired.length, 1)
  const secondId = secondFire.alarms.fired[0].eventId
  assert.ok(secondId)
  assert.notEqual(secondId, firstId, 'suppress-window re-fire must not reuse eventId')
  assert.equal(
    secondFire.alarms.fired[0].alarm?.firstAt === firstFire.alarms.fired[0].alarm?.firstAt,
    true,
    'fixture expects firstAt reuse so eventId cannot key off firstAt',
  )
  await emitCommittedAlarmTransitions(home, cwd, { fired: secondFire.alarms.fired })
  assert.equal(followups.length, 2)
})

test('same-millisecond migrations mint distinct eventIds without relying on lastAt', () => {
  const point = { id: 'p1', connectionId: 'c1', deviceId: 'd1', alarmMax: 50, alarmEnabled: true }
  const sharedFirstAt = 5_000
  const mkItem = (/** @type {number} */ lastAt) => ({
    point,
    kind: 'max',
    raw: 99,
    alarm: { id: 'p1', pointId: 'p1', firstAt: sharedFirstAt, lastAt, eventId: undefined },
  })
  // Same ms for both migrations — lastAt and firstAt collide.
  const a = alarmInternal.alarmEventMeta(stampAlarmTransitionIdentity(mkItem(5_000)), {
    cwd: '/w',
    sessionId: 'sess-a',
  })
  const b = alarmInternal.alarmEventMeta(stampAlarmTransitionIdentity(mkItem(5_000)), {
    cwd: '/w',
    sessionId: 'sess-a',
  })
  assert.notEqual(a.eventId, b.eventId, 'same-ms migrations must not share eventId')
  assert.notEqual(a.eventId, 'p1')
  assert.equal(a.eventAt, 5_000)
  assert.equal(b.eventAt, 5_000)

  // Without a verifiable transition marker, meta itself must mint a fresh id.
  const c = alarmInternal.alarmEventMeta(mkItem(5_000), { cwd: '/w', sessionId: 'sess-a' })
  const d = alarmInternal.alarmEventMeta(mkItem(5_000), { cwd: '/w', sessionId: 'sess-a' })
  assert.notEqual(c.eventId, d.eventId)
  assert.equal(c.eventAt, 5_000, 'eventAt prefers lastAt over firstAt')

  // evaluateAlarms suppress re-fire keeps firstAt; stamped ids still differ.
  const points = [{ ...point, function: 3, address: 0, alarmMin: null, alarmMax: 50, monitorEnabled: true }]
  let cur = evaluateAlarms({
    points,
    values: [{ pointId: 'p1', raw: 90, ok: true }],
    prevState: {},
    opts: { now: 7_000, suppressWindowMs: 30_000, deadband: 1 },
  })
  assert.equal(cur.fired.length, 1)
  cur = evaluateAlarms({
    points,
    values: [{ pointId: 'p1', raw: 10, ok: true }],
    prevState: cur.next,
    opts: { now: 7_000, suppressWindowMs: 30_000, deadband: 1 },
  })
  assert.equal(cur.recovered.length, 1)
  cur = evaluateAlarms({
    points,
    values: [{ pointId: 'p1', raw: 90, ok: true }],
    prevState: cur.next,
    opts: { now: 7_000, suppressWindowMs: 30_000, deadband: 1 },
  })
  assert.equal(cur.fired.length, 1)
  const s1 = stampAlarmTransitionIdentity({ ...cur.fired[0], eventId: undefined })
  // Rebuild the first fired with the same firstAt/lastAt shape and stamp again.
  const s2 = stampAlarmTransitionIdentity({
    point,
    kind: 'max',
    raw: 90,
    alarm: { id: 'p1', firstAt: 7_000, lastAt: 7_000 },
  })
  assert.notEqual(s1.eventId, s2.eventId)
})
