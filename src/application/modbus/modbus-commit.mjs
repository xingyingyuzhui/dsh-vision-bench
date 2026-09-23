// @ts-check
import { randomUUID } from 'node:crypto'
import { evaluateAlarms } from '../../domain/modbus/alarm-model.mjs'
import { COND_ACTIVE, PROCESS } from '../../domain/modbus/alarm-constants.mjs'
import { normalizePolling } from '../../domain/modbus/frames-buffer.mjs'
import { normalizeModbus } from './modbus-migration.mjs'
import { workspaceRepository } from '../../infrastructure/store/workspace-store.mjs'
import { sampleTrendValues } from './trend-store.mjs'
import {
  normalizeSessionConfigs,
  unionScopedConnections,
  unionScopedDevices,
  unionScopedPoints,
} from '../../domain/modbus/config-scope.mjs'

/**
 * @param {any} [current]
 * @param {any} [incoming]
 * @returns {any}
 */
const mergePointValues = (current, incoming) => {
  const byId = new Map()
  for (const rec of Array.isArray(current) ? current : []) {
    const id = rec && (rec.pointId || rec.key)
    if (id) byId.set(id, rec)
  }
  for (const rec of Array.isArray(incoming) ? incoming : []) {
    const id = rec && (rec.pointId || rec.key)
    if (!id) continue
    byId.set(id, rec)
  }
  return [...byId.values()]
}

/**
 * @param {any} [map]
 * @param {any} [connectionId]
 * @param {any} [frame]
 * @returns {any}
 */
const appendFrame = (map, connectionId, frame) => {
  const cid = String(connectionId || '')
  if (!cid || !frame) return map
  const next = { ...(map || {}) }
  const ring = Array.isArray(next[cid]) ? next[cid].slice() : []
  ring.push(frame)
  next[cid] = ring.slice(-500)
  return next
}

/**
 * Stamp a committed `alarms.fired` transition with a stable notify identity.
 * `eventId` is generated once per committed migration (not alarm.id / firstAt);
 * all subscribers and retries reuse the same id. `at` is this transition time.
 *
 * @param {any} item
 * @returns {any}
 */
export const stampAlarmTransitionIdentity = (item) => {
  if (!item || typeof item !== 'object') return item
  const transitionAt =
    Number(item.at) ||
    Number(item.eventAt) ||
    Number(item.commitSeq) ||
    Number(item.alarm?.lastAt) ||
    Number(item.alarm?.firstAt) ||
    Date.now()
  return {
    ...item,
    eventId: item.eventId || item.alarm?.eventId || randomUUID(),
    at: transitionAt,
    eventAt: transitionAt,
  }
}

/**
 * Drop process alarms whose point no longer exists (avoid ghost alarmActive).
 * @param {Record<string, any>} [state]
 * @param {any[]} [points]
 * @returns {Record<string, any>}
 */
export const pruneAlarmStateForPoints = (state, points) => {
  const live = new Set((Array.isArray(points) ? points : []).map((/** @type {any} */ p) => p && p.id).filter(Boolean))
  const next = { ...(state || {}) }
  for (const [key, alarm] of Object.entries(next)) {
    if (!alarm || typeof alarm !== 'object') continue
    if (String(key).startsWith('comm:')) continue
    if (alarm.group && alarm.group !== PROCESS) continue
    const pid = alarm.pointId || key
    if (pid && !live.has(pid)) delete next[key]
  }
  return next
}

/**
 * @param {Record<string, any>} [state]
 * @param {any[]} [points]
 * @returns {Record<string, true>}
 */
export const alarmActiveFromState = (state, points) => {
  const live = new Set((Array.isArray(points) ? points : []).map((/** @type {any} */ p) => p && p.id).filter(Boolean))
  return Object.fromEntries(
    Object.entries(state || {})
      .filter(([key, alarm]) => {
        if (!alarm || alarm.condition !== COND_ACTIVE || alarm.group !== PROCESS) return false
        const pid = alarm.pointId || key
        return !!(pid && live.has(pid))
      })
      .map(([key]) => [key, true]),
  )
}

/**
 * @param {any} [home]
 * @param {any} [cwd]
 * @param {any} [frame]
 * @returns {any}
 */
export const appendTransactionFrame = (home, cwd, frame) =>
  workspaceRepository(home).mutateRuntime(cwd, (/** @type {any} */ ws) => {
    const pack = normalizeModbus(ws.modbus)
    const framesByConnection = appendFrame(pack.framesByConnection, frame && frame.connectionId, frame)
    return { workspace: { ...ws, modbus: { ...ws.modbus, framesByConnection, version: 3 } } }
  })

/**
 * Stamp lastAt/lastOk/error only. The tick must not write enabled or
 * intervalMs — those can change while the read is in flight — and must not
 * recreate a polling row whose connection was deleted before commit.
 *
 * @param {any} pack
 * @param {any[]} connections
 * @param {Record<string, any>} runtime
 */
const mergePollingRuntime = (pack, connections, runtime) => {
  const next = { ...(pack.pollingByConnection || {}) }
  const live = new Set((connections || []).map((/** @type {any} */ c) => c && c.id).filter(Boolean))
  for (const [cid, stamp] of Object.entries(runtime || {})) {
    if (!live.has(cid)) continue
    const base = next[cid] || normalizePolling(null)
    next[cid] = {
      ...base,
      lastAt: stamp?.lastAt,
      lastOk: stamp?.lastOk,
      error: stamp?.error,
    }
  }
  return next
}

