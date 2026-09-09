import { projectModbusForSession } from './src/application/modbus/config-scope-service.mjs'
import { normalizeModbus } from './bench-devices.mjs'
import { createModbusTransport } from './bench-modbus-transport.mjs'
import { loadWorkspace } from './bench-store.mjs'

const transportOf = (opts) => (opts && opts.transport) || createModbusTransport()

export const listConnectedSerialSources = async (home, cwd, extra = {}) => {
  const transport = transportOf(extra)
  const live = await transport.listConnections({ cwd })
  const data = live && live.data ? live.data : live
  const rows = Array.isArray(data && data.connections) ? data.connections : data && data.connectionId ? [data] : []
  const pack =
    extra.pack ||
    (home && cwd
      ? normalizeModbus(
          extra.sessionId
            ? projectModbusForSession(loadWorkspace(home, cwd).modbus, extra.sessionId)
            : loadWorkspace(home, cwd).modbus,
        )
      : { connections: [] })
  const byId = new Map((pack.connections || []).map((c) => [c.id, c]))
  const sources = []
  for (const row of rows) {
    if (!row || row.state !== 'connected') continue
    const conn = byId.get(row.connectionId)
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
  return { ok: true, sources }
}

const simConnectionStates = new Map()

export const setSimConnectionState = (cwd, connectionId, status) => {
  const key = `${String(cwd || '')}:${String(connectionId || '')}`
  simConnectionStates.set(key, {
    status: status === 'disconnected' ? 'disconnected' : 'connected',
    connectedAt: status === 'disconnected' ? 0 : Date.now(),
  })
}

export const getSimConnectionState = (cwd, connectionId) => {
  const key = `${String(cwd || '')}:${String(connectionId || '')}`
  return simConnectionStates.get(key) || null
}

// Task4/0.19.2: ALL configured RTU/TCP connections with their real live state
// (disconnected/connecting/connected/disconnecting/error). TCP is included here
// but never in serialSources.
export const listConnectionStates = async (home, cwd, extra = {}) => {
  const transport = transportOf(extra)
  const live = await transport.listConnections({ cwd })
  const data = live && live.data ? live.data : live
  const rows = Array.isArray(data && data.connections) ? data.connections : data && data.connectionId ? [data] : []
  const pack =
    extra.pack ||
    (home && cwd
      ? normalizeModbus(
          extra.sessionId
            ? projectModbusForSession(loadWorkspace(home, cwd).modbus, extra.sessionId)
            : loadWorkspace(home, cwd).modbus,
        )
      : { connections: [] })
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
