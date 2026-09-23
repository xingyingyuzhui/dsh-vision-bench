// @ts-check
/**
 * Prepare executable poll targets from resolved ownership.
 * Shared by precheck and execution so both see the same read set.
 */
import { modbusForSession } from './workspace-session-view.mjs'
import { normalizeModbus } from '../../domain/modbus/modbus-migration.mjs'
import {
  isScopePartitioned,
  normalizeSessionConfigs,
  unionScopedConnections,
  unionScopedDevices,
  unionScopedPoints,
} from '../../domain/modbus/config-scope.mjs'
import { resolvePointDevice } from '../../domain/modbus/device-identity.mjs'
import { planScopedReadBatches } from '../../domain/modbus/poll-plan.mjs'

/**
 * @typedef {{
 *   connectionId: string,
 *   sourceSessionId: string,
 *   shared: boolean,
 *   pack: any,
 *   connection: any,
 *   points: any[],
 * }} PreparedPollTarget
 */

/**
 * @param {any} workspace
 * @param {{ connectionId: string, sourceSessionId: string, shared: boolean }} t
 */
export function packForTarget(workspace, t) {
  if (t.sourceSessionId) return modbusForSession(workspace, t.sourceSessionId)
  if (isScopePartitioned(workspace.modbus)) {
    const sc = normalizeSessionConfigs(workspace.modbus.sessionConfigs)
    return normalizeModbus({
      ...workspace.modbus,
      connections: unionScopedConnections(workspace.modbus.connections, sc, workspace.modbus.share),
      devices: unionScopedDevices(workspace.modbus.devices, sc, workspace.modbus.share),
      points: unionScopedPoints(workspace.modbus.points, sc, workspace.modbus.share),
    })
  }
  return normalizeModbus(workspace.modbus)
}

/**
 * @param {any} workspace
 * @param {Array<{ connectionId: string, sourceSessionId: string, shared: boolean }>} targets
 * @returns {PreparedPollTarget[]}
 */
export function prepareTargetViews(workspace, targets) {
  return (targets || []).map((t) => {
    const pack = packForTarget(workspace, t)
    const connection = pack.connections.find((/** @type {any} */ c) => c.id === t.connectionId) || null
    const points = pack.points.filter(
      (/** @type {any} */ p) => (p.connectionId || p.connId) === t.connectionId,
    )
    return { ...t, pack, connection, points }
  })
}

/**
 * Executable connections only (enabled). Empty connections stay out of the read set.
 * @param {PreparedPollTarget[]} prepared
 */
export function prepareReadTargets(prepared) {
  /** @type {Array<PreparedPollTarget & { connObj: any }>} */
  const executable = []
  for (const t of prepared) {
    if (t.connection && t.connection.enabled !== false) {
      executable.push({
        ...t,
        connObj: {
          ...t.connection,
          __sourceSessionId: t.sourceSessionId,
          __shared: t.shared,
          __pack: t.pack,
          __points: t.points,
        },
      })
    }
  }
  return executable
}

/**
 * @typedef {{
 *   connection: any,
 *   device: any,
 *   connectionId: string,
 *   deviceId: string,
 *   unitId: number,
 *   points: any[],
 *   batches: any[],
 * }} PreparedReadScope
 */

/**
 * Device relationship check + bind every scope to its validated device.
 * Strict: missing deviceId or missing device row is DEVICE_NOT_FOUND — no
 * "only one device on the connection" inference and no silent default unit.
 *
 * @param {PreparedPollTarget[]} executable
 * @returns {{ ok: true, targets: Array<PreparedPollTarget & { scopes: PreparedReadScope[] }> }
 *   | { ok: false, errorCode: string, error: string, reason: string, conflicts?: any[] }}
 */
export function preparePollReadPlan(executable) {
  /** @type {Array<PreparedPollTarget & { scopes: PreparedReadScope[] }>} */
  const targets = []
  for (const t of executable) {
    /** @type {Map<string, { device: any, points: any[] }>} */
    const byDevice = new Map()
    for (const p of t.points) {
      const routed = resolvePointDevice(t.pack, p, t.connectionId)
      if (!routed.ok) {
        return {
          ok: false,
          errorCode: routed.errorCode,
          error: routed.error,
          reason: 'device-routing',
          conflicts: routed.conflicts,
        }
      }
      const device = routed.device
      const key = JSON.stringify([String(device.id), Number(device.unitId) || 0])
      const slot = byDevice.get(key) || { device, points: [] }
      // Collection copy only — never write back to config.
      slot.points.push({ ...p, deviceId: device.id, unitId: Number(device.unitId) || 0 })
      byDevice.set(key, slot)
    }
    /** @type {PreparedReadScope[]} */
    const scopes = []
    for (const { device, points } of byDevice.values()) {
      if (device.connectionId && device.connectionId !== t.connectionId) {
        return {
          ok: false,
          errorCode: 'TARGET_MISMATCH',
          error: `设备 ${device.id} 属于连接 ${device.connectionId}，与 ${t.connectionId} 不一致`,
          reason: 'device-routing',
        }
      }
      const planned = planScopedReadBatches(points)
      for (const scope of planned) {
        if (String(scope.deviceId) !== String(device.id)) {
          return {
            ok: false,
            errorCode: 'AMBIGUOUS_OWNER',
            error: `读批次设备 ${scope.deviceId} 与已解析设备 ${device.id} 不一致`,
            reason: 'device-routing',
          }
        }
        if (scope.connectionId && scope.connectionId !== t.connectionId) {
          return {
            ok: false,
            errorCode: 'TARGET_MISMATCH',
            error: `读批次连接 ${scope.connectionId} 与目标 ${t.connectionId} 不一致`,
            reason: 'device-routing',
          }
        }
        scopes.push({
          connection: t.connection,
          device,
          connectionId: t.connectionId,
          deviceId: String(device.id),
          unitId: Number(device.unitId) || 0,
          points: scope.points || points,
          batches: scope.batches || [],
        })
      }
    }
    targets.push({ ...t, scopes })
  }
  return { ok: true, targets }
}

/**
 * Device relationship check for every point that will be read.
 * @param {PreparedPollTarget[]} executable
 * @returns {{ ok: true } | { ok: false, errorCode: string, error: string, reason: string, conflicts?: any[] }}
 */
export function validateDeviceRouting(executable) {
  const plan = preparePollReadPlan(executable)
  if (!plan.ok) return plan
  return { ok: true }
}
