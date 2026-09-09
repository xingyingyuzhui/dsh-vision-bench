// @ts-check
import { validateDevices } from './device-model.mjs'

const devText = (/** @type {any} */ v, fb = '') => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s || fb
}

const genId = (/** @type {string} */ prefix) =>
  prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

export const PARITY = new Set(['N', 'E', 'O'])
export const VALID_ROLES = new Set(['client', 'server'])

export const emptyConn = () => ({
  mode: 'rtu',
  port: '',
  baudrate: 9600,
  bytesize: 8,
  parity: 'N',
  stopbits: 1,
  host: '',
  tcpPort: 502,
  sim: false,
})

/** @param {any} [input] */
export const normalizeConn = (input) => {
  const out = emptyConn()
  const c = input && typeof input === 'object' ? input : {}
  out.mode = c.mode === 'tcp' ? 'tcp' : 'rtu'
  out.port = typeof c.port === 'string' ? c.port.trim() : ''
  const baud = Number(c.baudrate)
  out.baudrate = Number.isFinite(baud) && baud > 0 ? Math.trunc(baud) : 9600
  const size = Number(c.bytesize)
  out.bytesize = size === 7 ? 7 : 8
  out.parity = PARITY.has(c.parity) ? c.parity : 'N'
  const stop = Number(c.stopbits)
  out.stopbits = stop === 2 ? 2 : 1
  out.host = typeof c.host === 'string' ? c.host.trim() : ''
  const tcp = Number(c.tcpPort)
  out.tcpPort = Number.isFinite(tcp) && tcp > 0 ? Math.trunc(tcp) : 502
  // Unit ID 只属于设备；连接端点不再持久化 slave
  out.sim = c.sim === true
  return out
}

/** @param {any} conn */
export const connLabel = (conn) =>
  conn.mode === 'tcp' ? `${conn.host || '?'}:${conn.tcpPort}` : `${conn.port || '?'} @ ${conn.baudrate}`

export const emptyConnection = () => ({
  id: 'c1',
  name: '连接1',
  role: 'client',
  enabled: true,
  conn: emptyConn(),
})

/** @param {any} [input] */
export const normalizeConnection = (input) => {
  const raw = input && typeof input === 'object' ? input : {}
  const base = emptyConnection()
  const id = devText(raw.id, '') || genId('c')
  const name = devText(raw.name, '') || base.name
  const role = VALID_ROLES.has(raw.role)
    ? raw.role
    : raw.role === 'master'
      ? 'client'
      : raw.role === 'slave'
        ? 'server'
        : 'client'
  // accept legacy master/slave as role
  return {
    id,
    name: name.slice(0, 40),
    role,
    enabled: raw.enabled !== false,
    conn: normalizeConn(raw.conn || raw),
  }
}

/** @param {any} list */
export const normalizeConnections = (list) => {
  if (!Array.isArray(list)) return [normalizeConnection({ id: 'c1' })]
  const seen = new Set()
  const out = []
  for (const raw of list) {
    const c = normalizeConnection(raw)
    if (seen.has(c.id)) continue
    seen.add(c.id)
    out.push(c)
    if (out.length >= 16) break
  }
  if (!out.length) out.push(normalizeConnection({ id: 'c1' }))
  return out
}

/**
 * Validate RTU port uniqueness among enabled connections and TCP listenHost:listenPort for server role
 * @param {any[]} connections
 * @param {any[]} [devices]
 * @returns {string[]}
 */
export const validateConnections = (connections, devices) => {
  const errors = []
  const enabled = (connections || []).filter((c) => c && c.enabled !== false)
  // RTU port uniqueness
  const portMap = new Map()
  for (const c of enabled) {
    const conn = c.conn || {}
    if (conn.mode === 'rtu') {
      const port = typeof conn.port === 'string' ? conn.port.trim() : ''
      if (!port) continue
      const key = port.toLowerCase()
      if (portMap.has(key)) {
        const other = portMap.get(key)
        errors.push(`COM 已被 ${other.name} 占用: ${port}`)
      } else {
        portMap.set(key, c)
      }
    }
  }
  // TCP server listenHost:listenPort uniqueness
  const tcpMap = new Map()
  for (const c of enabled) {
    if (c.role !== 'server') continue
    const conn = c.conn || {}
    if (conn.mode !== 'tcp') continue
    const host = typeof conn.host === 'string' ? conn.host.trim() : ''
    const port = Number(conn.tcpPort) || 502
    const key = `${host || '0.0.0.0'}:${port}`.toLowerCase()
    // allow empty host to mean 0.0.0.0, treat similarly
    if (tcpMap.has(key)) {
      const other = tcpMap.get(key)
      errors.push(`监听地址已被 ${other.name} 占用: ${host || '0.0.0.0'}:${port}`)
    } else {
      tcpMap.set(key, c)
    }
  }
  // Optional second arg: also validate devices unitId uniqueness within same connection when provided
  if (Array.isArray(devices)) {
    const devErrs = validateDevices(devices, connections)
    errors.push(...devErrs)
  }
  return errors
}
