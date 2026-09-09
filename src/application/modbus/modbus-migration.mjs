// @ts-check
import { normalizeAlarmState } from '../../../bench-alarm.mjs'
import { emptyVisualization, normalizeVisualizationForRead } from '../../../bench-visualization-model.mjs'
import { emptyConn, normalizeConn, normalizeConnections } from '../../domain/modbus/connection-model.mjs'
import { normalizeDevices, parseUnitId } from '../../domain/modbus/device-model.mjs'
import {
  MAX_FRAMES_PER_CONN,
  normalizeFramesByConnection,
  normalizePolling,
  normalizePollingByConnection,
  normalizeTrendByPoint,
} from '../../domain/modbus/frames-buffer.mjs'
import {
  AREA_BY_FN,
  filterValues,
  normalizePoints,
  normalizePointsV3,
  normalizeQualifiedValues,
  normalizeValueRec,
} from '../../domain/modbus/point-model.mjs'
import {
  normalizeScopeSessionId,
  normalizeSessionConfigs,
  normalizeShareFlags,
  unionScopedPoints,
} from '../../domain/modbus/config-scope.mjs'

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

/** @param {any} input */
export const normalizeConfigVersion = (input) => {
  const n = Number(input)
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.trunc(n)
}

/** @param {any} input @returns {any} */
export function normalizeModbus(input) {
  const src = input && typeof input === 'object' ? input : {}
  // Detect v3
  const isV3 =
    src.version === 3 ||
    Array.isArray(src.connections) ||
    (Array.isArray(src.devices) &&
      src.points &&
      Array.isArray(src.points) &&
      src.points.some((/** @type {any} */ p) => p?.area))
  // Detect legacy v2 or older flat
  const looksLegacy =
    src.conn === undefined &&
    (Array.isArray(src.devices) || src.mode !== undefined || src.segments !== undefined || src.port !== undefined)
  // v3 path
  if (isV3) {
    const connections = normalizeConnections(src.connections)
    const devices = normalizeDevices(src.devices, connections)
    // ensure at least one device per connection? keep as is
    const points = normalizePointsV3(src.points, connections, devices)
    // Session-private scope (0.27): shared/private layers + legacy claim marker.
    const share = normalizeShareFlags(src.share)
    const sessionConfigs = normalizeSessionConfigs(src.sessionConfigs)
    const privateClaimSessionId = normalizeScopeSessionId(src.privateClaimSessionId)
    // values: qualified. Runtime values are shared at top-level, so keep entries for
    // points living in ANY layer (shared or session-private), not just top-level.
    const values = normalizeQualifiedValues(src.values, unionScopedPoints(points, sessionConfigs, share))
    // handle pollingByConnection vs polling
    let pollingByConnection
    if (src.pollingByConnection && typeof src.pollingByConnection === 'object') {
      pollingByConnection = normalizePollingByConnection(src.pollingByConnection, connections)
    } else if (src.polling) {
      // single polling -> assign to active or first
      const pid = devText(src.activeConnectionId, '') || connections[0]?.id || 'c1'
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
    const alarmState = normalizeAlarmState(
      src.alarmState && typeof src.alarmState === 'object'
        ? src.alarmState
        : src.alarmActive && typeof src.alarmActive === 'object'
          ? src.alarmActive
          : {},
      { pointsById: Object.fromEntries((points || []).map((p) => [p.id, p])) },
    )
    const trend = normalizeTrendByPoint(src.trend)
    // TaskP0/0.20.0: 可视化组件（缺失/失效引用只做诊断，不清除用户配置）
    const visualization =
      src.visualization && typeof src.visualization === 'object'
        ? normalizeVisualizationForRead(src.visualization, points)
        : emptyVisualization()
    // active ids
    let activeConnectionId = devText(src.activeConnectionId, '')
    if (!connections.some((c) => c.id === activeConnectionId)) activeConnectionId = connections[0]?.id || ''
    let activeDeviceId = devText(src.activeDeviceId, '')
    const belongs =
      activeDeviceId && devices.some((d) => d.id === activeDeviceId && d.connectionId === activeConnectionId)
    if (!belongs) {
      activeDeviceId = devices.find((d) => d.connectionId === activeConnectionId)?.id || ''
    }
    const configVersion = normalizeConfigVersion(src.configVersion ?? src.rev ?? src.cfgVersion ?? 1)
    /** @type {any} */
    const ret = {
      version: 3,
      configVersion,
      connections,
      devices,
      points,
      values,
      activeConnectionId,
      activeDeviceId,
      pollingByConnection,
      framesByConnection,
      alarmState,
      trend,
      visualization,
      share,
      sessionConfigs,
      privateClaimSessionId,
    }
    // Legacy enumerable:false compat
    Object.defineProperties(ret, {
      conn: {
        get() {
          const ac =
            ret.connections.find((/** @type {any} */ c) => c.id === ret.activeConnectionId) || ret.connections[0]
          return ac ? ac.conn : emptyConn()
        },
        enumerable: false,
      },
      mode: {
        get() {
          return ret.conn.mode
        },
        enumerable: false,
      },
      port: {
        get() {
          return ret.conn.port
        },
        enumerable: false,
      },
      host: {
        get() {
          return ret.conn.host
        },
        enumerable: false,
      },
      baudrate: {
        get() {
          return ret.conn.baudrate
        },
        enumerable: false,
      },
      slave: {
        get() {
          const ad = ret.devices.find(
            (/** @type {any} */ d) => d.id === ret.activeDeviceId && d.connectionId === ret.activeConnectionId,
          )
          return ad ? ad.unitId : 1
        },
        enumerable: false,
      },
      sim: {
        get() {
          return ret.conn.sim
        },
        enumerable: false,
      },
      polling: {
        get() {
          return ret.pollingByConnection[ret.activeConnectionId] || normalizePolling(null)
        },
        enumerable: false,
      },
      alarmActive: {
        get() {
          return ret.alarmState
        },
        enumerable: false,
      },
      pointsLegacy: {
        get() {
          return ret.points
        },
        enumerable: false,
      },
      function: {
        get() {
          return ret.points[0]?.function
        },
        enumerable: false,
      },
      address: {
        get() {
          return ret.points[0]?.address
        },
        enumerable: false,
      },
      segments: {
        get() {
          return ret.points.map((/** @type {any} */ p) => ({ ...p, count: 1, id: p.id }))
        },
        enumerable: false,
      },
      devices_legacy: {
        get() {
          return ret.devices
        },
        enumerable: false,
      },
    })
    return ret
  }

  // v2 or legacy path -> produce v3 via migration
  let v2
  if (looksLegacy) {
    const m = migrateLegacy(src)
    v2 = {
      version: 2,
      // 临时带回 slave 仅供 migrateV2ToV3 写入默认设备 unitId
      conn: m.legacySlave !== undefined ? { ...m.conn, slave: m.legacySlave } : m.conn,
      points: normalizePoints(m.points),
      values: filterValues(m.values, new Set(m.points.map((p) => p.id))),
      polling: normalizePolling(src.polling),
      alarmActive: src.alarmActive && typeof src.alarmActive === 'object' ? { ...src.alarmActive } : {},
      frames: src.frames || src.framesLog || src.framesByConnection,
    }
  } else if (src.version === 2 || src.conn !== undefined) {
    // 保留原始 conn.slave 供迁移读出；normalizeConn 在 migrateV2ToV3 内执行
    const rawConn = src.conn && typeof src.conn === 'object' ? src.conn : {}
    const points = normalizePoints(src.points)
    const validKeys = new Set(points.map((p) => p.id))
    const normValues = filterValues(src.values, validKeys)
    v2 = {
      version: 2,
      conn: rawConn,
      points,
      values: normValues,
      polling: normalizePolling(src.polling),
      alarmActive: src.alarmActive && typeof src.alarmActive === 'object' ? { ...src.alarmActive } : {},
      frames: src.frames || src.framesLog || src.framesByConnection,
      framesByConnection: src.framesByConnection,
    }
    if (src.framesByConnection) v2.framesByConnection = src.framesByConnection
  } else {
    // empty or unknown -> treat as v2 empty
    v2 = {
      version: 2,
      conn: normalizeConn(null),
      points: [],
      values: [],
      polling: normalizePolling(null),
      alarmActive: {},
    }
  }
  const migrated = migrateV2ToV3(v2)
  const configVersion = normalizeConfigVersion(src.configVersion ?? src.rev ?? 1)
  /** @type {any} */
  const ret = {
    version: 3,
    configVersion,
    connections: migrated.connections,
    devices: migrated.devices,
    points: migrated.points,
    values: migrated.values,
    activeConnectionId: migrated.activeConnectionId,
    activeDeviceId: migrated.activeDeviceId,
    pollingByConnection: migrated.pollingByConnection,
    framesByConnection: migrated.framesByConnection,
    alarmState: migrated.alarmState,
    share: normalizeShareFlags(null),
    sessionConfigs: {},
    privateClaimSessionId: '',
  }
  Object.defineProperties(ret, {
    conn: {
      get() {
        const ac = ret.connections.find((/** @type {any} */ c) => c.id === ret.activeConnectionId) || ret.connections[0]
        return ac ? ac.conn : emptyConn()
      },
      enumerable: false,
    },
    mode: {
      get() {
        return ret.conn.mode
      },
      enumerable: false,
    },
    port: {
      get() {
        return ret.conn.port
      },
      enumerable: false,
    },
    host: {
      get() {
        return ret.conn.host
      },
      enumerable: false,
    },
    baudrate: {
      get() {
        return ret.conn.baudrate
      },
      enumerable: false,
    },
    slave: {
      get() {
        const ad = ret.devices.find(
          (/** @type {any} */ d) => d.id === ret.activeDeviceId && d.connectionId === ret.activeConnectionId,
        )
        return ad ? ad.unitId : 1
      },
      enumerable: false,
    },
    sim: {
      get() {
        return ret.conn.sim
      },
      enumerable: false,
    },
    polling: {
      get() {
        return ret.pollingByConnection[ret.activeConnectionId] || normalizePolling(null)
      },
      enumerable: false,
    },
    alarmActive: {
      get() {
        return ret.alarmState
      },
      enumerable: false,
    },
    function: {
      get() {
        return ret.points[0]?.function
      },
      enumerable: false,
    },
    address: {
      get() {
        return ret.points[0]?.address
      },
      enumerable: false,
    },
    segments: {
      get() {
        return ret.points.map((/** @type {any} */ p) => ({ ...p, count: 1, id: p.id }))
      },
      enumerable: false,
    },
  })
  return ret
}

/**
 * @param {any} modbus
 * @param {any} patch
 */
export const patchConn = (modbus, patch) => {
  const normalized = normalizeModbus(modbus)
  const activeId = normalized.activeConnectionId
  // 连接补丁只改端点参数；忽略 legacy slave，不得改写设备 Unit ID
  const raw = patch && typeof patch === 'object' ? { ...patch } : {}
  raw.slave = undefined
  const nextConns = normalized.connections.map((/** @type {any} */ c) =>
    c.id === activeId ? { ...c, conn: normalizeConn({ ...c.conn, ...raw }) } : c,
  )
  return normalizeModbus({
    ...normalized,
    connections: nextConns,
    devices: normalized.devices,
  })
}

// ── Legacy compat for old tests (recipePair etc.) ─────────────────────
export const recipePair = () => ({
  devices: [
    {
      id: 'd1',
      name: '主机',
      role: 'master',
      mode: 'rtu',
      port: 'COM1',
      baudrate: 9600,
      slave: 1,
      sim: true,
      segments: [],
    },
    {
      id: 'd2',
      name: '从机',
      role: 'slave',
      mode: 'rtu',
      port: 'COM2',
      baudrate: 9600,
      slave: 2,
      sim: true,
      segments: [{ id: 's1', name: '保持', function: 3, address: 0, count: 10 }],
    },
  ],
  activeId: 'd1',
})
