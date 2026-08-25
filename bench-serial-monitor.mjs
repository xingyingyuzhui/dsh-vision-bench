import { createModbusTransport } from './bench-modbus-transport.mjs'
import { normalizeModbus } from './bench-devices.mjs'
import { loadWorkspace } from './bench-store.mjs'

const transportOf = (opts) => (opts && opts.transport) || createModbusTransport()

export const listConnectedSerialSources = async (home, cwd, extra = {}) => {
  const transport = transportOf(extra)
  const live = await transport.listConnections({ cwd })
  const data = live && live.data ? live.data : live
  const rows = Array.isArray(data && data.connections) ? data.connections : (data && data.connectionId ? [data] : [])
  const pack = home && cwd ? normalizeModbus(loadWorkspace(home, cwd).modbus) : { connections: [] }
  const byId = new Map((pack.connections || []).map((c) => [c.id, c]))
  const sources = []
  for (const row of rows) {
    if (!row || row.state !== 'connected') continue
    const conn = byId.get(row.connectionId)
    const mode = (conn && conn.conn && conn.conn.mode) || row.mode || 'rtu'
    if (mode !== 'rtu') continue
    if (conn && conn.conn && conn.conn.sim) continue
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
  return { ok: true, sources }
}

export const feedConnectionFrames = async (cwd, opts = {}, extra = {}) => {
  const transport = transportOf(extra)
  const ran = await transport.captureFeed({
    cwd,
    connectionId: opts.connectionId || '',
    since: opts.since || 0,
    max: opts.max || 500,
  })
  const data = ran && ran.data ? ran.data : ran
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

export const openConnectionLink = async (cwd, body, extra = {}) => {
  const transport = transportOf(extra)
  return transport.openConnection({
    cwd,
    connectionId: body.connectionId,
    endpoint: body.endpoint || body,
  })
}

export const closeConnectionLink = async (cwd, connectionId, extra = {}) => {
  const transport = transportOf(extra)
  return transport.closeConnection({ cwd, connectionId })
}

export const findMonitoredPort = () => null
export const openSerialMonitor = async () => ({ ok: false, error: '请在上位机连接串口', code: 'USE_HMI_CONNECT' })
export const closeSerialMonitor = async () => ({ ok: true, skipped: true })
export const serialFeed = (cwd, since, extra) => feedConnectionFrames(cwd, { since }, extra)
export const serialState = () => ({ open: false, port: '', baudrate: 0, error: '', lastId: 0, total: 0 })
export const clearSerialMonitorState = () => {}
export const stopAllSerialMonitors = async () => {}