/**
 * @param {any} [home]
 * @param {any} [cwd]
 * @param {any} [input]
 * @param {any} [kind]
 * @returns {Promise<any>}
 */
const commit = (home, cwd, input, kind) =>
  workspaceRepository(home).mutateRuntime(cwd, (/** @type {any} */ ws) => {
    const pack = normalizeModbus(ws.modbus)
    const sessionConfigs = normalizeSessionConfigs(pack.sessionConfigs)
    const share = pack.share
    const points = unionScopedPoints(pack.points, sessionConfigs, share)
    const connections = unionScopedConnections(pack.connections, sessionConfigs, share)
    const devices = unionScopedDevices(pack.devices, sessionConfigs, share)
    const cid = String((input && input.connectionId) || '')
    const did = String((input && input.deviceId) || '')
    const connOk = !cid || connections.some((/** @type {any} */ c) => c.id === cid)
    const devOk = !did || devices.some((/** @type {any} */ d) => d.id === did)
    const drift =
      (input &&
        input.baseConfigVersion &&
        pack.configVersion &&
        Number(input.baseConfigVersion) !== Number(pack.configVersion)) ||
      !connOk ||
      !devOk
    let values = pack.values
    if (!drift && input && Array.isArray(input.pointValues) && input.pointValues.length) {
      const allowed = new Set(points.map((/** @type {any} */ p) => p.id))
      const incoming = input.pointValues.filter((/** @type {any} */ rec) => rec && allowed.has(rec.pointId || rec.key))
      values = mergePointValues(pack.values, incoming)
    }
    let framesByConnection = pack.framesByConnection
    if (input && Array.isArray(input.frames) && input.frames.length) {
      for (const rawFrame of input.frames) {
        if (!rawFrame) continue
        const frameCid = String(rawFrame.connectionId || cid || '')
        const frame = drift ? { ...rawFrame, status: 'error', error: 'CONFIG_DRIFT' } : rawFrame
        if (!frameCid || connections.some((/** @type {any} */ c) => c.id === frameCid) || drift) {
          framesByConnection = appendFrame(framesByConnection, frameCid, frame)
        }
      }
    } else if (input && input.frame) {
      const frame = drift ? { ...input.frame, status: 'error', error: 'CONFIG_DRIFT' } : input.frame
      if (!cid || connections.some((/** @type {any} */ c) => c.id === cid) || drift) {
        framesByConnection = appendFrame(pack.framesByConnection, cid, frame)
      }
    }
    const pollingByConnection =
      (kind === 'poll' && input && input.pollingRuntime
        ? mergePollingRuntime(pack, connections, input.pollingRuntime)
        : pack.pollingByConnection) || pack.pollingByConnection
    const alarmEval = evaluateAlarms({
      points,
      values,
      prevState: pack.alarmState || pack.alarmActive,
      pollingByConnection,
      connections,
      opts: { deadband: 1 },
    })
    const alarmState = pruneAlarmStateForPoints(alarmEval.next, points)
    const alarmActive = alarmActiveFromState(alarmState, points)
    const fired = (alarmEval.fired || []).filter((/** @type {any} */ item) => {
      if (item?.point) return points.some((/** @type {any} */ p) => p.id === item.point.id)
      return true
    })
    const recovered = (alarmEval.recovered || []).filter((/** @type {any} */ item) => {
      if (item?.point) return points.some((/** @type {any} */ p) => p.id === item.point.id)
      return true
    })
    // Task3/0.19.3: 采样发生在提交阶段 — 与页面是否打开无关
    const pointsById = Object.fromEntries((points || []).map((/** @type {any} */ p) => [p.id, p]))
    const trend = sampleTrendValues(pack.trend || {}, !drift && input ? input.pointValues : [], pointsById)
    const patch = /** @type {Record<string, any>} */ ({
      values,
      framesByConnection,
      trend,
      version: 3,
    })
    if (kind === 'poll' && input && input.pollingRuntime) {
      patch.pollingByConnection = pollingByConnection
    }
    // Always persist alarm maps from the committed values snapshot. On config
    // drift we still refresh alarms from disk values (e.g. sim write already
    // patched values), but suppress fired/recovered so callers do not notify.
    patch.alarmState = alarmState
    patch.alarmActive = alarmActive
    return {
      workspace: { ...ws, modbus: { ...ws.modbus, ...patch } },
      drift: !!drift,
      alarms: {
        fired: drift ? [] : fired.map(stampAlarmTransitionIdentity),
        recovered: drift ? [] : recovered,
        alarmState,
        alarmActive,
      },
    }
  })

/**
 * @param {any} [home]
 * @param {any} [cwd]
 * @param {any} [result]
 * @returns {Promise<any>}
 */
export const commitReadResult = (home, cwd, result) => commit(home, cwd, result, 'read')
/**
 * @param {any} [home]
 * @param {any} [cwd]
 * @param {any} [result]
 * @returns {Promise<any>}
 */
export const commitWriteResult = (home, cwd, result) => commit(home, cwd, result, 'write')
/**
 * @param {any} [home]
 * @param {any} [cwd]
 * @param {any} [result]
 * @returns {Promise<any>}
 */
export const commitPollResult = (home, cwd, result) => commit(home, cwd, result, 'poll')
