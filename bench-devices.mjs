// Modbus model v3: multi-connection + device/unit + stable point IDs
// v2 legacy (single conn) migrates to v3 via c1/d1. Older segment shapes also routed through v2 first.

import { functionTag, normalizePoints, normalizeValueRec } from './bench-points.mjs'

const PARITY = new Set(['N', 'E', 'O'])
const VALID_ROLES = new Set(['client', 'server'])
const VALID_AREAS = new Set(['coil', 'discreteInput', 'holdingRegister', 'inputRegister'])
const AREA_BY_FN = { 1: 'coil', 2: 'discreteInput', 3: 'holdingRegister', 4: 'inputRegister' }
const FN_BY_AREA = { coil: 1, discreteInput: 2, holdingRegister: 3, inputRegister: 4 }

const MAX_VALUES_SAFE = 512
const MAX_FRAMES_PER_CONN = 500

const devText = (v, fb='') => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s || fb
}
const genId = (prefix) => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
const devClampInt = (v, fb, min, max) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return fb
  const i = Math.trunc(n)
  if (i < min) return min
  if (i > max) return max
  return i
}

export const emptyConn = () => ({
  mode: 'rtu',
  port: '',
  baudrate: 9600,
  bytesize: 8,
  parity: 'N',
  stopbits: 1,
  host: '',
  tcpPort: 502,
  slave: 1,
  sim: false,
})

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
  const slave = Number(c.slave)
  out.slave = Number.isFinite(slave) && slave >= 0 ? Math.min(247, Math.max(0, Math.trunc(slave))) : 1
  out.sim = c.sim === true
  return out
}

export const connLabel = (conn) => conn.mode === 'tcp'
  ? ((conn.host || '?') + ':' + conn.tcpPort + ' · 站号 ' + conn.slave)
  : ((conn.port || '?') + ' @ ' + conn.baudrate + ' · 站号 ' + conn.slave)

export const emptyConnection = () => ({
  id: 'c1',
  name: '连接1',
  role: 'client',
  enabled: true,
  conn: emptyConn(),
})

export const normalizeConnection = (input) => {
  const raw = input && typeof input === 'object' ? input : {}
  const base = emptyConnection()
  const id = devText(raw.id, '') || genId('c')
  const name = devText(raw.name, '') || base.name
  const role = VALID_ROLES.has(raw.role) ? raw.role : (raw.role === 'master' ? 'client' : raw.role === 'slave' ? 'server' : 'client')
  // accept legacy master/slave as role
  return {
    id,
    name: name.slice(0, 40),
    role,
    enabled: raw.enabled !== false,
    conn: normalizeConn(raw.conn || raw),
  }
}

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

export const normalizeDevice = (input, fallbackConnId) => {
  const raw = input && typeof input === 'object' ? input : {}
  const id = devText(raw.id, '') || genId('d')
  const connectionId = devText(raw.connectionId, '') || devText(raw.connId, '') || fallbackConnId || 'c1'
  const name = devText(raw.name, '') || '设备1'
  const unitRaw = raw.unitId !== undefined ? raw.unitId : (raw.unit !== undefined ? raw.unit : (raw.slave !== undefined ? raw.slave : 1))
  const unitId = devClampInt(unitRaw, 1, 0, 247)
  return {
    id,
    connectionId,
    name: name.slice(0, 40),
    unitId,
    enabled: raw.enabled !== false,
  }
}

export const normalizeDevices = (list, connections) => {
  if (!Array.isArray(list)) {
    const first = Array.isArray(connections) && connections[0] ? connections[0].id : 'c1'
    return [normalizeDevice({ id: 'd1', connectionId: first, unitId: 1 }, first)]
  }
  const validConnIds = new Set((connections || []).map(c => c.id))
  const seen = new Set()
  const out = []
  for (const raw of list) {
    const d = normalizeDevice(raw, Array.isArray(connections) && connections[0] ? connections[0].id : 'c1')
    // fix invalid connectionId to first
    if (!validConnIds.has(d.connectionId)) {
      d.connectionId = Array.isArray(connections) && connections[0] ? connections[0].id : 'c1'
    }
    if (seen.has(d.id)) continue
    seen.add(d.id)
    out.push(d)
    if (out.length >= 64) break
  }
  if (!out.length) {
    const first = Array.isArray(connections) && connections[0] ? connections[0].id : 'c1'
    out.push(normalizeDevice({ id: 'd1', connectionId: first, unitId: 1 }, first))
  }
  return out
}

