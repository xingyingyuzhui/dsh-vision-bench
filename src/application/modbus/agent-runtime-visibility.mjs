// @ts-check
/**
 * Agent-facing runtime visibility over layered workspace modbus.
 * Config projection (connections/points) is session-scoped; global runtime maps
 * (polling/alarm/trend/tasks) must be filtered here before Agent projection.
 * Does not mutate disk or clear other sessions' runtime slots.
 */
import { ALARM_GROUP } from '../../domain/modbus/alarm-constants.mjs'
import { resolveEffectivePointIdentity } from './poll-runtime-identity.mjs'
import {
  enumerateRawConnectionOwners,
  isUniquelyOwnedConnection,
  resolveOneConnection,
} from './poll-session-ownership.mjs'

/**
 * @param {any} layeredModbus
 * @param {string} sessionId
 * @param {any[]} connections session-visible connection rows
 * @returns {Set<string>}
 */
export function visibleUniqueConnectionIds(layeredModbus, sessionId, connections) {
  const sid = String(sessionId || '')
  const { ownersByConnectionId } = enumerateRawConnectionOwners(layeredModbus)
  /** @type {Set<string>} */
  const out = new Set()
  for (const c of Array.isArray(connections) ? connections : []) {
    const cid = String(c?.id || '').trim()
    if (!cid) continue
    if (!isUniquelyOwnedConnection(layeredModbus, cid)) continue
    const resolved = resolveOneConnection(ownersByConnectionId, cid, sid)
    if ('error' in resolved) continue
    out.add(cid)
  }
  return out
}

/**
 * @param {any} layeredModbus
 * @param {string} sessionId
 * @param {any[]} connections
 * @param {Record<string, any> | null | undefined} pollingByConnection
 * @returns {Record<string, any>}
 */
export function projectVisiblePolling(layeredModbus, sessionId, connections, pollingByConnection) {
  const visibleIds = visibleUniqueConnectionIds(layeredModbus, sessionId, connections)
  const src = pollingByConnection && typeof pollingByConnection === 'object' ? pollingByConnection : {}
  return Object.fromEntries(Object.entries(src).filter(([cid]) => visibleIds.has(String(cid))))
}

/**
 * @param {any} layeredModbus
 * @param {string} sessionId
 * @param {string} pointId
 * @returns {{ visible: boolean, reason: string }}
 */
export function pointRuntimeVisible(layeredModbus, sessionId, pointId) {
  const pid = String(pointId || '').trim()
  if (!pid) return { visible: false, reason: 'missing' }
  const identity = resolveEffectivePointIdentity(layeredModbus, pid)
  if (identity.kind === 'ambiguous') return { visible: false, reason: 'ambiguous' }
  if (identity.kind === 'missing') return { visible: false, reason: 'missing' }
  const row = identity.identities[0]
  if (!row) return { visible: false, reason: 'missing' }
  if (row.layer === 'shared' || row.layer === 'toplevel') return { visible: true, reason: 'ok' }
  if (row.layer === 'private' && row.sessionId === String(sessionId || '')) {
    return { visible: true, reason: 'ok' }
  }
  return { visible: false, reason: 'other-session' }
}

/**
 * @param {any} alarm
 * @param {string} id
 * @returns {boolean}
 */
function isCommAlarm(alarm, id) {
  const group = String(alarm?.group || '')
  if (group === ALARM_GROUP.COMM || group === 'comm') return true
  return String(id || '').startsWith('comm:')
}

/**
 * @param {any} layeredModbus
 * @param {string} sessionId
 * @param {any} pack session-projected modbus
 * @param {Record<string, any> | null | undefined} alarmState
 * @returns {Record<string, any>}
 */
export function filterAlarmStateForSession(layeredModbus, sessionId, pack, alarmState) {
  const src = alarmState && typeof alarmState === 'object' ? alarmState : {}
  const visibleConns = visibleUniqueConnectionIds(layeredModbus, sessionId, pack?.connections || [])
  const packPointIds = new Set(
    (Array.isArray(pack?.points) ? pack.points : []).map((/** @type {any} */ p) => String(p?.id || '')),
  )
  /** @type {Record<string, any>} */
  const out = {}
  for (const [id, row] of Object.entries(src)) {
    if (!row || typeof row !== 'object') continue
    if (isCommAlarm(row, id)) {
      const cid = String(
        row.connectionId || (String(id).startsWith('comm:') ? String(id).slice('comm:'.length) : '') || '',
      ).trim()
      if (!cid || !visibleConns.has(cid)) continue
      out[id] = row
      continue
    }
    const pid = String(row.pointId || id || '').trim()
    if (!pid || !packPointIds.has(pid)) continue
    const vis = pointRuntimeVisible(layeredModbus, sessionId, pid)
    if (!vis.visible) continue
    out[id] = row
  }
  return out
}

