// @ts-check
/** Shared arrange for multi-connection Modbus suites. */
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { connection } from '../helpers/workspace-factory.mjs'

/** RTU client connection with sim enabled. */
export function rtuSim(id, port, overrides = {}) {
  return {
    ...connection(id, 'rtu', port, { sim: true, ...overrides.conn }),
    name: overrides.name || id,
    enabled: overrides.enabled !== false,
  }
}

/** Device row bound to a connection. */
export function device(id, connectionId, unitId = 1, name) {
  return { id, connectionId, name: name || id.toUpperCase(), unitId }
}

/** Holding-register point row. */
export function hrPoint(id, connectionId, deviceId, address, extras = {}) {
  return {
    id,
    connectionId,
    deviceId,
    name: extras.name || id,
    area: 'holdingRegister',
    function: 3,
    address,
    ...extras,
  }
}

/**
 * Synthetic frames for ring-buffer tests.
 * @param {string} prefix
 * @param {number} n
 * @param {string} [connectionId]
 */
export function genFrames(prefix, n, connectionId) {
  return Array.from({ length: n }, (_, i) => ({
    t: Date.now() + i,
    label: prefix + i,
    request: 'REQ ' + i,
    response: 'RESP ' + i,
    trace: connectionId ? ['trace' + i] : [],
    ...(connectionId ? { connectionId, deviceId: 'd1' } : {}),
  }))
}

/** Re-enable sim after a local write flips it off. */
export function reenableSim(home, cwd, connectionId = 'c1') {
  const cur = loadWorkspace(home, cwd)
  const nextConns = cur.modbus.connections.map((c) =>
    c.id === connectionId ? { ...c, conn: { ...c.conn, sim: true } } : c,
  )
  saveWorkspace(home, cwd, { modbus: { connections: nextConns } })
}

/** Dual RTU-sim topology (c1/COM3 + c2/COM4) with matching devices. */
export function dualConnTopology(extra = {}) {
  return {
    version: 3,
    connections: [rtuSim('c1', 'COM3', { name: 'C1' }), rtuSim('c2', 'COM4', { name: 'C2' })],
    devices: [device('d1', 'c1', 1, 'D1'), device('d2', 'c2', 2, 'D2')],
    points: [],
    ...extra,
  }
}
