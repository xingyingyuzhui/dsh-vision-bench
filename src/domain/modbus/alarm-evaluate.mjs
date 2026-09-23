// @ts-check
import {
  ACTIVE,
  ACKED,
  COMM,
  COND_ACTIVE,
  COND_RECOVERED,
  DEFAULT_ALARM_DEADBAND_RATIO,
  PROCESS,
  RECOVERED,
  capAlarm,
  defaultSuppressMs,
  nowMs,
  textId,
} from './alarm-constants.mjs'
import { decodeValue } from './point-math.mjs'
import { evaluateAlarm } from './point-alarm.mjs'
import { normalizeAlarmState } from './alarm-lifecycle.mjs'

/**
 * An explicit opts.deadband (including 0) overrides the ratio default.
 * Omitted / blank leaves the ratio path open.
 * @param {any} opts
 * @returns {{ explicit: boolean, value: number }}
 */
function optsDeadband(opts) {
  if (!opts || !Object.prototype.hasOwnProperty.call(opts, 'deadband')) return { explicit: false, value: 0 }
  if (opts.deadband == null || opts.deadband === '') return { explicit: false, value: 0 }
  const n = Number(opts.deadband)
  return { explicit: true, value: Number.isFinite(n) && n > 0 ? n : 0 }
}

/**
 * Per-point alarmDeadband wins over both the caller deadband and the ratio default.
 * @param {any} point
 * @param {string} kind
 * @param {{ explicit: boolean, value: number }} fromOpts
 */
function deadbandFor(point, kind, fromOpts) {
  const custom = point?.alarmDeadband
  if (custom != null && custom !== '' && Number.isFinite(Number(custom)) && Number(custom) >= 0) {
    return Number(custom)
  }
  if (fromOpts.explicit) return fromOpts.value
  const threshold = kind === 'min' ? point?.alarmMin : point?.alarmMax
  const abs = Math.abs(Number(threshold))
  return Number.isFinite(abs) ? abs * DEFAULT_ALARM_DEADBAND_RATIO : 0
}

/**
 * @param {any} [arg0]
 * @returns {any}
 */
