// @ts-check
import { ERROR_CODES } from './errors.mjs'
import { portKey } from './port-key.mjs'

/**
 * @param {any} pack
 * @param {any} cid
 * @param {any} did
 * @returns {any}
 */
export const deviceDisabledOf = (pack, cid, did) => {
  const conn = (pack.connections || []).find((/** @type {any} */ c) => c.id === cid)
  if (conn && conn.enabled === false) return true
  const dev = (pack.devices || []).find((/** @type {any} */ d) => d.id === did)
  if (dev && dev.enabled === false) return true
  return false
}

/**
 * @param {any} origin
 * @param {any} pack
 * @param {any} cidArg
 * @param {any} didArg
 * @returns {any}
 */
export const targetRequired = (origin, pack, cidArg, didArg) => {
  if (!origin || origin.source !== 'agent') return null
  const enabledConns = (pack.connections || []).filter((/** @type {any} */ c) => c.enabled !== false)
  if (!cidArg && enabledConns.length > 1) return { error: '缺少 connectionId', errorCode: ERROR_CODES.TARGET_REQUIRED }
  if (!didArg && (cidArg || enabledConns.length === 1)) {
    const scopeCid = cidArg || enabledConns[0].id
    const enabledDevs = (pack.devices || []).filter(
      (/** @type {any} */ d) => d.connectionId === scopeCid && d.enabled !== false,
    )
    if (enabledDevs.length > 1) return { error: '缺少 deviceId', errorCode: ERROR_CODES.TARGET_REQUIRED }
  }
  return null
}

export const CONN_PATCH_KEYS = ['mode', 'port', 'baudrate', 'bytesize', 'parity', 'stopbits', 'host', 'tcpPort', 'sim']

/**
 * @param {any} raw
 * @returns {any}
 */
export const pickConnPatch = (raw) => {
  /** @type {Record<string, unknown>} */
  const out = {}
  if (!raw || typeof raw !== 'object') return out
  for (const key of CONN_PATCH_KEYS) {
    if (raw[key] !== undefined) out[key] = raw[key]
  }
  return out
}

/**
 * @param {any} conn
 * @returns {any}
 */
export const connReady = (conn) => {
  if (!conn) return { error: '连接不存在' }
  if (conn.mode === 'rtu' && !portKey(conn.port) && conn.sim !== true) return { error: 'RTU 需要串口' }
  if (conn.mode === 'tcp' && !conn.host && conn.sim !== true) return { error: 'TCP 需要主机地址' }
  return { ok: true }
}
