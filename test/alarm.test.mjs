import assert from 'node:assert/strict'
import test from 'node:test'
import { ACTIVE, RECOVERED, ACKED, PROCESS, COMM, ALARM_STATUS, ALARM_GROUP, normalizeAlarmState, groupAlarms, evaluateAlarms, acknowledgeAlarm } from '../bench-alarm.mjs'

test('normalizeAlarmState tri-state compat: boolean legacy -> active and groupAlarms split', () => {
  const legacy = { 'p1': true, 'p2': false, 'p3': { status: 'recovered', group: 'process', pointId: 'p3' }, 'comm:c1': { status: 'active', group: 'comm', connectionId: 'c1' } }
  const norm = normalizeAlarmState(legacy)
  assert.equal(norm['p1'].status, ACTIVE)
  assert.equal(norm['p1'].group, PROCESS)
  assert.ok(!norm['p2'])
  assert.equal(norm['p3'].status, RECOVERED)
  assert.equal(norm['comm:c1'].group, COMM)
  assert.deepEqual(ALARM_STATUS, { ACTIVE: 'active', RECOVERED: 'recovered', ACKED: 'acked' })
  assert.deepEqual(ALARM_GROUP, { PROCESS: 'process', COMM: 'comm' })
  const g = groupAlarms(norm)
  assert.ok(g.process.length >= 2)
  assert.ok(g.comm.length === 1)
  assert.ok(g.active.length === 2) // p1 and comm:c1
  assert.ok(g.recovered.length === 1)
  assert.ok(g.current.length === 3) // active+recovered
  assert.ok(g.history.length === 1) // recovered in history (plus acked)
})

test('evaluateAlarms deadband + suppress window merges within window (process)', () => {
  const points = [{ id: 'p1', connectionId: 'c1', deviceId: 'd1', name: 'Temp', function: 3, address: 0, alarmMax: 100, alarmMin: null }]
  let prev = {}
  // t0 breach -> fire
  let cur = evaluateAlarms({ points, values: [{ pointId: 'p1', raw: 120, ok: true }], prevState: prev, pollingByConnection: {}, connections: [{ id: 'c1', name: 'C1' }], opts: { deadband: 5, suppressWindowMs: 30000, now: 1000 } })
  assert.equal(cur.fired.length, 1)
  assert.equal(cur.next['p1'].status, ACTIVE)
  assert.equal(cur.next['p1'].count, 1)
  prev = cur.next
  // t1 within deadband 98 stays active (100-5=95, 98>95 => still breach)
  cur = evaluateAlarms({ points, values: [{ pointId: 'p1', raw: 98, ok: true }], prevState: prev, opts: { deadband: 5, now: 2000 } })
  assert.equal(cur.fired.length, 0)
  assert.equal(cur.next['p1'].status, ACTIVE)
  assert.equal(cur.recovered.length, 0)
  prev = cur.next
  // t2 drop below deadband 90 -> recovered
  cur = evaluateAlarms({ points, values: [{ pointId: 'p1', raw: 90, ok: true }], prevState: prev, opts: { deadband: 5, now: 3000 } })
  assert.equal(cur.recovered.length, 1)
  assert.equal(cur.next['p1'].status, RECOVERED)
  const recoveredAt = cur.next['p1'].lastAt
  prev = cur.next
  // t3 within suppress window 20s later -> breach again should merge count increment not new incident but fired again? Our logic merges count
  cur = evaluateAlarms({ points, values: [{ pointId: 'p1', raw: 120, ok: true }], prevState: prev, opts: { suppressWindowMs: 30000, now: recoveredAt + 5000 } })
  assert.equal(cur.next['p1'].count, 2)
  assert.equal(cur.next['p1'].status, ACTIVE)
  assert.equal(cur.fired.length, 1) // new firing after recovered, even within window we still emit fired but with merged count
  prev = cur.next
  // t4 stale quality should keep active but update quality
  cur = evaluateAlarms({ points, values: [{ pointId: 'p1', ok: false, error: 'timeout' }], prevState: prev, opts: { now: recoveredAt + 6000 } })
  assert.equal(cur.next['p1'].status, ACTIVE)
  assert.equal(cur.next['p1'].quality, 'bad')
})

test('evaluateAlarms comm grouping and acknowledge transitions to acked', () => {
  const points = []
  const conns = [{ id: 'c1', name: 'COM3' }, { id: 'c2', name: 'COM4' }]
  let prev = {}
  const pollingFail = { c1: { lastOk: false, error: 'timeout', lastAt: 1000 }, c2: { lastOk: true, lastAt: 1000 } }
  let cur = evaluateAlarms({ points, values: [], prevState: prev, pollingByConnection: pollingFail, connections: conns, opts: { now: 5000 } })
  assert.equal(cur.fired.length, 1)
  assert.ok(cur.next['comm:c1'])
  assert.equal(cur.next['comm:c1'].group, COMM)
  assert.equal(cur.next['comm:c1'].status, ACTIVE)
  const g = groupAlarms(cur.next)
  assert.equal(g.comm.length, 1)
  assert.equal(g.process.length, 0)
  assert.equal(g.active.length, 1)
  // ack single
  const acked = acknowledgeAlarm(cur.next, 'comm:c1')
  assert.equal(acked['comm:c1'].status, ACKED)
  assert.ok(acked['comm:c1'].ackedAt > 0)
  const g2 = groupAlarms(acked)
  assert.equal(g2.acked.length, 1)
  assert.equal(g2.current.length, 0)
  assert.equal(g2.history.length, 1)
  // ack all
  const withProc = { ...acked, 'p1': { id: 'p1', group: PROCESS, status: ACTIVE, pointId: 'p1', firstAt: 1000, lastAt: 2000, count: 1 } }
  const allAcked = acknowledgeAlarm(withProc, 'all')
  assert.ok(Object.values(allAcked).every(v=> v.status===ACKED))
})
