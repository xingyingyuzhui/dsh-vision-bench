// @ts-check
import { projectModbusForSession } from '../../application/modbus/config-scope-service.mjs'
import { normalizeModbus } from '../../domain/modbus/modbus-migration.mjs'
import { createModbusTransport } from './modbus-transport.mjs'
import { loadWorkspace } from '../store/workspace-store.mjs'

/**
 * @typedef {ReturnType<typeof createModbusTransport>} MonitorTransport
 * @typedef {{
 *   id: string,
 *   name?: string,
 *   enabled?: boolean,
 *   sim?: boolean,
 *   conn?: { mode?: string, sim?: boolean, port?: string, host?: string, tcpPort?: number },
 * }} MonitorConnection
 * @typedef {{
 *   connections?: MonitorConnection[],
 *   pollingByConnection?: Record<string, { enabled?: boolean } | undefined>,
 * }} MonitorPack
 * @typedef {{ transport?: MonitorTransport, pack?: MonitorPack, sessionId?: string }} MonitorExtra
 * @typedef {{
 *   state?: string,
 *   connectionId?: string,
 *   mode?: string,
 *   port?: string,
 *   connectedAt?: number,
 *   error?: string,
 *   epoch?: string,
 * }} LiveRow
 * @typedef {{
 *   data?: LivePayload,
 *   connections?: LiveRow[],
 *   connectionId?: string,
 *   lines?: unknown[],
 *   open?: boolean,
 *   state?: string,
 *   port?: string,
 *   lastId?: number,
 *   total?: number,
 *   epoch?: string,
 * }} LivePayload
 */

/** @param {unknown} value @returns {LivePayload} */
function asLive(value) {
  return value && typeof value === 'object' ? /** @type {LivePayload} */ (value) : {}
}

/** @param {MonitorExtra | undefined} opts @returns {MonitorTransport} */
const transportOf = (opts) => (opts && opts.transport) || createModbusTransport()

/**
 * @param {unknown} home
 * @param {unknown} cwd
 * @param {MonitorExtra} [extra]
 */
export const listConnectedSerialSources = async (home, cwd, extra = {}) => {
  const transport = transportOf(extra)
  const live = asLive(await transport.listConnections({ cwd: /** @type {string} */ (cwd) }))
  const data = asLive(live.data || live)
  const rows = /** @type {LiveRow[]} */ (
    Array.isArray(data.connections) ? data.connections : data.connectionId ? [data] : []
  )
  const pack = /** @type {MonitorPack} */ (
    extra.pack ||
    (home && cwd
      ? normalizeModbus(
          extra.sessionId
            ? projectModbusForSession(loadWorkspace(/** @type {string} */ (home), /** @type {string} */ (cwd)).modbus, extra.sessionId)
            : loadWorkspace(/** @type {string} */ (home), /** @type {string} */ (cwd)).modbus,
        )
      : { connections: [] })
  )
  const byId = new Map((pack.connections || []).map((c) => [c.id, c]))
  const sources = []
  for (const row of rows) {
    if (!row || row.state !== 'connected') continue
    const conn = byId.get(/** @type {string} */ (row.connectionId))
    const mode = (conn && conn.conn && conn.conn.mode) || row.mode || 'rtu'
    if (mode !== 'rtu') continue
    if (conn && conn.conn && (conn.conn.sim || conn.sim)) continue
    if (conn && conn.enabled === false) continue
    const port = row.port || (conn && conn.conn && conn.conn.port) || ''
    if (!port) continue
    sources.push({
      connectionId: row.connectionId,
      port,
      name: (conn && conn.name) || row.connectionId,
      state: 'connected',
      connectedAt: row.connectedAt || 0,
    })
  }
  for (const c of pack.connections || []) {
    if (!c || !c.id || !c.conn) continue
    if (!(c.conn.sim === true || c.sim === true)) continue
    if (c.enabled === false) continue
    if ((c.conn.mode || 'rtu') !== 'rtu') continue
    const simSt = getSimConnectionState(cwd, c.id)
    const connected = simSt ? simSt.status === 'connected' : true
    if (!connected) continue
    sources.push({
      connectionId: c.id,
      port: c.conn.port || 'SIM',
      name: c.name || c.id,
      state: 'connected',
      connectedAt: (simSt && simSt.connectedAt) || Date.now(),
      simulated: true,
    })
  }
  return { ok: true, sources }
}

/** @type {Map<string, { status: string, connectedAt: number }>} */
const simConnectionStates = new Map()

/**
 * @param {unknown} cwd
 * @param {unknown} connectionId
 * @param {unknown} status
 */
export const setSimConnectionState = (cwd, connectionId, status) => {
  const key = `${String(cwd || '')}:${String(connectionId || '')}`
  simConnectionStates.set(key, {
    status: status === 'disconnected' ? 'disconnected' : 'connected',
    connectedAt: status === 'disconnected' ? 0 : Date.now(),
  })
}

/** @param {unknown} cwd @param {unknown} connectionId */
export const getSimConnectionState = (cwd, connectionId) => {
  const key = `${String(cwd || '')}:${String(connectionId || '')}`
  return simConnectionStates.get(key) || null
}

