// @ts-check
import { ERROR_CODES } from './errors.mjs'

/**
 * @param {any} value
 * @returns {any}
 */
const idOf = (value) => (typeof value === 'string' ? value.trim() : '')

/**
 * Resolve connection → device → point hierarchy.
 * @param {any} pack
 * @param {any} [target]
 */
export function resolveHierarchy(pack, target = {}) {
  const cid = idOf(target.connectionId || target.connId)
  const did = idOf(target.deviceId)
  const pid = idOf(target.pointId)
  const connections = pack?.connections || []
  const devices = pack?.devices || []
  const points = pack?.points || []

  let connection = null
  if (cid) {
    connection = connections.find((/** @type {any} */ c) => c.id === cid) || null
    if (!connection) {
      return { ok: false, errorCode: ERROR_CODES.CONNECTION_NOT_FOUND, error: `连接不存在: ${cid}` }
    }
  }

  /** @type {any} */
  let device = null
  if (did) {
    device = devices.find((/** @type {any} */ d) => d.id === did) || null
    if (!device) {
      return { ok: false, errorCode: ERROR_CODES.DEVICE_NOT_FOUND, error: `设备不存在: ${did}` }
    }
    if (cid && device.connectionId !== cid) {
      return {
        ok: false,
        errorCode: ERROR_CODES.TARGET_MISMATCH,
        error: `设备 ${did} 不属于连接 ${cid}`,
      }
    }
    if (!cid) {
      connection = connections.find((/** @type {any} */ c) => c.id === device.connectionId) || connection
    }
  }

  let point = null
  if (pid) {
    point = points.find((/** @type {any} */ p) => p.id === pid) || null
    if (!point) {
      return { ok: false, errorCode: ERROR_CODES.POINT_NOT_FOUND, error: `点位不存在: ${pid}` }
    }
    if (did && point.deviceId !== did) {
      return {
        ok: false,
        errorCode: ERROR_CODES.TARGET_MISMATCH,
        error: `点位 ${pid} 不属于设备 ${did}`,
      }
    }
    if (cid && point.connectionId !== cid) {
      return {
        ok: false,
        errorCode: ERROR_CODES.TARGET_MISMATCH,
        error: `点位 ${pid} 不属于连接 ${cid}`,
      }
    }
  }

  return {
    ok: true,
    connection,
    device,
    point,
    connectionId: connection?.id || cid,
    deviceId: device?.id || did,
    pointId: point?.id || pid,
  }
}

export { deviceDisabledOf, targetRequired } from './validation.mjs'
