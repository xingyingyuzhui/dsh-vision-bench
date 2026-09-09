// @ts-check
import { normalizePointV3 } from '../../../bench-devices.mjs'
import { explicitId } from '../../domain/config/config-operation.mjs'
import { applyPointPatch } from '../../domain/modbus/point-patch.mjs'
import { resolveHierarchy } from '../../domain/modbus/target-resolver.mjs'

/**
 * @param {any} list
 * @returns {any}
 */
export function idsOfPoints(list) {
  return (Array.isArray(list) ? list : []).map((/** @type {any} */ p) => p?.id).filter(Boolean)
}

/**
 * @param {any} components
 * @param {any} pointIds
 * @returns {any}
 */
export function vizAffected(components, pointIds) {
  const set = new Set(pointIds)
  return (components || [])
    .filter((/** @type {any} */ c) => (c.pointIds || []).some((/** @type {any} */ id) => set.has(id)))
    .map((/** @type {any} */ c) => c.id)
}

/**
 * @param {any} alarmState
 * @param {any} pointIds
 * @returns {any}
 */
export function alarmAffected(alarmState, pointIds) {
  const set = new Set(pointIds)
  return Object.keys(alarmState || {}).filter((/** @type {any} */ id) => set.has(id))
}

/**
 * @param {any} pack
 * @param {any} removedIds
 * @returns {any}
 */
export function scrubPointRuntime(pack, removedIds) {
  const drop = new Set(removedIds)
  pack.values = (pack.values || []).filter((/** @type {any} */ v) => !drop.has(v.key || v.pointId))
  const trend = { ...(pack.trend || {}) }
  for (const id of drop) delete trend[id]
  pack.trend = trend
  const alarmState = { ...(pack.alarmState || {}) }
  const alarmActive = { ...(pack.alarmActive || {}) }
  for (const id of drop) {
    delete alarmState[id]
    delete alarmActive[id]
  }
  pack.alarmState = alarmState
  pack.alarmActive = alarmActive
}

/**
 * @param {any} workspace
 * @param {any} changedPointIds
 * @param {any} summary
 * @returns {any}
 */
export function finishPoints(workspace, changedPointIds, summary) {
  const pack = workspace.modbus
  return {
    ok: true,
    workspace,
    summary,
    changedIds: changedPointIds,
    changedPointIds,
    affectedVisualizations: vizAffected(pack.visualization?.components, changedPointIds),
    affectedAlarms: alarmAffected(pack.alarmState, changedPointIds),
  }
}

/**
 * @param {any} workspace
 * @param {any} op
 * @param {any} target
 * @param {any} value
 * @returns {any}
 */