// Task4/0.19.2: ALL configured RTU/TCP connections with their real live state
// (disconnected/connecting/connected/disconnecting/error). TCP is included here
// but never in serialSources.
/**
 * @param {unknown} home
 * @param {unknown} cwd
 * @param {MonitorExtra} [extra]
 */
export const listConnectionStates = async (home, cwd, extra = {}) => {
  const transport = transportOf(extra)
  const live = asLive(await transport.listConnections({ cwd: /** @type {string} */ (cwd) }))
  const data = asLive(live.data || live)
  const rows = /** @type {LiveRow[]} */ (
    Array.isArray(data.connections) ? data.connections : data.connectionId ? [data] : []
  )
  const pack = /** @type {MonitorPack} */ (
    extra.pack ||
    (home && cwd
      ? normalizeModbus(
          extra.sessionId
            ? projectModbusForSession(loadWorkspace(/** @type {string} */ (home), /** @type {string} */ (cwd)).modbus, extra.sessionId)
            : loadWorkspace(/** @type {string} */ (home), /** @type {string} */ (cwd)).modbus,
        )
      : { connections: [] })
  )
  const liveById = new Map(rows.map((r) => [r.connectionId, r]))
  const connectionStates = []

  for (const c of pack.connections || []) {
    if (!c || !c.conn) continue
    if (c.conn.sim === true || c.sim === true) {
      const simSt = getSimConnectionState(cwd, c.id)
      const pollCfg = (pack.pollingByConnection || {})[c.id]
      const lv = liveById.get(c.id)
      const isSimConnected =
        c.enabled !== false &&
        (simSt
          ? simSt.status === 'connected'
          : lv && lv.state === 'connected'
            ? true
            : pollCfg
              ? pollCfg.enabled !== false
              : true)
      connectionStates.push({
        connectionId: c.id,
        mode: c.conn.mode || 'rtu',
        endpoint: 'simulated',
        status: isSimConnected ? 'connected' : 'disconnected',
        error: '',
        connectedAt: isSimConnected ? (simSt && simSt.connectedAt) || Date.now() : 0,
        connectionEpoch: 'sim',
        simulated: true,
      })
      continue
    }
    const lv = liveById.get(c.id)
    const conn = c.conn
    connectionStates.push({
      connectionId: c.id,
      mode: conn.mode || 'rtu',
      endpoint: conn.mode === 'tcp' ? String(conn.host || '') + ':' + String(conn.tcpPort || 502) : conn.port || '',
      status: lv ? lv.state || 'connected' : 'disconnected',
      error: (lv && lv.error) || '',
      connectedAt: (lv && lv.connectedAt) || 0,
      connectionEpoch: (lv && lv.epoch) || '',
    })
  }
  return { ok: true, connectionStates }
}

/**
 * @param {unknown} cwd
 * @param {{ connectionId?: unknown, since?: unknown, max?: unknown }} [opts]
 * @param {MonitorExtra} [extra]
 */
export const feedConnectionFrames = async (cwd, opts = {}, extra = {}) => {
  const transport = transportOf(extra)
  const ran = asLive(
    await transport.captureFeed({
      cwd,
      connectionId: opts.connectionId || '',
      since: opts.since || 0,
      max: opts.max || 500,
    }),
  )
  const data = asLive(ran.data || ran)
  const lines = Array.isArray(data && data.lines) ? data.lines : []
  return {
    ok: true,
    open: !!(data && data.open),
    state: (data && data.state) || '',
    port: (data && data.port) || '',
    connectionId: opts.connectionId || '',
    lines,
    lastId: (data && data.lastId) || 0,
    total: (data && data.total) || 0,
    epoch: (data && data.epoch) || '',
  }
}

/**
 * @param {unknown} cwd
 * @param {{ connectionId?: unknown, endpoint?: unknown }} body
 * @param {MonitorExtra} [extra]
 */
export const openConnectionLink = async (cwd, body, extra = {}) => {
  const transport = transportOf(extra)
  return transport.openConnection({
    cwd,
    connectionId: body.connectionId,
    endpoint: body.endpoint || body,
  })
}

/**
 * @param {unknown} cwd
 * @param {unknown} connectionId
 * @param {MonitorExtra} [extra]
 */
export const closeConnectionLink = async (cwd, connectionId, extra = {}) => {
  const transport = transportOf(extra)
  return transport.closeConnection({ cwd, connectionId })
}

export const findMonitoredPort = () => null
export const openSerialMonitor = async () => ({ ok: false, error: '请在上位机连接串口', code: 'USE_HMI_CONNECT' })
export const closeSerialMonitor = async () => ({ ok: true, skipped: true })
/**
 * @param {unknown} cwd
 * @param {unknown} since
 * @param {MonitorExtra} [extra]
 */
export const serialFeed = (cwd, since, extra) => feedConnectionFrames(cwd, { since }, extra)
export const serialState = () => ({ open: false, port: '', baudrate: 0, error: '', lastId: 0, total: 0 })
export const clearSerialMonitorState = () => {}
export const stopAllSerialMonitors = async () => {}
