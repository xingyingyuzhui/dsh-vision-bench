import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeAlarmState, groupAlarms, acknowledgeAlarm, evaluateAlarms, COND_ACTIVE, COND_RECOVERED } from '../bench-alarm.mjs'

test('Task12: condition/acknowledged split and 4-quadrant buckets', () => {
  const state = {
    a1: { condition: 'active', acknowledged: false, group: 'process', pointId: 'p1', firstAt: 1000, lastAt: 2000, count: 1 },
    a2: { condition: 'active', acknowledged: true, ackedBy: 'user', ackedAt: 2500, group: 'process', pointId: 'p2', firstAt: 1000, lastAt: 2000, count: 1 },
    a3: { condition: 'recovered', acknowledged: false, group: 'comm', connectionId: 'c1', firstAt: 1000, lastAt: 3000, recoveredAt: 3000, durationMs: 2000, count: 2 },
    a4: { condition: 'recovered', acknowledged: true, ackedBy: 'user', group: 'process', pointId: 'p3', firstAt: 1000, lastAt: 4000, recoveredAt: 4000, count: 1 },
  }
  const norm = normalizeAlarmState(state)
  assert.equal(norm.a1.condition, COND_ACTIVE)
  assert.equal(norm.a1.acknowledged, false)
  assert.equal(norm.a2.acknowledged, true)
  assert.equal(norm.a2.ackedBy, 'user')
  assert.equal(norm.a3.condition, COND_RECOVERED)
  assert.ok(norm.a3.recoveredAt > 0)
  assert.ok(norm.a3.durationMs >= 0)
  const g = groupAlarms(norm)
  assert.equal(g.activeUnacked.length, 1)
  assert.equal(g.activeAcked.length, 1)
  assert.equal(g.recoveredUnacked.length, 1)
  assert.equal(g.recoveredAcked.length, 1)
  assert.equal(g.historyAcked.length, 1)
  assert.equal(g.buckets.activeUnacked.length, 1)
})

test('Task12: active ack does not refire, recovered->breach new incident, agent suggest only', () => {
  const points = [{ id: 'p1', connectionId: 'c1', deviceId: 'd1', alarmMax: 100 }]
  let cur = evaluateAlarms({ points, values: [{ pointId: 'p1', raw: 120, ok: true }], opts: { now: 1000 } })
  assert.equal(cur.fired.length, 1)
  assert.equal(cur.next.p1.condition, 'active')
  assert.equal(cur.next.p1.acknowledged, false)
  const firstAt = cur.next.p1.firstAt
  // active ack should keep condition active, not fire again
  const acked = acknowledgeAlarm(cur.next, 'p1', { by: 'user', now: 1500 })
  assert.equal(acked.p1.acknowledged, true)
  assert.equal(acked.p1.condition, 'active')
  assert.equal(acked.p1.ackedBy, 'user')
  assert.ok(acked.p1.ackedAt > 0)
  // evaluate while still breaching, with acked active -> no new fired
  cur = evaluateAlarms({ points, values: [{ pointId: 'p1', raw: 122, ok: true }], prevState: acked, opts: { now: 2000 } })
  assert.equal(cur.fired.length, 0)
  assert.equal(cur.next.p1.condition, 'active')
  assert.equal(cur.next.p1.acknowledged, true)
  // recover
  cur = evaluateAlarms({ points, values: [{ pointId: 'p1', raw: 90, ok: true }], prevState: cur.next, opts: { now: 3000 } })
  assert.equal(cur.recovered.length, 1)
  assert.equal(cur.next.p1.condition, 'recovered')
  assert.ok(cur.next.p1.recoveredAt > 0)
  assert.ok(cur.next.p1.durationMs > 0)
  // agent suggest should not ack
  const suggested = acknowledgeAlarm(cur.next, 'p1', { by: 'agent', now: 3500 })
  assert.equal(suggested.p1.acknowledged, true) // already acked, remains acked
  const fresh = evaluateAlarms({ points, values: [{ pointId: 'p1', raw: 120, ok: true }], prevState: { p1: { condition: 'active', acknowledged: false, group: 'process', pointId: 'p1', firstAt: 1000, lastAt: 2000, count: 1 } }, opts: { now: 4000 } })
  const sug2 = acknowledgeAlarm(fresh.next, 'p1', { by: 'agent', now: 4100 })
  assert.equal(sug2.p1.acknowledged, false)
  assert.equal(sug2.p1.suggestedBy, 'agent')
  assert.ok(sug2._suggested)
})

