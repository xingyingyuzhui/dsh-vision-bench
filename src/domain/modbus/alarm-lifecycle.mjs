// @ts-check
import {
  ACTIVE,
  ACKED,
  COMM,
  COND_ACTIVE,
  COND_RECOVERED,
  PROCESS,
  RECOVERED,
  ALLOWED_STATUS,
  ALLOWED_GROUP,
  ALLOWED_COND,
  textBy,
  nowMs,
  capAlarm,
  textId,
} from './alarm-constants.mjs'

/**
 * @param {any} [input]
 * @param {any} [opts]
 * @returns {any}
 */
export function normalizeAlarmState(input, opts = {}) {
  const pointsById = opts.pointsById || null
  const out = /** @type {Record<string, any>} */ ({})
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out
  const entries = Object.entries(input)
  for (const [rawKey, rawVal] of entries) {
    if (Object.keys(out).length >= capAlarm) break
    const id = textId(rawKey)
    if (!id) continue
    // legacy boolean compat: true => active process alarm, false/empty => skip
    if (rawVal === true) {
      const _at = nowMs()
      out[id] = {
        id,
        group: PROCESS,
        status: ACTIVE,
        condition: COND_ACTIVE,
        acknowledged: false,
        ackedAt: 0,
        ackedBy: '',
        kind: 'max',
        pointId: id,
        connectionId: '',
        deviceId: '',
        frameId: '',
        transactionId: '',
        taskId: '',
        value: null,
        threshold: null,
        quality: 'good',
        firstAt: _at,
        lastAt: _at,
        recoveredAt: 0,
        durationMs: 0,
        count: 1,
        severity: 'high',
        suppressUntil: 0,
        pendingSince: 0,
      }
      continue
    }
    if (rawVal === false || rawVal == null) continue
    if (typeof rawVal === 'object') {
      // allow bare boolean-like object {active:true} legacy
      if (rawVal && rawVal.active === true && !rawVal.status && !rawVal.condition) {
        const _at2 = Number(rawVal.firstAt) || nowMs()
        out[id] = {
          id,
          group: PROCESS,
          status: ACTIVE,
          condition: COND_ACTIVE,
          acknowledged: false,
          ackedAt: 0,
          ackedBy: '',
          kind: rawVal.kind || 'max',
          pointId: id,
          connectionId: textId(rawVal.connectionId),
          deviceId: textId(rawVal.deviceId),
          frameId: '',
          transactionId: '',
          taskId: '',
          value: rawVal.value ?? null,
          threshold: rawVal.threshold ?? null,
          quality: rawVal.quality || 'good',
          firstAt: _at2,
          lastAt: Number(rawVal.lastAt) || _at2,
          recoveredAt: 0,
          durationMs: 0,
          count: Number(rawVal.count) > 0 ? Math.trunc(rawVal.count) : 1,
          severity: 'high',
          suppressUntil: 0,
          pendingSince: 0,
        }
        continue
      }
      const group = ALLOWED_GROUP.has(rawVal.group) ? rawVal.group : id.startsWith('comm:') ? COMM : PROCESS
      let condition = ALLOWED_COND.has(rawVal.condition) ? rawVal.condition : null
      let acknowledged = typeof rawVal.acknowledged === 'boolean' ? rawVal.acknowledged : null
      let status = ALLOWED_STATUS.has(rawVal.status) ? rawVal.status : null
      if (condition === null && status) {
        if (status === ACTIVE) condition = COND_ACTIVE
        else if (status === RECOVERED) condition = COND_RECOVERED
        else if (status === ACKED) {
          condition = COND_RECOVERED
          if (acknowledged === null) acknowledged = true
        }
      }
      if (condition === null && typeof rawVal.acked === 'boolean') {
        if (rawVal.acked) {
          condition = COND_RECOVERED
          acknowledged = true
        } else condition = COND_ACTIVE
      }
      if (condition === null) condition = COND_ACTIVE
      if (acknowledged === null) {
        if (status === ACKED) acknowledged = true
        else if (typeof rawVal.acked === 'boolean') acknowledged = !!rawVal.acked
        else acknowledged = false
      }
      const firstAt =
          Number(rawVal.firstAt) > 0 ? Number(rawVal.firstAt) : Number(rawVal.at) > 0 ? Number(rawVal.at) : nowMs(),
        lastAt = Number(rawVal.lastAt) > 0 ? Number(rawVal.lastAt) : firstAt,
        recoveredAt =
          Number(rawVal.recoveredAt) > 0 ? Number(rawVal.recoveredAt) : condition === COND_RECOVERED ? lastAt : 0,
        durationMs =
          Number(rawVal.durationMs) > 0
            ? Number(rawVal.durationMs)
            : recoveredAt
              ? Math.max(0, recoveredAt - firstAt)
              : Math.max(0, lastAt - firstAt),
        severity =
          typeof rawVal.severity === 'string' && rawVal.severity
            ? String(rawVal.severity).slice(0, 16)
            : group === COMM
              ? 'high'
              : 'medium'
      const pointId = textId(rawVal.pointId || (group === PROCESS ? id : '')),
        connectionId = textId(rawVal.connectionId || rawVal.connId || ''),
        deviceId = textId(rawVal.deviceId || '')
      let fallbackConn = connectionId,
        fallbackDev = deviceId
      if (pointsById && pointId && pointsById[pointId]) {
        fallbackConn = pointsById[pointId].connectionId || fallbackConn
        fallbackDev = pointsById[pointId].deviceId || fallbackDev
      }
      const ackedAt = Number(rawVal.ackedAt) > 0 ? Number(rawVal.ackedAt) : 0
      const ackedBy = textBy(rawVal.ackedBy || rawVal.ackBy || '')
      const derivedStatus = acknowledged ? ACKED : condition === COND_ACTIVE ? ACTIVE : RECOVERED
      out[id] = {
        id,
        group,
        status: derivedStatus,
        condition,
        acknowledged: !!acknowledged,
        ackedAt,
        ackedBy,
        suggestedAt: Number(rawVal.suggestedAt) > 0 ? Number(rawVal.suggestedAt) : 0,
        suggestedBy: textBy(rawVal.suggestedBy || ''),
        kind: typeof rawVal.kind === 'string' ? rawVal.kind.slice(0, 16) : '',
        pointId,
        connectionId: fallbackConn,
        deviceId: fallbackDev,
        frameId: textId(rawVal.frameId || ''),
        transactionId: textId(rawVal.transactionId || rawVal.txId || ''),
        taskId: textId(rawVal.taskId || ''),
        value: rawVal.value !== undefined ? rawVal.value : rawVal.raw !== undefined ? rawVal.raw : null,
        threshold: rawVal.threshold !== undefined ? rawVal.threshold : null,
        quality: typeof rawVal.quality === 'string' ? rawVal.quality.slice(0, 16) : 'good',
        firstAt,
        lastAt,
        recoveredAt,
        durationMs,
        count: Number(rawVal.count) > 0 ? Math.min(9999, Math.trunc(rawVal.count)) : 1,
        severity,
        suppressUntil: Number(rawVal.suppressUntil) > 0 ? Number(rawVal.suppressUntil) : 0,
        pendingSince: Number(rawVal.pendingSince) > 0 ? Number(rawVal.pendingSince) : 0,
      }
    }
  }
  return out
}