export const normalizePointV3 = (input) => {
  const raw = input && typeof input === 'object' ? input : {}
  const id = devText(raw.id, '') || genId('p')
  const connectionId = devText(raw.connectionId, '') || devText(raw.connId, '') || 'c1'
  const deviceId = devText(raw.deviceId, '') || 'd1'
  let area = devText(raw.area, '')
  if (!VALID_AREAS.has(area)) {
    const fn = Number(raw.function ?? raw.fn)
    if ([1,2,3,4].includes(fn)) area = AREA_BY_FN[fn]
    else area = 'holdingRegister'
  }
  const fnFromArea = FN_BY_AREA[area] || 3
  const address = devClampInt(raw.address, 0, 0, 65535)
  const scale = Number(raw.scale)
  const offset = Number(raw.offset)
  const name = devText(raw.name, '') .slice(0, 40)
  const unit = devText(raw.unit, '').slice(0, 12)
  const finiteOrNull = (v) => (v===null||v===undefined||v==='' ? null : (Number.isFinite(Number(v)) ? Number(v) : null))
  return {
    id,
    connectionId,
    deviceId,
    name,
    area,
    function: fnFromArea,
    address,
    scale: Number.isFinite(scale) ? scale : 1,
    offset: Number.isFinite(offset) ? offset : 0,
    unit,
    alarmMin: finiteOrNull(raw.alarmMin),
    alarmMax: finiteOrNull(raw.alarmMax),
  }
}

export const normalizePointsV3 = (list, connections, devices) => {
  if (!Array.isArray(list)) return []
  const validConnIds = new Set((connections || []).map(c => c.id))
  const validDevIds = new Set((devices || []).map(d => d.id))
  const seen = new Set()
  const out = []
  for (const raw of list) {
    const p = normalizePointV3(raw)
    // fix refs
    if (!validConnIds.has(p.connectionId)) p.connectionId = (connections && connections[0] ? connections[0].id : 'c1')
    if (!validDevIds.has(p.deviceId)) p.deviceId = (devices && devices[0] ? devices[0].id : 'd1')
    if (seen.has(p.id)) continue
    seen.add(p.id)
    out.push(p)
    if (out.length >= 256) break
  }
  return out
}

const normalizePolling = (input) => {
  const p = input && typeof input === 'object' ? input : {}
  const interval = Number(p.intervalMs)
  return {
    enabled: p.enabled === true,
    intervalMs: Number.isFinite(interval) && interval >= 200 && interval <= 10000 ? Math.trunc(interval) : 1000,
    lastAt: Number(p.lastAt) > 0 ? Number(p.lastAt) : 0,
    lastOk: p.lastOk !== false,
    error: typeof p.error === 'string' ? p.error.slice(0, 180) : '',
  }
}

export const normalizePollingByConnection = (input, connections) => {
  const out = {}
  const base = connections || []
  for (const c of base) out[c.id] = normalizePolling(null)
  if (!input || typeof input !== 'object') return out
  for (const [k, v] of Object.entries(input)) {
    if (out[k] !== undefined) out[k] = normalizePolling(v)
    else out[k] = normalizePolling(v)
  }
  return out
}