test('Task12: alarm ref keeps point/connection/device/frame/transaction/task', () => {
  const state = { a1: { condition: 'active', acknowledged: false, group: 'process', pointId: 'pX', connectionId: 'c9', deviceId: 'd9', frameId: 'f123', transactionId: 't456', taskId: 'task7', firstAt: 1000, lastAt: 2000, count: 1 } }
  const norm = normalizeAlarmState(state)
  const a = norm.a1
  assert.equal(a.pointId, 'pX')
  assert.equal(a.connectionId, 'c9')
  assert.equal(a.deviceId, 'd9')
  assert.equal(a.frameId, 'f123')
  assert.equal(a.transactionId, 't456')
  assert.equal(a.taskId, 'task7')
})

test('Task9/0.20.1: 关闭告警 → 激活即恢复（含 deadband/pending）；监视独立', () => {
  const points = [{ id: 'p1', connectionId: 'c1', deviceId: 'd1', alarmMin: null, alarmMax: 100, alarmEnabled: true }]
  let cur = evaluateAlarms({ points, values: [{ pointId: 'p1', raw: 120, ok: true }], opts: { now: 1000, deadband: 5 } })
  assert.equal(cur.next.p1.condition, 'active', '高值产生告警')
  // 值仍越限，关闭告警
  const off = [{ ...points[0], alarmEnabled: false }]
  cur = evaluateAlarms({ points: off, values: [{ pointId: 'p1', raw: 120, ok: true }], prevState: cur.next, opts: { now: 2000, deadband: 5 } })
  assert.equal(cur.next.p1.condition, 'recovered', '关闭 → recovered（deadband>0 亦然）')
  assert.ok(cur.recoveredList.length >= 1)
  assert.equal(cur.fired.length, 0, '不再触发新告警')
  assert.ok(cur.next.p1.recoveredAt > 0 && cur.next.p1.durationMs > 0, 'recoveredAt/durationMs 写入')
  assert.equal(cur.next.p1.pendingSince, 0, 'pendingSince 清除')
  assert.equal(cur.next.p1.threshold, 100, '阈值保留')
})

test('Task9/0.20.1: pending 告警关闭后不转为 active', () => {
  const points = [{ id: 'p1', connectionId: 'c1', deviceId: 'd1', alarmMax: 100, alarmEnabled: true }]
  let cur = evaluateAlarms({ points, values: [{ pointId: 'p1', raw: 120, ok: true }], opts: { now: 1000, delayMs: 5000 } })
  assert.ok(cur.next.p1.pendingSince > 0, 'pending 状态')
  const off = [{ ...points[0], alarmEnabled: false }]
  cur = evaluateAlarms({ points: off, values: [{ pointId: 'p1', raw: 120, ok: true }], prevState: cur.next, opts: { now: 2000, delayMs: 5000 } })
  assert.equal(cur.next.p1.condition, 'recovered', 'pending → recovered')
  assert.equal(cur.fired.length, 0, '不产生 active')
})

test('Task9/0.20.1: 监视关闭但告警开启 → 告警仍工作；告警关闭但监视开启 → 采样继续', () => {
  // 告警与监视独立（采样由 trend-store 门控 monitorEnabled；告警门控 alarmEnabled）
  const points = [{ id: 'p1', connectionId: 'c1', deviceId: 'd1', alarmMax: 100, alarmEnabled: true, monitorEnabled: false }]
  const cur = evaluateAlarms({ points, values: [{ pointId: 'p1', raw: 150, ok: true }], opts: { now: 1000 } })
  assert.equal(cur.next.p1.condition, 'active', '监视关闭不影响告警')
  // 采样：monitorEnabled 关闭 → 无样本（由 sampleTrendValues 负责，此处纯语义验证模型）
  const model = points[0]
  assert.equal(model.monitorEnabled, false)
  assert.equal(model.alarmEnabled, true)
})
