// @ts-check
/**
 * Shared fixtures for points get tests (not a *.test.mjs — excluded from structure budget).
 */
import {
  registerVisionHost,
  unregisterVisionHost,
} from '../../src/infrastructure/host/vision-host-client.mjs'
import { createVisionCommandDispatcher } from '../../src/interfaces/http/vision-command-routes.mjs'
import { loadWorkspace } from '../../bench-store.mjs'

/**
 * @param {any} t
 * @param {string} home
 */
export function withRealHost(t, home) {
  unregisterVisionHost()
  const stop = registerVisionHost(createVisionCommandDispatcher(home))
  t.after(() => {
    stop()
    unregisterVisionHost()
  })
}

/**
 * @param {string} cwd
 * @param {string} [sessionId]
 */
export function agentOf(cwd, sessionId = 'session-a') {
  return { session: { header: { cwd, id: sessionId } } }
}

/**
 * @param {any} ws
 */
export function claimFingerprint(ws) {
  const mb = ws?.modbus || {}
  return {
    configVersion: mb.configVersion || 1,
    privateClaimSessionId: mb.privateClaimSessionId || '',
    sessionConfigKeys: Object.keys(mb.sessionConfigs || {}).sort(),
    flatPointCount: Array.isArray(mb.points) ? mb.points.length : 0,
  }
}

/**
 * @param {string} home
 * @param {string} cwd
 */
export function fingerprintOnDisk(home, cwd) {
  return claimFingerprint(loadWorkspace(home, cwd))
}

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