export const normalizeFramesByConnection = (input, connections) => {
  const out = {}
  const base = connections || []
  for (const c of base) out[c.id] = []
  if (!input || typeof input !== 'object') return out
  for (const [k, v] of Object.entries(input)) {
    const arr = Array.isArray(v) ? v.slice(0, MAX_FRAMES_PER_CONN) : []
    // sanitize each frame: keep t,label,request,response,trace
    out[k] = arr.map(f => ({
      t: Number(f && f.t) || Date.now(),
      label: typeof (f && f.label) === 'string' ? String(f.label).slice(0, 200) : '',
      request: typeof (f && f.request) === 'string' ? String(f.request).slice(0, 200) : '',
      response: typeof (f && f.response) === 'string' ? String(f.response).slice(0, 200) : '',
      trace: Array.isArray(f && f.trace) ? f.trace.map(s => String(s).slice(0, 200)).slice(0, 8) : [],
      deviceId: typeof (f && f.deviceId) === 'string' ? f.deviceId : '',
      connectionId: typeof (f && f.connectionId) === 'string' ? f.connectionId : k,
    })).slice(-MAX_FRAMES_PER_CONN)
  }
  return out
}

const filterValues = (list, validKeys) => {
  if (!Array.isArray(list)) return []
  const seen = new Set()
  const out = []
  for (const raw of list) {
    const rec = normalizeValueRec(raw)
    if (!rec.key || !validKeys.has(rec.key) || seen.has(rec.key)) continue
    seen.add(rec.key)
    out.push(rec)
    if (out.length >= MAX_VALUES_SAFE) break
  }
  return out
}

const normalizeQualifiedValues = (list, points) => {
  if (!Array.isArray(list)) return []
  const byPoint = new Map()
  for (const p of points || []) byPoint.set(p.id, p)
  const seen = new Set()
  const out = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const pointId = devText(raw.pointId || raw.key || raw.id, '')
    if (!pointId || !byPoint.has(pointId) || seen.has(pointId)) continue
    const pt = byPoint.get(pointId)
    const rec = normalizeValueRec({ ...raw, key: pointId })
    // enrich with redundant ids for filtering
    const enriched = {
      ...rec,
      pointId,
      key: pointId,
      connectionId: devText(raw.connectionId, '') || pt.connectionId,
      deviceId: devText(raw.deviceId, '') || pt.deviceId,
    }
    seen.add(pointId)
    out.push(enriched)
    if (out.length >= MAX_VALUES_SAFE) break
  }
  return out
}

// Validate RTU port uniqueness among enabled connections and TCP listenHost:listenPort for server role
export const validateConnections = (connections) => {
  const errors = []
  const enabled = (connections || []).filter(c => c && c.enabled !== false)
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
    const key = (host || '0.0.0.0').toLowerCase() + ':' + port
    // allow empty host to mean 0.0.0.0, treat similarly
    if (tcpMap.has(key)) {
      const other = tcpMap.get(key)
      errors.push(`监听地址已被 ${other.name} 占用: ${host || '0.0.0.0'}:${port}`)
    } else {
      tcpMap.set(key, c)
    }
  }
  return errors
}

// Migrate a legacy layout into the v2 point table. Two legacy shapes exist:
function migrateLegacy(modbusLike) {
  const flat = modbusLike && typeof modbusLike === 'object' ? modbusLike : {}
  const devices = Array.isArray(flat.devices) ? flat.devices : []
  const dev = devices.find((d) => d && typeof d === 'object') || {}
  const pick = (key) => {
    if (dev[key] !== undefined) return dev[key]
    return flat[key]
  }
  const conn = normalizeConn({
    mode: pick('mode'),
    port: pick('port'),
    baudrate: pick('baudrate'),
    host: pick('host'),
    tcpPort: pick('tcpPort'),
    slave: pick('slave'),
    sim: pick('sim'),
  })
  const segments = Array.isArray(dev.segments) ? dev.segments : (Array.isArray(flat.segments) ? flat.segments : [])
  const oldValues = Array.isArray(dev.values) ? dev.values : (Array.isArray(flat.values) ? flat.values : [])
  if (!segments.length && Number.isFinite(Number(flat.function)) && Number.isFinite(Number(flat.address))) {
    const fn = Number(flat.function)
    const addr = Number(flat.address)
    if ([1, 2, 3, 4].includes(fn) && addr >= 0 && addr <= 65535) {
      segments.push({ id: 'legacy-flat', function: fn, address: addr, count: Number(flat.count) || 1 })
    }
  }
  const points = []
  const valueMap = []
  for (const seg of segments) {
    const fn = Number(seg && seg.function)
    const start = Number(seg && seg.address)
    if (!Number.isFinite(fn) || !Number.isFinite(start)) continue
    for (let i = 0; i < (Number(seg.count) || 1); i++) {
      const address = start + i
      const id = 'p' + fn + '_' + address
      points.push({
        id,
        name: Number(seg.count) > 1 ? '' : (seg.name || ''),
        function: fn,
        address,
        scale: seg.scale,
        offset: seg.offset,
        unit: seg.unit,
        alarmMin: seg.alarmMin,
        alarmMax: seg.alarmMax,
      })
      const oldKey = String(seg.id || '') + ':' + fn + '@' + address
      const rec = oldValues.find((v) => v && v.key === oldKey)
      if (rec) valueMap.push(normalizeValueRec({ ...rec, key: id }))
    }
  }
  return { conn, points, values: valueMap }
}

