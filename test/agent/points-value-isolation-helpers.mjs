// @ts-check
/**
 * Shared fixtures for points value-isolation tests (not a *.test.mjs).
 */
import assert from 'node:assert/strict'
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { connection } from '../helpers/workspace-factory.mjs'

/**
 * @param {string} id
 * @param {string} connectionId
 * @param {string} deviceId
 * @param {number} address
 */
export function pt(id, connectionId, deviceId, address) {
  return {
    id,
    connectionId,
    deviceId,
    name: id,
    area: 'holdingRegister',
    function: 3,
    address,
  }
}

/**
 * Dual private sessions with same pointId on different connections.
 * Global values default to B's triple (leaks into A under bare-id join).
 *
 * @param {string} home
 * @param {string} cwd
 * @param {{ values?: any[], reverseSessions?: boolean }} [opts]
 */
export function seedDualPrivateSamePointId(home, cwd, opts = {}) {
  const aSession = {
    connections: [connection('c1', 'tcp', '', { sim: true })],
    devices: [{ id: 'dc1', connectionId: 'c1', name: 'A', unitId: 1 }],
    points: [pt('p', 'c1', 'dc1', 0)],
    visualization: { schemaVersion: 2, components: [] },
  }
  const bSession = {
    connections: [connection('c2', 'tcp', '', { sim: true })],
    devices: [{ id: 'dc2', connectionId: 'c2', name: 'B', unitId: 1 }],
    points: [pt('p', 'c2', 'dc2', 0)],
    visualization: { schemaVersion: 2, components: [] },
  }
  const sessionConfigs = opts.reverseSessions
    ? { 'session-b': bSession, 'session-a': aSession }
    : { 'session-a': aSession, 'session-b': bSession }
  const values =
    opts.values ||
    [
      {
        key: 'p',
        pointId: 'p',
        connectionId: 'c2',
        deviceId: 'dc2',
        raw: 9876,
        value: 9876,
        ok: true,
        at: 1_700_000_000_000,
      },
    ]
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 4,
      connections: [],
      devices: [],
      points: [],
      values,
      share: { enabled: false, connections: false, points: false, visualization: false },
      privateClaimSessionId: 'session-a',
      sessionConfigs,
    },
  })
  return loadWorkspace(home, cwd)
}

/**
 * @param {any} row
 * @param {{ expectConn?: string, expectDev?: string }} [expect]
 */
export function assertHiddenValue(row, expect = {}) {
  assert.equal(row.raw, null)
  assert.equal(row.value, null)
  assert.equal(row.ok, false)
  assert.equal(row.at, 0)
  assert.equal(row.valueStatus, 'unavailable')
  if (expect.expectConn) assert.equal(row.connectionId, expect.expectConn)
  if (expect.expectDev) assert.equal(row.deviceId, expect.expectDev)
  assert.notEqual(row.raw, 9876)
  assert.notEqual(row.at, 1_700_000_000_000)
}

/**
 * @param {any} ws
 */
export function runtimeFingerprint(ws) {
  const mb = ws?.modbus || {}
  return {
    configVersion: mb.configVersion || 1,
    privateClaimSessionId: mb.privateClaimSessionId || '',
    sessionConfigKeys: Object.keys(mb.sessionConfigs || {}).sort(),
    values: JSON.stringify(mb.values || []),
    flatPointCount: Array.isArray(mb.points) ? mb.points.length : 0,
  }
}
