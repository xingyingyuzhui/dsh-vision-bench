// @ts-check
import { normalizeAlarmState } from './alarm-model.mjs'
import { emptyVisualization, normalizeVisualizationForRead } from './visualization-model.mjs'
import { normalizeConn, normalizeConnections } from './connection-model.mjs'
import { normalizeDevices } from './device-model.mjs'
import {
  normalizeFramesByConnection,
  normalizePolling,
  normalizePollingByConnection,
  normalizeTrendByPoint,
} from './frames-buffer.mjs'
import {
  filterValues,
  normalizePoints,
  normalizePointsV3,
  normalizeQualifiedValues,
} from './point-model.mjs'
import {
  normalizeScopeSessionId,
  normalizeSessionConfigs,
  normalizeShareFlags,
  unionScopedPoints,
} from './config-scope.mjs'
import { attachLegacyCompatAccessors } from './modbus-compat-accessors.mjs'
import { devText, migrateLegacy, migrateV2ToV3 } from './modbus-migrate-steps.mjs'

export { migrateLegacy, migrateV2ToV3 }

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
    return attachLegacyCompatAccessors(ret, { includeExtended: true })
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
  return attachLegacyCompatAccessors(ret)
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