function migrateV2ToV3(v2) {
  // v2 shape: { version:2, conn, points:[{id:p3_0,function,address...}], values:[{key:p3_0 ...}], polling, alarmActive }
  const conn = normalizeConn(v2.conn || {})
  const connection = {
    id: 'c1',
    name: conn.port ? `连接-${conn.port}` : (conn.host ? `连接-${conn.host}:${conn.tcpPort}` : '连接1'),
    role: 'client',
    enabled: true,
    conn,
  }
  // device from conn.slave
  const unitId = devClampInt(conn.slave, 1, 0, 247)
  const device = {
    id: 'd1',
    connectionId: 'c1',
    name: '设备1',
    unitId,
    enabled: true,
  }
  // points: generate new stable IDs and map area
  const oldPoints = Array.isArray(v2.points) ? v2.points : []
  const idMap = new Map() // oldId -> newId
  const newPoints = []
  for (const p of oldPoints) {
    const oldId = devText(p && p.id, '')
    const fn = Number(p && p.function)
    const area = AREA_BY_FN[fn] || 'holdingRegister'
    const newId = genId('p')
    if (oldId) idMap.set(oldId, newId)
    // also map legacy p${fn}_${addr} maybe not equal id? but handle
    const legacyKey = 'p' + fn + '_' + (p && p.address)
    if (legacyKey && !idMap.has(legacyKey)) idMap.set(legacyKey, newId)
    newPoints.push({
      id: newId,
      connectionId: 'c1',
      deviceId: 'd1',
      name: devText(p && p.name, ''),
      area,
      function: fn,
      address: devClampInt(p && p.address, 0, 0, 65535),
      scale: Number.isFinite(Number(p && p.scale)) ? Number(p.scale) : 1,
      offset: Number.isFinite(Number(p && p.offset)) ? Number(p.offset) : 0,
      unit: devText(p && p.unit, '').slice(0,12),
      alarmMin: (p && (p.alarmMin===null||p.alarmMin===undefined||p.alarmMin==='')?null:(Number.isFinite(Number(p.alarmMin))?Number(p.alarmMin):null)),
      alarmMax: (p && (p.alarmMax===null||p.alarmMax===undefined||p.alarmMax==='')?null:(Number.isFinite(Number(p.alarmMax))?Number(p.alarmMax):null)),
    })
  }
  const oldValues = Array.isArray(v2.values) ? v2.values : []
  const newValues = []
  for (const v of oldValues) {
    const oldKey = devText(v && (v.key || v.pointId), '')
    const newId = idMap.get(oldKey)
    if (!newId) continue
    const rec = normalizeValueRec({ ...v, key: newId, pointId: newId })
    newValues.push({
      ...rec,
      pointId: newId,
      key: newId,
      connectionId: 'c1',
      deviceId: 'd1',
    })
  }
  // polling
  const pollingByConnection = { c1: normalizePolling(v2.polling) }
  // frames: old single-track frames -> framesByConnection[c1]
  let framesByConnection = { c1: [] }
  if (v2.frames && Array.isArray(v2.frames)) framesByConnection.c1 = v2.frames.slice(0, MAX_FRAMES_PER_CONN)
  else if (v2.framesLog && Array.isArray(v2.framesLog)) framesByConnection.c1 = v2.framesLog.slice(0, MAX_FRAMES_PER_CONN)
  else if (v2.framesByConnection && typeof v2.framesByConnection === 'object') {
    framesByConnection = normalizeFramesByConnection(v2.framesByConnection, [connection])
    if (!framesByConnection.c1) framesByConnection.c1 = []
  }
  const alarmState = v2.alarmActive && typeof v2.alarmActive === 'object' ? { ...v2.alarmActive } : (v2.alarmState && typeof v2.alarmState === 'object' ? { ...v2.alarmState } : {})
  // remap alarmState keys via idMap
  const nextAlarm = {}
  for (const [k, val] of Object.entries(alarmState)) {
    const nid = idMap.get(k) || k
    nextAlarm[nid] = val
  }
  return {
    connections: [connection],
    devices: [device],
    points: newPoints,
    values: newValues,
    activeConnectionId: 'c1',
    activeDeviceId: 'd1',
    pollingByConnection,
    framesByConnection: normalizeFramesByConnection(framesByConnection, [connection]),
    alarmState: nextAlarm,
    _migratedFromV2: true,
    _idMap: idMap,
  }
}

