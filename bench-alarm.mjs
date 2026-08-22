// bench-alarm: tri-state alarm model (active/recovered/acked) with process/comm grouping, deadband/delay/dedup
import { evaluateAlarm, decodeValue, pointLabel } from './bench-points.mjs'

export const ACTIVE = 'active'
export const RECOVERED = 'recovered'
export const ACKED = 'acked'
export const ALARM_STATUS = { ACTIVE, RECOVERED, ACKED }

export const PROCESS = 'process'
export const COMM = 'comm'
export const ALARM_GROUP = { PROCESS, COMM }

const ALLOWED_STATUS = new Set([ACTIVE, RECOVERED, ACKED])
const ALLOWED_GROUP = new Set([PROCESS, COMM])

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
      out[id] = { id, group: PROCESS, status: ACTIVE, kind: 'max', pointId: id, connectionId: '', deviceId: '', value: null, threshold: null, quality: 'good', firstAt: nowMs(), lastAt: nowMs(), count: 1 }
      continue
    }
    if (rawVal === false || rawVal == null) continue
    if (typeof rawVal === 'object') {
      // allow bare boolean-like object {active:true} legacy
      if (rawVal && rawVal.active === true && !rawVal.status) {
        out[id] = { id, group: PROCESS, status: ACTIVE, kind: rawVal.kind || 'max', pointId: id, connectionId: textId(rawVal.connectionId), deviceId: textId(rawVal.deviceId), value: rawVal.value ?? null, threshold: rawVal.threshold ?? null, quality: rawVal.quality || 'good', firstAt: Number(rawVal.firstAt) || nowMs(), lastAt: Number(rawVal.lastAt) || nowMs(), count: Number(rawVal.count) > 0 ? Math.trunc(rawVal.count) : 1 }
        continue
      }
      const group = ALLOWED_GROUP.has(rawVal.group) ? rawVal.group : (id.startsWith('comm:') ? COMM : PROCESS)
      let status = ALLOWED_STATUS.has(rawVal.status) ? rawVal.status : ACTIVE
      // legacy active flag maps to status
      if (rawVal.status === undefined && typeof rawVal.acked === 'boolean') status = rawVal.acked ? ACKED : ACTIVE
      const firstAt = Number(rawVal.firstAt) > 0 ? Number(rawVal.firstAt) : (Number(rawVal.at) > 0 ? Number(rawVal.at) : nowMs())
      const lastAt = Number(rawVal.lastAt) > 0 ? Number(rawVal.lastAt) : firstAt
      const pointId = textId(rawVal.pointId || (group === PROCESS ? id : ''))
      const connectionId = textId(rawVal.connectionId || rawVal.connId || '')
      const deviceId = textId(rawVal.deviceId || '')
      // enrich from pointsById if available
      let fallbackConn = connectionId, fallbackDev = deviceId
      if (pointsById && pointId && pointsById[pointId]) { fallbackConn = pointsById[pointId].connectionId || fallbackConn; fallbackDev = pointsById[pointId].deviceId || fallbackDev }
      out[id] = {
        id,
        group,
        status,
        kind: typeof rawVal.kind === 'string' ? rawVal.kind.slice(0, 16) : '',
        pointId,
        connectionId: fallbackConn,
        deviceId: fallbackDev,
        value: rawVal.value !== undefined ? rawVal.value : (rawVal.raw !== undefined ? rawVal.raw : null),
        threshold: rawVal.threshold !== undefined ? rawVal.threshold : null,
        quality: typeof rawVal.quality === 'string' ? rawVal.quality.slice(0, 16) : 'good',
        firstAt,
        lastAt,
        count: Number(rawVal.count) > 0 ? Math.min(9999, Math.trunc(rawVal.count)) : 1,
        ackedAt: Number(rawVal.ackedAt) > 0 ? Number(rawVal.ackedAt) : 0,
        suppressUntil: Number(rawVal.suppressUntil) > 0 ? Number(rawVal.suppressUntil) : 0,
        pendingSince: Number(rawVal.pendingSince) > 0 ? Number(rawVal.pendingSince) : 0,
      }
    }
  }
  return out
}

export function groupAlarms(alarmState) {
  const normalized = normalizeAlarmState(alarmState)
  const all = Object.values(normalized)
  const process = all.filter(a => a.group === PROCESS)
  const comm = all.filter(a => a.group === COMM)
  const active = all.filter(a => a.status === ACTIVE)
  const recovered = all.filter(a => a.status === RECOVERED)
  const acked = all.filter(a => a.status === ACKED)
  const current = active.concat(recovered.filter(a => a.status === RECOVERED))
  // current = active+recovered (not acked), history = acked + recovered? but spec says current/history two views
  const history = acked.concat(recovered)
  return { all, process, comm, active, recovered, acked, current, history, byGroup: { process, comm }, byStatus: { active, recovered, acked } }
}