/**
 * @param {any} [alarmState]
 * @returns {any}
 */
export function groupAlarms(alarmState) {
  const all = Object.values(normalizeAlarmState(alarmState))
  const process = all.filter((/** @type {any} */ a) => a.group === PROCESS),
    comm = all.filter((/** @type {any} */ a) => a.group === COMM)
  const active = all.filter((/** @type {any} */ a) => a.condition === COND_ACTIVE && !a.acknowledged),
    recovered = all.filter((/** @type {any} */ a) => a.condition === COND_RECOVERED && !a.acknowledged),
    acked = all.filter((/** @type {any} */ a) => a.acknowledged)
  const activeUnacked = active,
    activeAcked = all.filter((/** @type {any} */ a) => a.condition === COND_ACTIVE && a.acknowledged),
    recoveredUnacked = recovered,
    recoveredAcked = all.filter((/** @type {any} */ a) => a.condition === COND_RECOVERED && a.acknowledged)
  const activeAll = all.filter((/** @type {any} */ a) => a.condition === COND_ACTIVE),
    recoveredAll = all.filter((/** @type {any} */ a) => a.condition === COND_RECOVERED),
    unacked = all.filter((/** @type {any} */ a) => !a.acknowledged)
  const current = active.concat(recovered),
    historyLegacy = acked.concat(recovered),
    history = recoveredAcked
  return {
    all,
    process,
    comm,
    active,
    recovered,
    acked,
    activeUnacked,
    activeAcked,
    recoveredUnacked,
    recoveredAcked,
    activeAll,
    recoveredAll,
    unacked,
    current,
    history: historyLegacy,
    historyAcked: history,
    historyConfirmed: history,
    byGroup: { process, comm },
    byStatus: { active, recovered, acked },
    byCondition: { active: activeAll, recovered: recoveredAll },
    byAck: { acked, unacked },
    buckets: { activeUnacked, activeAcked, recoveredUnacked, recoveredAcked },
  }
}