export function normalizeModbus(input) {
  const src = input && typeof input === 'object' ? input : {}
  // Detect v3
  const isV3 = src.version === 3 || Array.isArray(src.connections) || Array.isArray(src.devices) && src.points && Array.isArray(src.points) && src.points.some(p => p && p.area)
  // Detect legacy v2 or older flat
  const looksLegacy = src.conn === undefined && (
    Array.isArray(src.devices) || src.mode !== undefined || src.segments !== undefined || src.port !== undefined
  )
  // v3 path
  if (isV3) {
    let connections = normalizeConnections(src.connections)
    let devices = normalizeDevices(src.devices, connections)
    // ensure at least one device per connection? keep as is
    let points = normalizePointsV3(src.points, connections, devices)
    // values: qualified
    let values = normalizeQualifiedValues(src.values, points)
    // handle pollingByConnection vs polling
    let pollingByConnection
    if (src.pollingByConnection && typeof src.pollingByConnection === 'object') {
      pollingByConnection = normalizePollingByConnection(src.pollingByConnection, connections)
    } else if (src.polling) {
      // single polling -> assign to active or first
      const pid = devText(src.activeConnectionId, '') || (connections[0]?.id || 'c1')
      pollingByConnection = normalizePollingByConnection({ [pid]: src.polling }, connections)
      // fill others
      for (const c of connections) if (!pollingByConnection[c.id]) pollingByConnection[c.id] = normalizePolling(null)
    } else {
      pollingByConnection = normalizePollingByConnection(null, connections)
    }
    let framesByConnection
    if (src.framesByConnection && typeof src.framesByConnection === 'object') {
      framesByConnection = normalizeFramesByConnection(src.framesByConnection, connections)
    } else if (src.frames && Array.isArray(src.frames)) {
      const first = connections[0]?.id || 'c1'
      framesByConnection = normalizeFramesByConnection({ [first]: src.frames }, connections)
    } else if (src.framesLog && Array.isArray(src.framesLog)) {
      const first = connections[0]?.id || 'c1'
      framesByConnection = normalizeFramesByConnection({ [first]: src.framesLog }, connections)
    } else {
      framesByConnection = normalizeFramesByConnection(null, connections)
    }
    let alarmState = src.alarmState && typeof src.alarmState === 'object' ? { ...src.alarmState } : (src.alarmActive && typeof src.alarmActive === 'object' ? { ...src.alarmActive } : {})
    // active ids
    let activeConnectionId = devText(src.activeConnectionId, '')
    if (!connections.some(c=>c.id===activeConnectionId)) activeConnectionId = connections[0]?.id || 'c1'
    let activeDeviceId = devText(src.activeDeviceId, '')
    if (!devices.some(d=>d.id===activeDeviceId)) {
      const devForConn = devices.find(d=>d.connectionId===activeConnectionId)
      activeDeviceId = devForConn ? devForConn.id : (devices[0]?.id || 'd1')
    }
    // also need to filter points/values that reference invalid connection/device? already fixed refs but keep check
    const ret = {
      version: 3,
      connections,
      devices,
      points,
      values,
      activeConnectionId,
      activeDeviceId,
      pollingByConnection,
      framesByConnection,
      alarmState,
    }
    // Legacy enumerable:false compat
    Object.defineProperties(ret, {
      conn: {
        get() {
          const ac = ret.connections.find(c=>c.id===ret.activeConnectionId) || ret.connections[0]
          return ac ? ac.conn : emptyConn()
        },
        enumerable: false,
      },
      mode: { get(){ return ret.conn.mode }, enumerable:false },
      port: { get(){ return ret.conn.port }, enumerable:false },
      host: { get(){ return ret.conn.host }, enumerable:false },
      baudrate: { get(){ return ret.conn.baudrate }, enumerable:false },
      slave: {
        get(){
          const ad = ret.devices.find(d=>d.id===ret.activeDeviceId) || ret.devices[0]
          return ad ? ad.unitId : 1
        },
        enumerable:false
      },
      sim: { get(){ return ret.conn.sim }, enumerable:false },
      polling: {
        get(){ return ret.pollingByConnection[ret.activeConnectionId] || normalizePolling(null) },
        enumerable:false
      },
      alarmActive: {
        get(){ return ret.alarmState },
        enumerable:false
      },
      pointsLegacy: { get(){ return ret.points }, enumerable:false },
      function: { get(){ return ret.points[0]?.function }, enumerable:false },
      address: { get(){ return ret.points[0]?.address }, enumerable:false },
      segments: {
        get(){ return ret.points.map(p=>({ ...p, count:1, id:p.id })) },
        enumerable:false
      },
      devices_legacy: {
        get(){ return ret.devices },
        enumerable:false
      },
    })
    // Also provide flat points/values for old code expecting ret.points etc? Already version 3 has new points; keep them enumerable.
    return ret
  }

  // v2 or legacy path -> produce v3 via migration
  let v2
  if (looksLegacy) {
    const m = migrateLegacy(src)
    v2 = {
      version: 2,
      conn: m.conn,
      points: normalizePoints(m.points),
      values: filterValues(m.values, new Set(m.points.map(p=>p.id))),
      polling: normalizePolling(src.polling),
      alarmActive: src.alarmActive && typeof src.alarmActive === 'object' ? { ...src.alarmActive } : {},
      frames: src.frames || src.framesLog || src.framesByConnection,
    }
    // preserve frames if any from legacy flat? not needed
  } else if (src.version === 2 || src.conn !== undefined) {
    const conn = normalizeConn(src.conn)
    const points = normalizePoints(src.points)
    const validKeys = new Set(points.map(p=>p.id))
    const normValues = filterValues(src.values, validKeys)
    v2 = {
      version:2,
      conn,
      points,
      values: normValues,
      polling: normalizePolling(src.polling),
      alarmActive: src.alarmActive && typeof src.alarmActive === 'object' ? { ...src.alarmActive } : {},
      frames: src.frames || src.framesLog || src.framesByConnection,
      framesByConnection: src.framesByConnection,
    }
    // also carry over possible framesByConnection from v2 partial?
    if (src.framesByConnection) v2.framesByConnection = src.framesByConnection
  } else {
    // empty or unknown -> treat as v2 empty
    v2 = {
      version:2,
      conn: normalizeConn(null),
      points: [],
      values: [],
      polling: normalizePolling(null),
      alarmActive: {},
    }
  }
  const migrated = migrateV2ToV3(v2)
  const ret = {
    version:3,
    connections: migrated.connections,
    devices: migrated.devices,
    points: migrated.points,
    values: migrated.values,
    activeConnectionId: migrated.activeConnectionId,
    activeDeviceId: migrated.activeDeviceId,
    pollingByConnection: migrated.pollingByConnection,
    framesByConnection: migrated.framesByConnection,
    alarmState: migrated.alarmState,
  }
  Object.defineProperties(ret, {
    conn: {
      get(){ const ac = ret.connections.find(c=>c.id===ret.activeConnectionId) || ret.connections[0]; return ac ? ac.conn : emptyConn() },
      enumerable:false
    },
    mode: { get(){ return ret.conn.mode }, enumerable:false },
    port: { get(){ return ret.conn.port }, enumerable:false },
    host: { get(){ return ret.conn.host }, enumerable:false },
    baudrate: { get(){ return ret.conn.baudrate }, enumerable:false },
    slave: {
      get(){ const ad = ret.devices.find(d=>d.id===ret.activeDeviceId) || ret.devices[0]; return ad ? ad.unitId : 1 },
      enumerable:false
    },
    sim: { get(){ return ret.conn.sim }, enumerable:false },
    polling: {
      get(){ return ret.pollingByConnection[ret.activeConnectionId] || normalizePolling(null) },
      enumerable:false
    },
    alarmActive: { get(){ return ret.alarmState }, enumerable:false },
    function: { get(){ return ret.points[0]?.function }, enumerable:false },
    address: { get(){ return ret.points[0]?.address }, enumerable:false },
    segments: {
      get(){ return ret.points.map(p=>({ ...p, count:1, id:p.id })) },
      enumerable:false
    },
  })
  return ret
}

