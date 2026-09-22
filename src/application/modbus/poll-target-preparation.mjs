// @ts-check
/**
 * Prepare executable poll targets from resolved ownership.
 * Shared by precheck and execution so both see the same read set.
 */
import { modbusForSession } from './workspace-session-view.mjs'
import { normalizeModbus } from './modbus-migration.mjs'
import {
  isScopePartitioned,
  normalizeSessionConfigs,
  unionScopedConnections,
  unionScopedDevices,
  unionScopedPoints,
} from '../../domain/modbus/config-scope.mjs'
import { resolvePointDevice } from '../../domain/modbus/device-identity.mjs'

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
 * Device relationship check for every point that will be read.
 * @param {PreparedPollTarget[]} executable
 * @returns {{ ok: true } | { ok: false, errorCode: string, error: string, reason: string, conflicts?: any[] }}
 */
export function validateDeviceRouting(executable) {
  for (const t of executable) {
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
    }
  }
  return { ok: true }
}
