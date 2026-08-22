// Modbus model v2: ONE connection profile per workspace + a flat point table.
// Legacy workspaces (devices[] with register segments) are migrated on load.

import { functionTag, normalizePoints, normalizeValueRec } from './bench-points.mjs'


const PARITY = new Set(['N', 'E', 'O'])

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

const MAX_VALUES_SAFE = 512

// Migrate a legacy layout into the v2 point table. Two legacy shapes exist:
//   flat:   { mode, port, slave, sim, segments[], values[] }
//   nested: { devices: [ { ...same fields } ] }
// The first device wins when both are present; top-level fields fill gaps.
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
  // Handle legacy single-point flat function/address (store.test)
  if (!segments.length && Number.isFinite(Number(flat.function)) && Number.isFinite(Number(flat.address))) {
    const fn = Number(flat.function)
    const addr = Number(flat.address)
    if ([1, 2, 3, 4].includes(fn) && addr >= 0 && addr <= 65535) {
      segments.push({ id: 'legacy-flat', function: fn, address: addr, count: Number(flat.count) || 1 })
    }
  }
  const points = []
  const valueMap = []
  // DEBUG
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

export function normalizeModbus(input) {
  const src = input && typeof input === 'object' ? input : {}
  const looksLegacy = Array.isArray(src.devices)
    || (src.conn === undefined && (src.mode !== undefined || src.segments !== undefined || src.port !== undefined))
  let conn
  let pointsRaw
  let valuesRaw
  if (looksLegacy) {
    const m = migrateLegacy(src)
    conn = m.conn
    pointsRaw = m.points
    valuesRaw = m.values
  } else {
    conn = normalizeConn(src.conn)
    pointsRaw = src.points
    valuesRaw = src.values
  }
  const points = normalizePoints(pointsRaw)
  const validKeys = new Set(points.map((p) => p.id))
  const normValues = filterValues(valuesRaw, validKeys)
  const ret = {
    version: 2,
    conn,
    points,
    values: normValues,
    polling: normalizePolling(src.polling),
    alarmActive: src.alarmActive && typeof src.alarmActive === 'object' ? { ...src.alarmActive } : {},
  }
  // Legacy compat for old tests and bench-slave (flat fields + segments/devices)
  Object.defineProperties(ret, {
    mode: { get() { return ret.conn.mode }, enumerable: true },
    port: { get() { return ret.conn.port }, enumerable: true },
    host: { get() { return ret.conn.host }, enumerable: true },
    baudrate: { get() { return ret.conn.baudrate }, enumerable: true },
    slave: { get() { return ret.conn.slave }, enumerable: true },
    sim: { get() { return ret.conn.sim }, enumerable: true },
    function: { get() { return ret.points[0]?.function }, enumerable: true },
    address: { get() { return ret.points[0]?.address }, enumerable: true },
    segments: {
      get() {
        return ret.points.map((p) => ({ ...p, count: 1, id: p.id }))
      },
      enumerable: true,
    },
    devices: {
      get() {
        return [{ ...ret.conn, segments: ret.points.map((p) => ({ ...p, count: 1, id: p.id })), values: ret.values, polling: ret.polling }]
      },
      enumerable: true,
    },
  })
  return ret
}

export const patchConn = (modbus, patch) => ({
  ...modbus,
  conn: normalizeConn({ ...modbus.conn, ...(patch || {}) }),
})

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