/**
 * @param {any} layeredModbus
 * @param {string} sessionId
 * @param {any} pack
 * @param {string} alarmId
 * @param {any} hit
 * @returns {boolean}
 */
export function alarmVisibleToSession(layeredModbus, sessionId, pack, alarmId, hit) {
  if (!hit || typeof hit !== 'object') return false
  const filtered = filterAlarmStateForSession(layeredModbus, sessionId, pack, { [alarmId]: hit })
  return Object.prototype.hasOwnProperty.call(filtered, alarmId)
}

/**
 * @param {any[]} tasks
 * @param {string} sessionId
 * @returns {any[]}
 */
export function filterTasksForSession(tasks, sessionId) {
  const sid = String(sessionId || '')
  if (!sid) return []
  return (Array.isArray(tasks) ? tasks : []).filter((t) => t && String(t.sessionId || '') === sid)
}

/**
 * Agent status must not expose unattributed short-log summaries.
 * @param {any[]} log
 * @returns {{ log: any[], logHiddenCount: number }}
 */
export function redactAgentStatusLog(log) {
  const rows = Array.isArray(log) ? log : []
  return { log: [], logHiddenCount: rows.length }
}

/**
 * @param {any} layeredModbus
 * @param {string} sessionId
 * @param {any[]} series
 * @param {any[]} packPoints
 * @returns {any[]}
 */
export function scopeTrendSeriesForSession(layeredModbus, sessionId, series, packPoints) {
  const packIds = new Set(
    (Array.isArray(packPoints) ? packPoints : []).map((/** @type {any} */ p) => String(p?.id || '')),
  )
  return (Array.isArray(series) ? series : []).map((/** @type {any} */ s) => {
    const pid = String(s?.pointId || '')
    const vis = pointRuntimeVisible(layeredModbus, sessionId, pid)
    if (!pid || !vis.visible || !packIds.has(pid)) {
      return {
        pointId: pid,
        name: '',
        connectionId: '',
        deviceId: '',
        unit: '',
        dataStatus: 'unavailable',
        count: 0,
        returned: 0,
        samples: [],
        hasMore: false,
        oldestReturnedAt: 0,
      }
    }
    return s
  })
}

/**
 * Agent trend with explicit pointIds: unresolved / foreign ids become unavailable
 * rows instead of failing the whole batch.
 *
 * @param {{
 *   layeredModbus: any,
 *   sessionId: string,
 *   pack: any,
 *   pointIds: string[],
 *   resolveOne: (pid: string) => { ok: boolean },
 *   readSeries: (resolvedIds: string[]) => any[],
 * }} input
 * @returns {any[]}
 */
export function buildAgentTrendSeries(input) {
  /** @type {string[]} */
  const resolvedIds = []
  /** @type {string[]} */
  const unavailableIds = []
  for (const raw of input.pointIds) {
    const pid = String(raw || '')
    if (!pid) continue
    const rt = input.resolveOne(pid)
    if (!rt.ok) {
      unavailableIds.push(pid)
      continue
    }
    resolvedIds.push(pid)
  }
  const seriesRaw = input.readSeries(resolvedIds)
  for (const pid of unavailableIds) {
    seriesRaw.push({
      pointId: pid,
      name: '',
      connectionId: '',
      deviceId: '',
      unit: '',
      count: 0,
      returned: 0,
      samples: [],
    })
  }
  const scoped = scopeTrendSeriesForSession(
    input.layeredModbus,
    input.sessionId,
    seriesRaw,
    input.pack?.points || [],
  )
  const byPoint = new Map(scoped.map((/** @type {any} */ s) => [String(s.pointId), s]))
  const order = [...resolvedIds, ...unavailableIds]
  return order.map((pid) => {
    const hit = byPoint.get(pid)
    if (hit) return hit
    return {
      pointId: pid,
      name: '',
      connectionId: '',
      deviceId: '',
      unit: '',
      dataStatus: 'unavailable',
      count: 0,
      returned: 0,
      samples: [],
      hasMore: false,
      oldestReturnedAt: 0,
    }
  })
}