export const patchConn = (modbus, patch) => {
  const normalized = normalizeModbus(modbus)
  const activeId = normalized.activeConnectionId
  const nextConns = normalized.connections.map(c => c.id===activeId ? { ...c, conn: normalizeConn({ ...c.conn, ...(patch||{}) }) } : c)
  let nextDevices = normalized.devices
  if (patch && patch.slave !== undefined) {
    const devId = normalized.activeDeviceId
    const unit = Math.min(247, Math.max(0, Math.trunc(Number(patch.slave)||1)))
    if (devId) nextDevices = normalized.devices.map(d=> d.id===devId ? { ...d, unitId: unit } : d)
  }
  return normalizeModbus({
    ...normalized,
    connections: nextConns,
    devices: nextDevices,
  })
}

// ── Legacy compat for old tests (recipePair etc.) ─────────────────────
export const recipePair = () => ({
  devices: [
    { id: 'd1', name: '主机', role: 'master', mode: 'rtu', port: 'COM1', baudrate: 9600, slave: 1, sim: true, segments: [] },
    { id: 'd2', name: '从机', role: 'slave', mode: 'rtu', port: 'COM2', baudrate: 9600, slave: 2, sim: true, segments: [{ id: 's1', name: '保持', function: 3, address: 0, count: 10 }] },
  ],
  activeId: 'd1',
})

export const emptyDevice = (input={}) => ({
  id: input.id || 'd-legacy',
  name: input.name || '设备',
  role: input.role || 'master',
  mode: input.mode || 'rtu',
  port: input.port || '',
  slave: input.slave || 1,
  segments: input.segments || [],
  values: input.values || [],
})

export const addDevice = (modbus, spec) => {
  const pack = normalizeModbus(modbus)
  return { devices: [...(modbus.devices||[]), { id: 'd-new', ...spec }], activeId: pack.conn ? 'd-new' : '' }
}

export const removeDevice = (modbus, id) => {
  const pack = normalizeModbus(modbus)
  return { devices: (modbus.devices||[]).filter(d=>d.id!==id) }
}

export const patchActiveDevice = (modbus, patch) => {
  return { ...modbus, ...patch }
}