export function applyPoints(workspace, op, target, value) {
  const pack = workspace.modbus
  const cid = explicitId(target.connectionId || value.connectionId || value.connId)
  const did = explicitId(target.deviceId || value.deviceId)
  if (op === 'clear') {
    if (!cid || !did) {
      return { ok: false, errorCode: 'TARGET_REQUIRED', error: 'clear 必须明确 connectionId 与 deviceId' }
    }
    const scoped = resolveHierarchy(pack, { connectionId: cid, deviceId: did })
    if (!scoped.ok) return scoped
    const removed = pack.points.filter((/** @type {any} */ p) => p.connectionId === cid && p.deviceId === did)
    pack.points = pack.points.filter((/** @type {any} */ p) => !(p.connectionId === cid && p.deviceId === did))
    const removedIds = idsOfPoints(removed)
    scrubPointRuntime(pack, removedIds)
    return finishPoints(workspace, removedIds, `清空点位 ${cid}/${did} ${removedIds.length} 个`)
  }
  if (op === 'remove') {
    const ids = Array.isArray(value.ids) ? value.ids.map(String) : []
    const one = explicitId(target.pointId || value.id || value.pointId)
    if (one) ids.push(one)
    if (!ids.length) return { ok: false, errorCode: 'TARGET_REQUIRED', error: 'remove 必须携带 pointId' }
    for (const pid of ids) {
      const scoped = resolveHierarchy(pack, {
        connectionId: cid || undefined,
        deviceId: did || undefined,
        pointId: pid,
      })
      if (!scoped.ok) return scoped
    }
    const idSet = new Set(ids)
    const removed = pack.points.filter((/** @type {any} */ p) => idSet.has(p.id))
    if (!removed.length) return { ok: false, errorCode: 'POINT_NOT_FOUND', error: '没有匹配的点位' }
    pack.points = pack.points.filter((/** @type {any} */ p) => !idSet.has(p.id))
    scrubPointRuntime(pack, idsOfPoints(removed))
    return finishPoints(workspace, idsOfPoints(removed), `删除点位 ${ids.join(',')}`)
  }
  if (op === 'add' || op === 'update') {
    const inputs = Array.isArray(value.points)
      ? value.points
      : value.point
        ? [value.point]
        : value.id || value.function
          ? [value]
          : []
    if (!inputs.length) return { ok: false, error: '缺少 points 或 point' }
    const changed = []
    let points = pack.points.slice()
    for (const input of inputs) {
      const raw = { ...(input || {}) }
      if (op === 'add') {
        const inCid = explicitId(raw.connectionId || raw.connId) || cid
        const inDid = explicitId(raw.deviceId) || did
        const scoped = resolveHierarchy(pack, { connectionId: inCid, deviceId: inDid })
        if (!scoped.ok) return scoped
        raw.connectionId = inCid
        raw.deviceId = inDid
        const next = normalizePointV3(raw)
        if (
          points.some((/** @type {any} */ p) => p.id === next.id) ||
          points.some(
            (/** @type {any} */ p) =>
              p.connectionId === next.connectionId &&
              p.deviceId === next.deviceId &&
              p.function === next.function &&
              p.address === next.address,
          )
        ) {
          return { ok: false, error: `点位已存在: ${next.id}` }
        }
        points = points.concat([next])
        changed.push(next.id)
      } else {
        const pid = explicitId(raw.id || target.pointId)
        if (!pid) return { ok: false, errorCode: 'TARGET_REQUIRED', error: 'update 必须携带 pointId' }
        const scoped = resolveHierarchy(pack, {
          connectionId: cid || explicitId(raw.connectionId || raw.connId) || undefined,
          deviceId: did || explicitId(raw.deviceId) || undefined,
          pointId: pid,
        })
        if (!scoped.ok) return scoped
        const idx = points.findIndex((/** @type {any} */ p) => p.id === pid)
        const existing = points[idx]
        const patched = applyPointPatch(existing, raw)
        if (!patched.ok) return patched
        points[idx] = {
          ...existing,
          ...patched.point,
          id: existing.id,
          connectionId: existing.connectionId,
          deviceId: existing.deviceId,
        }
        changed.push(existing.id)
      }
    }
    pack.points = points
    return finishPoints(workspace, changed, `${op === 'add' ? '添加' : '更新'}点位 ${changed.join(',')}`)
  }
  return { ok: false, errorCode: 'UNKNOWN_OP', error: 'points op 必须是 add|update|remove|clear' }
}

/**
 * @param {any} workspace
 * @param {any} op
 * @param {any} target
 * @param {any} value
 * @returns {any}
 */
export function applyFlags(workspace, op, target, value) {
  if (op !== 'update') return { ok: false, errorCode: 'UNKNOWN_OP', error: 'flags 仅支持 update' }
  const pid = explicitId(target.pointId || value.pointId || value.id)
  if (!pid) return { ok: false, errorCode: 'TARGET_REQUIRED', error: 'flags.update 必须携带 pointId' }
  const src = value && typeof value === 'object' ? value : {}
  const hasMonitor = src.monitorEnabled !== undefined
  const hasAlarm = src.alarmEnabled !== undefined
  if (!hasMonitor && !hasAlarm) {
    return { ok: false, error: '缺少 monitorEnabled 或 alarmEnabled' }
  }
  if (hasMonitor && typeof src.monitorEnabled !== 'boolean') {
    return { ok: false, error: 'monitorEnabled 必须是布尔值' }
  }
  if (hasAlarm && typeof src.alarmEnabled !== 'boolean') {
    return { ok: false, error: 'alarmEnabled 必须是布尔值' }
  }
  const pack = workspace.modbus
  const scoped = resolveHierarchy(pack, {
    connectionId: explicitId(target.connectionId),
    deviceId: explicitId(target.deviceId),
    pointId: pid,
  })
  if (!scoped.ok) return scoped
  const idx = pack.points.findIndex((/** @type {any} */ p) => p.id === pid)
  /** @type {{ monitorEnabled?: boolean, alarmEnabled?: boolean }} */
  const patch = {}
  if (hasMonitor) patch.monitorEnabled = src.monitorEnabled
  if (hasAlarm) patch.alarmEnabled = src.alarmEnabled
  const patched = applyPointPatch(pack.points[idx], patch)
  if (!patched.ok) return patched
  pack.points = pack.points.map((/** @type {any} */ p, /** @type {any} */ i) => (i === idx ? patched.point : p))
  return finishPoints(workspace, [pid], `更新点位开关 ${pid}`)
}