export function acknowledgeAlarm(alarmState, id) {
  const norm = normalizeAlarmState(alarmState)
  const at = nowMs()
  if (id === 'all' || id === '*') {
    const next = {}
    for (const [k, v] of Object.entries(norm)) next[k] = { ...v, status: ACKED, ackedAt: at, suppressUntil: 0, pendingSince: 0 }
    return next
  }
  const key = textId(id)
  if (!key || !norm[key]) return norm
  return { ...norm, [key]: { ...norm[key], status: ACKED, ackedAt: at, suppressUntil: 0, pendingSince: 0 } }
}

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
    if (p.alarmMin == null && p.alarmMax == null) {
      // no threshold => clear if existed
      if (next[p.id] && next[p.id].group === PROCESS && next[p.id].status === ACTIVE) {
        next[p.id] = { ...next[p.id], status: RECOVERED, lastAt: now, suppressUntil: now + suppressMs, pendingSince: 0 }
        recoveredList.push({ ...next[p.id] })
      }
      continue
    }
    const rec = valueById[p.id]
    const quality = rec ? (rec.ok === true ? 'good' : (rec.error ? 'bad' : 'stale')) : 'stale'
    const prevRec = next[p.id]
    // stale/bad quality does not directly clear; keep active but update quality
    if (!rec || rec.ok !== true) {
      if (prevRec && prevRec.group === PROCESS && prevRec.status === ACTIVE) {
        next[p.id] = { ...prevRec, quality, lastAt: now, value: rec ? rec.raw ?? null : null }
      }
      continue
    }
    const raw = rec.raw
    let breachKind = evaluateAlarm(p, raw)
    // deadband: if previously active on max, need to drop below max-deadband to clear; similarly min
    if (!breachKind && prevRec && prevRec.status === ACTIVE && deadband > 0) {
      const n = Number(raw)
      if (prevRec.kind === 'max' && p.alarmMax != null && Number.isFinite(n)) {
        if (n > (p.alarmMax - deadband)) breachKind = 'max'
      } else if (prevRec.kind === 'min' && p.alarmMin != null && Number.isFinite(n)) {
        if (n < (p.alarmMin + deadband)) breachKind = 'min'
      }
    }
    const engVal = decodeValue(p, raw)
    const threshold = breachKind === 'max' ? p.alarmMax : (breachKind === 'min' ? p.alarmMin : null)
    if (breachKind) {
      // delay: need persistent breach for delayMs
      if (delayMs > 0) {
        const pend = prevRec && prevRec.pendingSince ? prevRec.pendingSince : 0
        if (!pend) {
          next[p.id] = { ...(prevRec || { id: p.id, group: PROCESS, pointId: p.id, connectionId: p.connectionId || '', deviceId: p.deviceId || '' }), group: PROCESS, status: prevRec ? prevRec.status : ACTIVE, kind: breachKind, pendingSince: now, firstAt: prevRec ? prevRec.firstAt : now, lastAt: now, value: engVal, threshold, quality, count: prevRec ? prevRec.count : 1, connectionId: p.connectionId || (prevRec && prevRec.connectionId) || '', deviceId: p.deviceId || (prevRec && prevRec.deviceId) || '' }
          // not yet fired
          continue
        }
        if (now - pend < delayMs) {
          next[p.id] = { ...(prevRec || {}), pendingSince: pend, lastAt: now, value: engVal, threshold, quality }
          continue
        }
      }
      // breach confirmed
      if (!prevRec || prevRec.status === ACKED || prevRec.status === RECOVERED) {
        // suppress window merging: if recovered recently within window, treat as same incident count++
        const withinSuppress = prevRec && prevRec.suppressUntil && now < prevRec.suppressUntil
        const base = withinSuppress ? prevRec : null
        const count = base ? (base.count + 1) : 1
        const firstAt = base ? base.firstAt : now
        // if previously acked but suppress window still, keep count? just restart
        next[p.id] = { id: p.id, group: PROCESS, status: ACTIVE, kind: breachKind, pointId: p.id, connectionId: p.connectionId || '', deviceId: p.deviceId || '', value: engVal, threshold, quality, firstAt, lastAt: now, count, ackedAt: 0, suppressUntil: 0, pendingSince: 0 }
        // dedup: if withinSuppress and previous status was recovered, don't double-fire as new? but spec says 去重（抑制窗口合并）=> count++ and update, still fired but merged
        if (!base || prevRec.status !== ACTIVE) fired.push({ point: p, raw, kind: breachKind, alarm: next[p.id] })
        else {
          // already active and within suppress? already handled elsewhere; this branch is acked/recovered -> new firing, still record
        }
      } else if (prevRec.status === ACTIVE) {
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
      // no breach => clear if active
      if (prevRec && prevRec.status === ACTIVE) {
        next[p.id] = { ...prevRec, status: RECOVERED, lastAt: now, value: engVal, threshold: null, quality, suppressUntil: now + suppressMs, pendingSince: 0 }
        recoveredList.push({ point: p, raw, alarm: next[p.id] })
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
        if (!prevComm || prevComm.status === RECOVERED || prevComm.status === ACKED) {
          const withinSuppress = prevComm && prevComm.suppressUntil && now < prevComm.suppressUntil
          const cnt = withinSuppress ? prevComm.count + 1 : 1
          const firstAt = withinSuppress ? prevComm.firstAt : now
          next[commId] = { id: commId, group: COMM, status: ACTIVE, kind: 'commFail', pointId: '', connectionId: cid, deviceId: '', value: st.error || 'comm fail', threshold: null, quality: 'bad', firstAt, lastAt: now, count: cnt, ackedAt: 0, suppressUntil: 0, pendingSince: 0, label: connName }
          if (!prevComm || prevComm.status !== ACTIVE) fired.push({ connectionId: cid, label: connName, kind: 'commFail', alarm: next[commId] })
        } else if (prevComm.status === ACTIVE) {
          next[commId] = { ...prevComm, lastAt: now, value: st.error || 'comm fail' }
        }
      } else {
        if (prevComm && prevComm.status === ACTIVE) {
          next[commId] = { ...prevComm, status: RECOVERED, lastAt: now, suppressUntil: now + suppressMs }
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
  return { next, fired, cleared: recoveredList, recovered: recoveredList, active: Object.values(next).filter(a=>a.status===ACTIVE), recoveredList }
}