export function evaluateAlarms({ points, values, prevState, pollingByConnection, connections, opts } = {}) {
  const now = opts && Number(opts.now) > 0 ? Number(opts.now) : nowMs()
  const fromOpts = optsDeadband(opts)
  const delayMs = Number(opts && opts.delayMs) >= 0 ? Number(opts.delayMs) : 0
  const suppressMs = Number(opts && opts.suppressWindowMs) >= 0 ? Number(opts.suppressWindowMs) : defaultSuppressMs
  const prev = normalizeAlarmState(prevState)
  const next = { ...prev }
  const fired = []
  const recoveredList = []
  const pointsById = /** @type {Record<string, any>} */ ({})
  for (const p of Array.isArray(points) ? points : []) if (p && p.id) pointsById[p.id] = p
  const valueById = /** @type {Record<string, any>} */ ({})
  for (const r of Array.isArray(values) ? values : []) {
    const k = r && (r.pointId || r.key)
    if (k) valueById[k] = r
  }
  // process alarms with deadband and delay
  for (const p of Array.isArray(points) ? points : []) {
    if (!p || !p.id) continue
    // Task9/0.20.1: 告警开关是真正的总开关（显式 alarmEnabled 优先；未声明按阈值推断）。
    // 关闭 → 不进入死区/breach；激活或 pending 告警立即转 recovered，清除 pendingSince。
    const effAlarmEnabled = p.alarmEnabled === undefined ? p.alarmMin != null || p.alarmMax != null : p.alarmEnabled
    const alarmDisabled = effAlarmEnabled !== true || (p.alarmMin == null && p.alarmMax == null)
    if (alarmDisabled) {
      if (
        next[p.id] &&
        next[p.id].group === PROCESS &&
        (next[p.id].condition === COND_ACTIVE || next[p.id].pendingSince || next[p.id].status === ACTIVE)
      ) {
        const pr = next[p.id]
        const ra = now
        next[p.id] = {
          ...pr,
          condition: COND_RECOVERED,
          status: pr.acknowledged ? ACKED : RECOVERED,
          recoveredAt: ra,
          durationMs: Math.max(0, ra - pr.firstAt),
          lastAt: now,
          suppressUntil: now + suppressMs,
          pendingSince: 0,
        }
        recoveredList.push({ ...next[p.id] })
      }
      continue
    }
    const rec = valueById[p.id]
    const quality = rec ? (rec.ok === true ? 'good' : rec.error ? 'bad' : 'stale') : 'stale'
    const prevRec = next[p.id]
    if (!rec || rec.ok !== true) {
      if (prevRec && prevRec.group === PROCESS && prevRec.condition === COND_ACTIVE) {
        next[p.id] = { ...prevRec, quality, lastAt: now, value: rec ? (rec.raw ?? null) : null }
      }
      continue
    }
    const engVal = decodeValue(p, rec.raw)
    // TaskP3/0.20.0: 阈值/死区/恢复比较统一使用工程值（不再混用 raw）
    let breachKind = evaluateAlarm(p, engVal)
    if (!breachKind && prevRec && prevRec.condition === COND_ACTIVE) {
      const deadband = deadbandFor(p, prevRec.kind === 'min' ? 'min' : 'max', fromOpts)
      const n = Number(engVal)
      if (deadband > 0 && prevRec.kind === 'max' && p.alarmMax != null && Number.isFinite(n)) {
        if (n > p.alarmMax - deadband) breachKind = 'max'
      } else if (deadband > 0 && prevRec.kind === 'min' && p.alarmMin != null && Number.isFinite(n)) {
        if (n < p.alarmMin + deadband) breachKind = 'min'
      }
    }
    const threshold = breachKind === 'max' ? p.alarmMax : breachKind === 'min' ? p.alarmMin : null
    if (breachKind) {
      // delay: need persistent breach for delayMs
      if (delayMs > 0) {
        const pend = prevRec && prevRec.pendingSince ? prevRec.pendingSince : 0
        if (!pend) {
          next[p.id] = {
            ...(prevRec || {
              id: p.id,
              group: PROCESS,
              pointId: p.id,
              connectionId: p.connectionId || '',
              deviceId: p.deviceId || '',
              frameId: textId(opts && opts.frameId),
              transactionId: textId(opts && opts.transactionId),
              taskId: textId(opts && opts.taskId),
            }),
            group: PROCESS,
            condition: prevRec ? prevRec.condition : COND_ACTIVE,
            acknowledged: prevRec ? !!prevRec.acknowledged : false,
            status:
              prevRec && prevRec.acknowledged
                ? ACKED
                : prevRec && prevRec.condition === COND_RECOVERED
                  ? RECOVERED
                  : ACTIVE,
            kind: breachKind,
            pendingSince: now,
            firstAt: prevRec ? prevRec.firstAt : now,
            lastAt: now,
            value: engVal,
            threshold,
            quality,
            count: prevRec ? prevRec.count : 1,
            severity: 'high',
            connectionId: p.connectionId || (prevRec && prevRec.connectionId) || '',
            deviceId: p.deviceId || (prevRec && prevRec.deviceId) || '',
            recoveredAt: 0,
            durationMs: 0,
          }
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
        const count = base ? base.count + 1 : 1
        const firstAt = base ? base.firstAt : now
        next[p.id] = {
          id: p.id,
          group: PROCESS,
          condition: COND_ACTIVE,
          acknowledged: false,
          ackedAt: 0,
          ackedBy: '',
          suggestedAt: 0,
          suggestedBy: '',
          status: ACTIVE,
          kind: breachKind,
          pointId: p.id,
          connectionId: p.connectionId || '',
          deviceId: p.deviceId || '',
          frameId: textId((opts && opts.frameId) || ''),
          transactionId: textId((opts && opts.transactionId) || ''),
          taskId: textId((opts && opts.taskId) || ''),
          value: engVal,
          threshold,
          quality,
          firstAt,
          lastAt: now,
          recoveredAt: 0,
          durationMs: 0,
          count,
          severity: 'high',
          suppressUntil: 0,
          pendingSince: 0,
        }
        if (!base || prevRec.condition !== COND_ACTIVE)
          fired.push({ point: p, raw: rec.raw, kind: breachKind, alarm: next[p.id] })
      } else if (prevRec.condition === COND_ACTIVE) {
        // already active: update value/lastAt, handle dedup: if within suppress window, just bump count? For process active, suppress is for recovered; active just update
        // but if repeatedly firing same alarm within window while still active, we merge by counting? We keep count stable and just update time to avoid spam
        if (prevRec.kind !== breachKind) {
          next[p.id] = {
            ...prevRec,
            kind: breachKind,
            value: engVal,
            threshold,
            quality,
            lastAt: now,
            pendingSince: 0,
            count: prevRec.count,
          }
        } else {
          next[p.id] = { ...prevRec, value: engVal, threshold, quality, lastAt: now, pendingSince: 0 }
        }
        // no new fired entry (dedup)
      }
    } else {
      if (prevRec && prevRec.condition === COND_ACTIVE) {
        const ra = now
        next[p.id] = {
          ...prevRec,
          condition: COND_RECOVERED,
          status: prevRec.acknowledged ? ACKED : RECOVERED,
          recoveredAt: ra,
          durationMs: Math.max(0, ra - prevRec.firstAt),
          lastAt: now,
          value: engVal,
          threshold: null,
          quality,
          suppressUntil: now + suppressMs,
          pendingSince: 0,
        }
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
      const conn = Array.isArray(connections) ? connections.find((/** @type {any} */ c) => c.id === cid) : null
      const connName = conn ? conn.name : cid
      const commId = 'comm:' + cid
      const isFail = st && st.lastOk === false
      const prevComm = next[commId]
      if (isFail) {
        if (!prevComm || prevComm.condition === COND_RECOVERED) {
          const withinSuppress = prevComm && prevComm.suppressUntil && now < prevComm.suppressUntil
          const cnt = withinSuppress ? prevComm.count + 1 : 1
          const firstAt = withinSuppress ? prevComm.firstAt : now
          next[commId] = {
            id: commId,
            group: COMM,
            condition: COND_ACTIVE,
            acknowledged: false,
            ackedAt: 0,
            ackedBy: '',
            suggestedAt: 0,
            suggestedBy: '',
            status: ACTIVE,
            kind: 'commFail',
            pointId: '',
            connectionId: cid,
            deviceId: '',
            frameId: textId(opts && opts.frameId) || (prevComm ? prevComm.frameId : ''),
            transactionId: textId(opts && opts.transactionId) || (prevComm ? prevComm.transactionId : ''),
            taskId: textId(opts && opts.taskId) || (prevComm ? prevComm.taskId : ''),
            value: st.error || 'comm fail',
            threshold: null,
            quality: 'bad',
            firstAt,
            lastAt: now,
            recoveredAt: 0,
            durationMs: 0,
            count: cnt,
            severity: 'high',
            suppressUntil: 0,
            pendingSince: 0,
            label: connName,
          }
          if (!prevComm || prevComm.condition !== COND_ACTIVE)
            fired.push({ connectionId: cid, label: connName, kind: 'commFail', alarm: next[commId] })
        } else if (prevComm.condition === COND_ACTIVE) {
          next[commId] = { ...prevComm, lastAt: now, value: st.error || 'comm fail' }
        }
      } else {
        if (prevComm && prevComm.condition === COND_ACTIVE) {
          const ra = now
          next[commId] = {
            ...prevComm,
            condition: COND_RECOVERED,
            status: prevComm.acknowledged ? ACKED : RECOVERED,
            recoveredAt: ra,
            durationMs: Math.max(0, ra - prevComm.firstAt),
            lastAt: now,
            suppressUntil: now + suppressMs,
          }
          recoveredList.push({ connectionId: cid, alarm: next[commId] })
        }
      }
    }
  }
  // prune acked older than 7 days? keep bounded
  const keys = Object.keys(next)
  if (keys.length > capAlarm) {
    const sorted = keys.map((/** @type {any} */ k) => [k, next[k]]).sort((a, /** @type {any} */ b) => (a[1].lastAt || 0) - (b[1].lastAt || 0))
    for (let i = 0; i < sorted.length - capAlarm; i++) delete next[sorted[i][0]]
  }
  return {
    next,
    fired,
    cleared: recoveredList,
    recovered: recoveredList,
    active: Object.values(next).filter((/** @type {any} */ a) => a.condition === COND_ACTIVE && !a.acknowledged),
    recoveredList,
  }
}
