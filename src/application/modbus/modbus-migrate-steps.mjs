// @ts-check
import { normalizeConn } from '../../domain/modbus/connection-model.mjs'
import { parseUnitId } from '../../domain/modbus/device-model.mjs'
import {
  MAX_FRAMES_PER_CONN,
  normalizeFramesByConnection,
  normalizePolling,
} from '../../domain/modbus/frames-buffer.mjs'
import { AREA_BY_FN, normalizeValueRec } from '../../domain/modbus/point-model.mjs'

const devText = (/** @type {any} */ v, fb = '') => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s || fb
}

const genId = (/** @type {string} */ prefix) =>
  prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

const devClampInt = (/** @type {any} */ v, fb = 0, min = 0, max = 65535) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return fb
  const i = Math.trunc(n)
  if (i < min) return min
  if (i > max) return max
  return i
}

/**
 * Migrate a legacy layout into the v2 point table.
 * @param {any} modbusLike
 */
export function migrateLegacy(modbusLike) {
  const flat = modbusLike && typeof modbusLike === 'object' ? modbusLike : {}
  const devices = Array.isArray(flat.devices) ? flat.devices : []
  const dev = devices.find((/** @type {any} */ d) => d && typeof d === 'object') || {}
  const pick = (/** @type {string} */ key) => {
    if (dev[key] !== undefined) return dev[key]
    return flat[key]
  }
  const conn = normalizeConn({
    mode: pick('mode'),
    port: pick('port'),
    baudrate: pick('baudrate'),
    host: pick('host'),
    tcpPort: pick('tcpPort'),
    sim: pick('sim'),
  })
  const legacySlave = pick('slave')
  const segments = Array.isArray(dev.segments) ? dev.segments : Array.isArray(flat.segments) ? flat.segments : []
  const oldValues = Array.isArray(dev.values) ? dev.values : Array.isArray(flat.values) ? flat.values : []
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
    const fn = Number(seg?.function)
    const start = Number(seg?.address)
    if (!Number.isFinite(fn) || !Number.isFinite(start)) continue
    for (let i = 0; i < (Number(seg.count) || 1); i++) {
      const address = start + i
      const id = `p${fn}_${address}`
      points.push({
        id,
        name: Number(seg.count) > 1 ? '' : seg.name || '',
        function: fn,
        address,
        scale: seg.scale,
        offset: seg.offset,
        unit: seg.unit,
        alarmMin: seg.alarmMin,
        alarmMax: seg.alarmMax,
      })
      const oldKey = `${String(seg.id || '')}:${fn}@${address}`
      const rec = oldValues.find((/** @type {any} */ v) => v && v.key === oldKey)
      if (rec) valueMap.push(normalizeValueRec({ ...rec, key: id }))
    }
  }
  return { conn, points, values: valueMap, legacySlave }
}

/** @param {any} v2 */
export function migrateV2ToV3(v2) {
  // v2 shape: { version:2, conn, points:[{id:p3_0,function,address...}], values:[{key:p3_0 ...}], polling, alarmActive }
  const rawConn = v2.conn || {}
  // 一次性：旧 conn.slave → 默认设备 unitId；迁移后连接不再保留 slave；0/非法 → 1
  const unitId = parseUnitId(rawConn.slave !== undefined ? rawConn.slave : 1) ?? 1
  const conn = normalizeConn(rawConn)
  const connection = {
    id: 'c1',
    name: conn.port ? `连接-${conn.port}` : conn.host ? `连接-${conn.host}:${conn.tcpPort}` : '连接1',
    role: 'client',
    enabled: true,
    conn,
  }
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
    const oldId = devText(p?.id, '')
    const fn = Number(p?.function)
    const area = AREA_BY_FN[fn] || 'holdingRegister'
    const newId = genId('p')
    if (oldId) idMap.set(oldId, newId)
    // also map legacy p${fn}_${addr} maybe not equal id? but handle
    const legacyKey = `p${fn}_${p?.address}`
    if (legacyKey && !idMap.has(legacyKey)) idMap.set(legacyKey, newId)
    newPoints.push({
      id: newId,
      connectionId: 'c1',
      deviceId: 'd1',
      name: devText(p?.name, ''),
      area,
      function: fn,
      address: devClampInt(p?.address, 0, 0, 65535),
      scale: Number.isFinite(Number(p?.scale)) ? Number(p.scale) : 1,
      offset: Number.isFinite(Number(p?.offset)) ? Number(p.offset) : 0,
      unit: devText(p?.unit, '').slice(0, 12),
      alarmMin:
        p && (p.alarmMin === null || p.alarmMin === undefined || p.alarmMin === '')
          ? null
          : Number.isFinite(Number(p.alarmMin))
            ? Number(p.alarmMin)
            : null,
      alarmMax:
        p && (p.alarmMax === null || p.alarmMax === undefined || p.alarmMax === '')
          ? null
          : Number.isFinite(Number(p.alarmMax))
            ? Number(p.alarmMax)
            : null,
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
  /** @type {Record<string, any[]>} */
  let framesByConnection = { c1: [] }
  if (v2.frames && Array.isArray(v2.frames)) framesByConnection.c1 = v2.frames.slice(0, MAX_FRAMES_PER_CONN)
  else if (v2.framesLog && Array.isArray(v2.framesLog))
    framesByConnection.c1 = v2.framesLog.slice(0, MAX_FRAMES_PER_CONN)
  else if (v2.framesByConnection && typeof v2.framesByConnection === 'object') {
    framesByConnection = normalizeFramesByConnection(v2.framesByConnection, [connection])
    if (!framesByConnection.c1) framesByConnection.c1 = []
  }
  const alarmState =
    v2.alarmActive && typeof v2.alarmActive === 'object'
      ? { ...v2.alarmActive }
      : v2.alarmState && typeof v2.alarmState === 'object'
        ? { ...v2.alarmState }
        : {}
  // remap alarmState keys via idMap
  /** @type {Record<string, any>} */
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

export { devText }