/**
 * @param {any} [alarmState]
 * @param {any} [id]
 * @param {any} [opts]
 * @returns {any}
 */
export function acknowledgeAlarm(alarmState, id, opts = {}) {
  const norm = normalizeAlarmState(alarmState)
  const at = Number(opts && opts.now) > 0 ? Number(opts.now) : nowMs()
  const byRaw =
    opts && (opts.by || opts.ackedBy || opts.actor) ? String(opts.by || opts.ackedBy || opts.actor).trim() : ''
  const by = textBy(byRaw || 'user')
  const isAgent = by === 'agent'
  if (isAgent && !(opts && opts.force)) {
    /**
     * @param {any} [k]
     * @param {any} [v]
     * @returns {any}
     */
    const handle = (k, v) => (v.acknowledged ? v : { ...v, suggestedAt: at, suggestedBy: by })
    if (id === 'all' || id === '*') {
      const nextS = /** @type {Record<string, any>} */ ({})
      for (const [k, v] of Object.entries(norm)) nextS[k] = handle(k, v)
      return { ...norm, ...nextS, _suggested: true }
    }
    const key = textId(id)
    if (!key || !norm[key]) return norm
    return { ...norm, [key]: handle(key, norm[key]), _suggested: norm[key].acknowledged ? undefined : true }
  }
  if (id === 'all' || id === '*') {
    const next = /** @type {Record<string, any>} */ ({})
    for (const [k, v] of Object.entries(norm)) {
      if (v.acknowledged) {
        next[k] = v
        continue
      }
      next[k] = { ...v, acknowledged: true, ackedAt: at, ackedBy: by, status: ACKED, suppressUntil: 0, pendingSince: 0 }
    }
    return next
  }
  const key = textId(id)
  if (!key || !norm[key]) return norm
  if (norm[key].acknowledged) return norm
  return {
    ...norm,
    [key]: {
      ...norm[key],
      acknowledged: true,
      ackedAt: at,
      ackedBy: by,
      status: ACKED,
      suppressUntil: 0,
      pendingSince: 0,
    },
  }
}

/**
 * @param {any} [s]
 * @param {any} [id]
 * @param {any} [by]
 * @returns {any}
 */
export const suggestAlarm = (s, id, by = 'agent') => acknowledgeAlarm(s, id, { by })
/**
 * @param {any} [a]
 * @param {any} [o]
 * @returns {any}
 */
export const buildAlarmRef = (a, o = {}) =>
  !a || !a.id
    ? null
    : {
        alarmId: a.id,
        pointId: a.pointId || '',
        connectionId: a.connectionId || '',
        deviceId: a.deviceId || '',
        frameId: a.frameId || '',
        transactionId: a.transactionId || '',
        taskId: a.taskId || '',
        firstAt: a.firstAt || 0,
        lastAt: a.lastAt || 0,
        recoveredAt: a.recoveredAt || 0,
        condition: a.condition || COND_ACTIVE,
        acknowledged: !!a.acknowledged,
        severity: a.severity || 'medium',
        count: a.count || 1,
        version: Number(o.configVersion) > 0 ? Number(o.configVersion) : 1,
      }
