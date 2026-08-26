// bench-alarm: tri-state alarm model with condition/acknowledged split, process/comm grouping, deadband/delay/dedup
import { evaluateAlarm, decodeValue, pointLabel } from './bench-points.mjs'

export const ACTIVE = 'active'
export const RECOVERED = 'recovered'
export const ACKED = 'acked'
export const ALARM_STATUS = { ACTIVE, RECOVERED, ACKED }

export const PROCESS = 'process'
export const COMM = 'comm'
export const ALARM_GROUP = { PROCESS, COMM }

export const COND_ACTIVE = 'active'
export const COND_RECOVERED = 'recovered'
export const ALARM_CONDITION = { ACTIVE: COND_ACTIVE, RECOVERED: COND_RECOVERED }

const ALLOWED_STATUS = new Set([ACTIVE, RECOVERED, ACKED])
const ALLOWED_GROUP = new Set([PROCESS, COMM])
const ALLOWED_COND = new Set([COND_ACTIVE, COND_RECOVERED])
const textBy = (v) => typeof v === 'string' ? v.trim().slice(0, 32) : ''

const nowMs = () => Date.now()
const capAlarm = 256
const defaultSuppressMs = 30_000

const textId = (v) => typeof v === 'string' ? v.trim() : ''

export function normalizeAlarmState(input, opts = {}) {
  const pointsById = opts.pointsById || null
  const out = {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out
  const entries = Object.entries(input)
  for (const [rawKey, rawVal] of entries) {
    if (Object.keys(out).length >= capAlarm) break
    const id = textId(rawKey)
    if (!id) continue
    // legacy boolean compat: true => active process alarm, false/empty => skip
    if (rawVal === true) {
      const _at = nowMs()
      out[id] = { id, group: PROCESS, status: ACTIVE, condition: COND_ACTIVE, acknowledged: false, ackedAt: 0, ackedBy: '', kind: 'max', pointId: id, connectionId: '', deviceId: '', frameId: '', transactionId: '', taskId: '', value: null, threshold: null, quality: 'good', firstAt: _at, lastAt: _at, recoveredAt: 0, durationMs: 0, count: 1, severity: 'high', suppressUntil: 0, pendingSince: 0 }
      continue
    }
    if (rawVal === false || rawVal == null) continue
    if (typeof rawVal === 'object') {
      // allow bare boolean-like object {active:true} legacy
      if (rawVal && rawVal.active === true && !rawVal.status && !rawVal.condition) {
        const _at2 = Number(rawVal.firstAt) || nowMs()
        out[id] = { id, group: PROCESS, status: ACTIVE, condition: COND_ACTIVE, acknowledged: false, ackedAt: 0, ackedBy: '', kind: rawVal.kind || 'max', pointId: id, connectionId: textId(rawVal.connectionId), deviceId: textId(rawVal.deviceId), frameId: '', transactionId: '', taskId: '', value: rawVal.value ?? null, threshold: rawVal.threshold ?? null, quality: rawVal.quality || 'good', firstAt: _at2, lastAt: Number(rawVal.lastAt) || _at2, recoveredAt: 0, durationMs: 0, count: Number(rawVal.count) > 0 ? Math.trunc(rawVal.count) : 1, severity: 'high', suppressUntil: 0, pendingSince: 0 }
        continue
      }
      const group = ALLOWED_GROUP.has(rawVal.group) ? rawVal.group : (id.startsWith('comm:') ? COMM : PROCESS)
      let condition = ALLOWED_COND.has(rawVal.condition) ? rawVal.condition : null
      let acknowledged = typeof rawVal.acknowledged === 'boolean' ? rawVal.acknowledged : null
      let status = ALLOWED_STATUS.has(rawVal.status) ? rawVal.status : null
      if (condition === null && status) { if (status === ACTIVE) condition = COND_ACTIVE; else if (status === RECOVERED) condition = COND_RECOVERED; else if (status === ACKED) { condition = COND_RECOVERED; if (acknowledged === null) acknowledged = true } }
      if (condition === null && typeof rawVal.acked === 'boolean') { if (rawVal.acked) { condition = COND_RECOVERED; acknowledged = true } else condition = COND_ACTIVE }
      if (condition === null) condition = COND_ACTIVE
      if (acknowledged === null) { if (status === ACKED) acknowledged = true; else if (typeof rawVal.acked === 'boolean') acknowledged = !!rawVal.acked; else acknowledged = false }
      const firstAt = Number(rawVal.firstAt) > 0 ? Number(rawVal.firstAt) : (Number(rawVal.at) > 0 ? Number(rawVal.at) : nowMs()), lastAt = Number(rawVal.lastAt) > 0 ? Number(rawVal.lastAt) : firstAt, recoveredAt = Number(rawVal.recoveredAt) > 0 ? Number(rawVal.recoveredAt) : (condition === COND_RECOVERED ? lastAt : 0), durationMs = Number(rawVal.durationMs) > 0 ? Number(rawVal.durationMs) : (recoveredAt ? Math.max(0, recoveredAt - firstAt) : Math.max(0, lastAt - firstAt)), severity = typeof rawVal.severity === 'string' && rawVal.severity ? String(rawVal.severity).slice(0, 16) : (group === COMM ? 'high' : 'medium')
      const pointId = textId(rawVal.pointId || (group === PROCESS ? id : '')), connectionId = textId(rawVal.connectionId || rawVal.connId || ''), deviceId = textId(rawVal.deviceId || '')
      let fallbackConn = connectionId, fallbackDev = deviceId; if (pointsById && pointId && pointsById[pointId]) { fallbackConn = pointsById[pointId].connectionId || fallbackConn; fallbackDev = pointsById[pointId].deviceId || fallbackDev }
      const ackedAt = Number(rawVal.ackedAt) > 0 ? Number(rawVal.ackedAt) : 0
      const ackedBy = textBy(rawVal.ackedBy || rawVal.ackBy || '')
      const derivedStatus = acknowledged ? ACKED : (condition === COND_ACTIVE ? ACTIVE : RECOVERED)
      out[id] = { id, group, status: derivedStatus, condition, acknowledged: !!acknowledged, ackedAt, ackedBy, suggestedAt: Number(rawVal.suggestedAt) > 0 ? Number(rawVal.suggestedAt) : 0, suggestedBy: textBy(rawVal.suggestedBy || ''), kind: typeof rawVal.kind === 'string' ? rawVal.kind.slice(0, 16) : '', pointId, connectionId: fallbackConn, deviceId: fallbackDev, frameId: textId(rawVal.frameId || ''), transactionId: textId(rawVal.transactionId || rawVal.txId || ''), taskId: textId(rawVal.taskId || ''), value: rawVal.value !== undefined ? rawVal.value : (rawVal.raw !== undefined ? rawVal.raw : null), threshold: rawVal.threshold !== undefined ? rawVal.threshold : null, quality: typeof rawVal.quality === 'string' ? rawVal.quality.slice(0, 16) : 'good', firstAt, lastAt, recoveredAt, durationMs, count: Number(rawVal.count) > 0 ? Math.min(9999, Math.trunc(rawVal.count)) : 1, severity, suppressUntil: Number(rawVal.suppressUntil) > 0 ? Number(rawVal.suppressUntil) : 0, pendingSince: Number(rawVal.pendingSince) > 0 ? Number(rawVal.pendingSince) : 0 }
    }
  }
  return out
}

export function groupAlarms(alarmState) {
  const all = Object.values(normalizeAlarmState(alarmState))
  const process = all.filter(a => a.group === PROCESS), comm = all.filter(a => a.group === COMM)
  const active = all.filter(a => a.condition === COND_ACTIVE && !a.acknowledged), recovered = all.filter(a => a.condition === COND_RECOVERED && !a.acknowledged), acked = all.filter(a => a.acknowledged)
  const activeUnacked = active, activeAcked = all.filter(a => a.condition === COND_ACTIVE && a.acknowledged), recoveredUnacked = recovered, recoveredAcked = all.filter(a => a.condition === COND_RECOVERED && a.acknowledged)
  const activeAll = all.filter(a => a.condition === COND_ACTIVE), recoveredAll = all.filter(a => a.condition === COND_RECOVERED), unacked = all.filter(a => !a.acknowledged)
  const current = active.concat(recovered), historyLegacy = acked.concat(recovered), history = recoveredAcked
  return { all, process, comm, active, recovered, acked, activeUnacked, activeAcked, recoveredUnacked, recoveredAcked, activeAll, recoveredAll, unacked, current, history: historyLegacy, historyAcked: history, historyConfirmed: history, byGroup: { process, comm }, byStatus: { active, recovered, acked }, byCondition: { active: activeAll, recovered: recoveredAll }, byAck: { acked, unacked }, buckets: { activeUnacked, activeAcked, recoveredUnacked, recoveredAcked } }
}

export function acknowledgeAlarm(alarmState, id, opts = {}) {
  const norm = normalizeAlarmState(alarmState)
  const at = Number(opts && opts.now) > 0 ? Number(opts.now) : nowMs()
  const byRaw = opts && (opts.by || opts.ackedBy || opts.actor) ? String(opts.by || opts.ackedBy || opts.actor).trim() : ''
  const by = textBy(byRaw || 'user')
  const isAgent = by === 'agent'
  if (isAgent && !(opts && opts.force)) {
    const handle = (k, v) => v.acknowledged ? v : { ...v, suggestedAt: at, suggestedBy: by }
    if (id === 'all' || id === '*') {
      const nextS = {}
      for (const [k, v] of Object.entries(norm)) nextS[k] = handle(k, v)
      return { ...norm, ...nextS, _suggested: true }
    }
    const key = textId(id)
    if (!key || !norm[key]) return norm
    return { ...norm, [key]: handle(key, norm[key]), _suggested: norm[key].acknowledged ? undefined : true }
  }
  if (id === 'all' || id === '*') {
    const next = {}
    for (const [k, v] of Object.entries(norm)) {
      if (v.acknowledged) { next[k] = v; continue }
      next[k] = { ...v, acknowledged: true, ackedAt: at, ackedBy: by, status: ACKED, suppressUntil: 0, pendingSince: 0 }
    }
    return next
  }
  const key = textId(id)
  if (!key || !norm[key]) return norm
  if (norm[key].acknowledged) return norm
  return { ...norm, [key]: { ...norm[key], acknowledged: true, ackedAt: at, ackedBy: by, status: ACKED, suppressUntil: 0, pendingSince: 0 } }
}

export const suggestAlarm = (s, id, by='agent') => acknowledgeAlarm(s, id, { by })
export const buildAlarmRef = (a, o={}) => !a||!a.id?null:{ alarmId:a.id, pointId:a.pointId||'', connectionId:a.connectionId||'', deviceId:a.deviceId||'', frameId:a.frameId||'', transactionId:a.transactionId||'', taskId:a.taskId||'', firstAt:a.firstAt||0, lastAt:a.lastAt||0, recoveredAt:a.recoveredAt||0, condition:a.condition||COND_ACTIVE, acknowledged:!!a.acknowledged, severity:a.severity||'medium', count:a.count||1, version:Number(o.configVersion)>0?Number(o.configVersion):1 }

// core evaluation: points + values -> process alarms, pollingByConnection -> comm alarms, with deadband/delay/suppress-window merging
export function evaluateAlarms({ points, values, prevState, pollingByConnection, connections, opts } = {}) {
  const now = (opts && Number(opts.now) > 0) ? Number(opts.now) : nowMs()
  const deadband = Number(opts && opts.deadband) > 0 ? Number(opts.deadband) : 0
  const delayMs = Number(opts && opts.delayMs) >= 0 ? Number(opts.delayMs) : 0
  const suppressMs = Number(opts && opts.suppressWindowMs) >= 0 ? Number(opts.suppressWindowMs) : defaultSuppressMs
  const prev = normalizeAlarmState(prevState)
  const next = { ...prev }
  const fired = []
  const recoveredList = []
  const pointsById = {}
  for (const p of Array.isArray(points) ? points : []) if (p && p.id) pointsById[p.id] = p
  const valueById = {}
  for (const r of Array.isArray(values) ? values : []) { const k = r && (r.pointId || r.key); if (k) valueById[k] = r }
  // process alarms with deadband and delay
  for (const p of Array.isArray(points) ? points : []) {
    if (!p || !p.id) continue
    // Task9/0.20.1: 告警开关是真正的总开关（显式 alarmEnabled 优先；未声明按阈值推断）。
    // 关闭 → 不进入死区/breach；激活或 pending 告警立即转 recovered，清除 pendingSince。
    const effAlarmEnabled = (p.alarmEnabled === undefined) ? (p.alarmMin != null || p.alarmMax != null) : p.alarmEnabled
    const alarmDisabled = effAlarmEnabled !== true || (p.alarmMin == null && p.alarmMax == null)
    if (alarmDisabled) {
      if (next[p.id] && next[p.id].group === PROCESS && (next[p.id].condition === COND_ACTIVE || next[p.id].pendingSince || next[p.id].status === ACTIVE)) {
        const pr = next[p.id]
        const ra = now
        next[p.id] = { ...pr, condition: COND_RECOVERED, status: pr.acknowledged ? ACKED : RECOVERED, recoveredAt: ra, durationMs: Math.max(0, ra - pr.firstAt), lastAt: now, suppressUntil: now + suppressMs, pendingSince: 0 }
        recoveredList.push({ ...next[p.id] })
      }
      continue
    }
    const rec = valueById[p.id]
    const quality = rec ? (rec.ok === true ? 'good' : (rec.error ? 'bad' : 'stale')) : 'stale'
    const prevRec = next[p.id]
    if (!rec || rec.ok !== true) {
      if (prevRec && prevRec.group === PROCESS && prevRec.condition === COND_ACTIVE) {
        next[p.id] = { ...prevRec, quality, lastAt: now, value: rec ? rec.raw ?? null : null }
      }
      continue
    }
    const engVal = decodeValue(p, rec.raw)
    // TaskP3/0.20.0: 阈值/死区/恢复比较统一使用工程值（不再混用 raw）
    let breachKind = evaluateAlarm(p, engVal)
    if (!breachKind && prevRec && prevRec.condition === COND_ACTIVE && deadband > 0) {
      const n = Number(engVal)
      if (prevRec.kind === 'max' && p.alarmMax != null && Number.isFinite(n)) {
        if (n > (p.alarmMax - deadband)) breachKind = 'max'
      } else if (prevRec.kind === 'min' && p.alarmMin != null && Number.isFinite(n)) {
        if (n < (p.alarmMin + deadband)) breachKind = 'min'
      }
    }
    const threshold = breachKind === 'max' ? p.alarmMax : (breachKind === 'min' ? p.alarmMin : null)
    if (breachKind) {
      // delay: need persistent breach for delayMs
      if (delayMs > 0) {
        const pend = prevRec && prevRec.pendingSince ? prevRec.pendingSince : 0
        if (!pend) {
          next[p.id] = { ...(prevRec || { id: p.id, group: PROCESS, pointId: p.id, connectionId: p.connectionId || '', deviceId: p.deviceId || '', frameId: textId(opts && opts.frameId), transactionId: textId(opts && opts.transactionId), taskId: textId(opts && opts.taskId) }), group: PROCESS, condition: prevRec ? prevRec.condition : COND_ACTIVE, acknowledged: prevRec ? !!prevRec.acknowledged : false, status: prevRec && prevRec.acknowledged ? ACKED : (prevRec && prevRec.condition === COND_RECOVERED ? RECOVERED : ACTIVE), kind: breachKind, pendingSince: now, firstAt: prevRec ? prevRec.firstAt : now, lastAt: now, value: engVal, threshold, quality, count: prevRec ? prevRec.count : 1, severity: 'high', connectionId: p.connectionId || (prevRec && prevRec.connectionId) || '', deviceId: p.deviceId || (prevRec && prevRec.deviceId) || '', recoveredAt: 0, durationMs: 0 }
          continue
        }
        if (now - pend < delayMs) {
          next[p.id] = { ...(prevRec || {}), pendingSince: pend, lastAt: now, value: engVal, threshold, quality }
          continue
        }
      }
      if (!prevRec || prevRec.condition === COND_RECOVERED) {
        const withinSuppress = prevRec && prevRec.suppressUntil && now < prevRec.suppressUntil
        const base = withinSuppress ? prevRec : null
        const count = base ? (base.count + 1) : 1
        const firstAt = base ? base.firstAt : now
        next[p.id] = { id: p.id, group: PROCESS, condition: COND_ACTIVE, acknowledged: false, ackedAt: 0, ackedBy: '', suggestedAt: 0, suggestedBy: '', status: ACTIVE, kind: breachKind, pointId: p.id, connectionId: p.connectionId || '', deviceId: p.deviceId || '', frameId: textId(opts && opts.frameId || ''), transactionId: textId(opts && opts.transactionId || ''), taskId: textId(opts && opts.taskId || ''), value: engVal, threshold, quality, firstAt, lastAt: now, recoveredAt: 0, durationMs: 0, count, severity: 'high', suppressUntil: 0, pendingSince: 0 }
        if (!base || prevRec.condition !== COND_ACTIVE) fired.push({ point: p, raw: rec.raw, kind: breachKind, alarm: next[p.id] })
      } else if (prevRec.condition === COND_ACTIVE) {
        // already active: update value/lastAt, handle dedup: if within suppress window, just bump count? For process active, suppress is for recovered; active just update
        // but if repeatedly firing same alarm within window while still active, we merge by counting? We keep count stable and just update time to avoid spam
        if (prevRec.kind !== breachKind) {
          next[p.id] = { ...prevRec, kind: breachKind, value: engVal, threshold, quality, lastAt: now, pendingSince: 0, count: prevRec.count }
        } else {
          next[p.id] = { ...prevRec, value: engVal, threshold, quality, lastAt: now, pendingSince: 0 }
        }
        // no new fired entry (dedup)
      }
    } else {
      if (prevRec && prevRec.condition === COND_ACTIVE) {
        const ra = now
        next[p.id] = { ...prevRec, condition: COND_RECOVERED, status: prevRec.acknowledged ? ACKED : RECOVERED, recoveredAt: ra, durationMs: Math.max(0, ra - prevRec.firstAt), lastAt: now, value: engVal, threshold: null, quality, suppressUntil: now + suppressMs, pendingSince: 0 }
        recoveredList.push({ point: p, raw: rec.raw ?? null, alarm: next[p.id] })
      } else if (prevRec && prevRec.pendingSince) {
        // breach pending but cleared before delay => drop pending
        next[p.id] = { ...prevRec, pendingSince: 0, lastAt: now, quality }
        if (prevRec.count === undefined) delete next[p.id]
      }
    }
  }
  // comm alarms: one per connection where polling lastOk === false or enabled connection has no recent poll (lastAt 0 and enabled? not comm)
  if (pollingByConnection && typeof pollingByConnection === 'object') {
    for (const [cid, st] of Object.entries(pollingByConnection)) {
      const conn = Array.isArray(connections) ? connections.find(c => c.id === cid) : null
      const connName = conn ? conn.name : cid
      const commId = 'comm:' + cid
      const isFail = st && st.lastOk === false
      const prevComm = next[commId]
      if (isFail) {
        if (!prevComm || prevComm.condition === COND_RECOVERED) {
          const withinSuppress = prevComm && prevComm.suppressUntil && now < prevComm.suppressUntil
          const cnt = withinSuppress ? prevComm.count + 1 : 1
          const firstAt = withinSuppress ? prevComm.firstAt : now
          next[commId] = { id: commId, group: COMM, condition: COND_ACTIVE, acknowledged: false, ackedAt: 0, ackedBy: '', suggestedAt: 0, suggestedBy: '', status: ACTIVE, kind: 'commFail', pointId: '', connectionId: cid, deviceId: '', frameId: textId(opts && opts.frameId) || (prevComm ? prevComm.frameId : ''), transactionId: textId(opts && opts.transactionId) || (prevComm ? prevComm.transactionId : ''), taskId: textId(opts && opts.taskId) || (prevComm ? prevComm.taskId : ''), value: st.error || 'comm fail', threshold: null, quality: 'bad', firstAt, lastAt: now, recoveredAt: 0, durationMs: 0, count: cnt, severity: 'high', suppressUntil: 0, pendingSince: 0, label: connName }
          if (!prevComm || prevComm.condition !== COND_ACTIVE) fired.push({ connectionId: cid, label: connName, kind: 'commFail', alarm: next[commId] })
        } else if (prevComm.condition === COND_ACTIVE) {
          next[commId] = { ...prevComm, lastAt: now, value: st.error || 'comm fail' }
        }
      } else {
        if (prevComm && prevComm.condition === COND_ACTIVE) {
          const ra = now
          next[commId] = { ...prevComm, condition: COND_RECOVERED, status: prevComm.acknowledged ? ACKED : RECOVERED, recoveredAt: ra, durationMs: Math.max(0, ra - prevComm.firstAt), lastAt: now, suppressUntil: now + suppressMs }
          recoveredList.push({ connectionId: cid, alarm: next[commId] })
        }
      }
    }
  }
  // prune acked older than 7 days? keep bounded
  const keys = Object.keys(next)
  if (keys.length > capAlarm) {
    const sorted = keys.map(k => [k, next[k]]).sort((a,b)=> (a[1].lastAt||0)-(b[1].lastAt||0))
    for (let i=0; i < sorted.length - capAlarm; i++) delete next[sorted[i][0]]
  }
  return { next, fired, cleared: recoveredList, recovered: recoveredList, active: Object.values(next).filter(a=>a.condition===COND_ACTIVE && !a.acknowledged), recoveredList }
}
