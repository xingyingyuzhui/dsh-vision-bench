// @ts-check
/**
 * Device identity checks shared by save-time validation and poll-time routing.
 *
 * Policy (review5):
 * - deviceId must be unique WITHIN one config layer. Two rows with the same id
 *   in one array are CONFLICT — never silently deduped by endpoint/unit/name.
 * - The same deviceId in different private sessions is allowed. Isolation must
 *   hold for effective pack, request, commit and query; poll-time
 *   `resolvePointDevice` rejects any path that would mix rows.
 */
import { ERROR_CODES } from './errors.mjs'

/**
 * @typedef {{
 *   layer: string,
 *   sessionId: string,
 *   deviceId: string,
 *   connectionIds: string[],
 * }} DeviceIdConflict
 */

/**
 * Validate raw device rows of one config layer. Call BEFORE any normalize/dedupe.
 *
 * @param {any[]} devices raw candidate rows
 * @param {{ layer?: string, sessionId?: string }} [ctx]
 * @returns {{ ok: true } | { ok: false, errorCode: string, error: string, conflicts: DeviceIdConflict[] }}
 */
export function validateLayerDeviceIds(devices, ctx = {}) {
  /** @type {Map<string, string[]>} */
  const connsById = new Map()
  /** @type {Map<string, number>} */
  const countById = new Map()
  for (const d of Array.isArray(devices) ? devices : []) {
    if (!d || typeof d !== 'object') continue
    const id = String(/** @type {any} */ (d).id || '').trim()
    if (!id) continue
    countById.set(id, (countById.get(id) || 0) + 1)
    const cid = String(/** @type {any} */ (d).connectionId || /** @type {any} */ (d).connId || '')
    const list = connsById.get(id) || []
    if (cid && !list.includes(cid)) list.push(cid)
    connsById.set(id, list)
  }
  /** @type {DeviceIdConflict[]} */
  const conflicts = []
  for (const [id, n] of countById) {
    if (n > 1) {
      conflicts.push({
        layer: String(ctx.layer || 'top'),
        sessionId: String(ctx.sessionId || ''),
        deviceId: id,
        connectionIds: connsById.get(id) || [],
      })
    }
  }
  if (conflicts.length) {
    const detail = conflicts
      .map((c) => `layer=${c.layer}/${c.sessionId || '-'} deviceId=${c.deviceId} connections=${c.connectionIds.join(',') || '-'}`)
      .join('；')
    return {
      ok: false,
      errorCode: ERROR_CODES.CONFLICT,
      error: `同一配置层 deviceId 必须唯一，请重新指定唯一 deviceId 和正确 unitId：${detail}`,
      conflicts,
    }
  }
  return { ok: true }
}

/**
 * Validate every layer that this write actually touches.
 * Cross-layer same-name ids are NOT duplicates here.
 *
 * @param {any} mergedModbus candidate modbus (raw-ish, before normalize)
 * @param {{ changedTop?: boolean }} [opts]
 * @returns {{ ok: true } | { ok: false, errorCode: string, error: string, conflicts: DeviceIdConflict[] }}
 */
export function validateCandidateDeviceLayers(mergedModbus, opts = {}) {
  /** @type {DeviceIdConflict[]} */
  const conflicts = []
  const top = validateLayerDeviceIds(mergedModbus?.devices, { layer: 'top' })
  if (!top.ok) conflicts.push(...top.conflicts)
  const scMap =
    mergedModbus?.sessionConfigs && typeof mergedModbus.sessionConfigs === 'object'
      ? mergedModbus.sessionConfigs
      : {}
  for (const sid of Object.keys(scMap)) {
    const sc = scMap[sid]
    const r = validateLayerDeviceIds(sc?.devices, { layer: 'private', sessionId: sid })
    if (!r.ok) conflicts.push(...r.conflicts)
  }
  if (conflicts.length) {
    const detail = conflicts
      .map(
        (c) =>
          `layer=${c.layer}/${c.sessionId || '-'} deviceId=${c.deviceId} connections=${c.connectionIds.join(',') || '-'}`,
      )
      .join('；')
    return {
      ok: false,
      errorCode: ERROR_CODES.CONFLICT,
      error: `同一配置层 deviceId 必须唯一，请重新指定唯一 deviceId 和正确 unitId：${detail}`,
      conflicts,
    }
  }
  void opts
  return { ok: true }
}

/**
 * Resolve the device for a point inside one effective pack.
 * Must uniquely hit deviceId AND the device's connectionId must match the
 * point/request connection. Never fall back to another connection's same-name
 * device or a silent default unitId.
 *
 * @param {any} pack effective session/shared pack
 * @param {any} point
 * @param {string} connectionId request connection
 * @returns {{ ok: true, device: any } | { ok: false, errorCode: string, error: string, conflicts?: any[] }}
 */
export function resolvePointDevice(pack, point, connectionId) {
  const deviceId = String(point?.deviceId || '')
  const cid = String(connectionId || point?.connectionId || point?.connId || '')
  if (!deviceId) {
    return {
      ok: false,
      errorCode: ERROR_CODES.DEVICE_NOT_FOUND,
      error: `点位 ${point?.id || ''} 未指定 deviceId，请重新指定唯一 deviceId 和正确 unitId`,
    }
  }
  const rows = (Array.isArray(pack?.devices) ? pack.devices : []).filter(
    (/** @type {any} */ d) => d && String(d.id) === deviceId,
  )
  if (!rows.length) {
    return {
      ok: false,
      errorCode: ERROR_CODES.DEVICE_NOT_FOUND,
      error: `设备不存在: ${deviceId}（点位 ${point?.id || ''}，连接 ${cid || '-'}）— 请重新指定唯一 deviceId 和正确 unitId`,
    }
  }
  if (rows.length > 1) {
    return {
      ok: false,
      errorCode: ERROR_CODES.AMBIGUOUS_OWNER,
      error: `设备 ${deviceId} 在有效视图中不唯一（点位 ${point?.id || ''}）— 请重新指定唯一 deviceId 和正确 unitId`,
      conflicts: [
        {
          entityType: 'device',
          entityId: deviceId,
          connectionIds: [...new Set(rows.map((/** @type {any} */ d) => String(d.connectionId || '')))],
        },
      ],
    }
  }
  const device = rows[0]
  const devConn = String(device.connectionId || '')
  if (cid && devConn && devConn !== cid) {
    return {
      ok: false,
      errorCode: ERROR_CODES.TARGET_MISMATCH,
      error: `点位 ${point?.id || ''} 的设备 ${deviceId} 属于连接 ${devConn}，与请求连接 ${cid} 不一致 — 请重新指定唯一 deviceId 和正确 unitId`,
    }
  }
  return { ok: true, device }
}
