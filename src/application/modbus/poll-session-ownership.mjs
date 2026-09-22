// @ts-check
/**
 * Poll target → session ownership without guessing.
 * Explicit sessionId verifies ownership; inference only when one private
 * session owns the connection; shared connections follow share rules.
 */
import { ERROR_CODES } from '../../domain/modbus/errors.mjs'
import { isCategoryShared, normalizeScopeSessionId } from '../../domain/modbus/config-scope.mjs'

/**
 * @param {any} workspace
 * @param {{ sessionId?: string, connectionId?: string, connId?: string }} target
 * @returns {{
 *   ok: boolean,
 *   targetSessionId: string,
 *   shared: boolean,
 *   errorCode?: string,
 *   error?: string,
 *   reason?: string,
 *   owners?: string[],
 * }}
 */
export function resolvePollSessionOwnership(workspace, target) {
  const modbus = workspace?.modbus || {}
  const scMap = modbus.sessionConfigs && typeof modbus.sessionConfigs === 'object' ? modbus.sessionConfigs : {}
  const share = modbus.share
  const connectionsShared = isCategoryShared(share, 'connections')
  const cid = String(target.connectionId || target.connId || '').trim()
  const sid = normalizeScopeSessionId(target.sessionId)

  /** @param {string} sessionKey */
  const sessionHasConnection = (sessionKey) => {
    const sc = scMap[sessionKey]
    if (!sc || typeof sc !== 'object') return false
    return (Array.isArray(sc.connections) ? sc.connections : []).some((/** @type {any} */ c) => c && c.id === cid)
  }

  const topLevelHasConnection = (Array.isArray(modbus.connections) ? modbus.connections : []).some(
    (/** @type {any} */ c) => c && c.id === cid,
  )

  if (sid) {
    if (!cid) return { ok: true, targetSessionId: sid, shared: false }
    if (sessionHasConnection(sid)) return { ok: true, targetSessionId: sid, shared: false }
    if (connectionsShared && topLevelHasConnection) {
      return { ok: true, targetSessionId: sid, shared: true }
    }
    return {
      ok: false,
      targetSessionId: '',
      shared: false,
      errorCode: ERROR_CODES.TARGET_MISMATCH,
      error: `会话 ${sid} 无权访问连接 ${cid}`,
      reason: 'target-mismatch',
    }
  }

  if (!cid) {
    const bound = String(workspace?.session?.boundId || '')
    if (bound && scMap[bound]) return { ok: true, targetSessionId: bound, shared: false }
    return { ok: true, targetSessionId: '', shared: true }
  }

  if (connectionsShared && topLevelHasConnection) {
    return { ok: true, targetSessionId: '', shared: true }
  }

  /** @type {string[]} */
  const owners = Object.keys(scMap).filter((key) => sessionHasConnection(key))
  if (owners.length === 1) return { ok: true, targetSessionId: owners[0], shared: false }
  if (owners.length === 0) {
    if (topLevelHasConnection) return { ok: true, targetSessionId: '', shared: true }
    return {
      ok: false,
      targetSessionId: '',
      shared: false,
      errorCode: ERROR_CODES.CONNECTION_NOT_FOUND,
      error: `连接不存在: ${cid}`,
      reason: 'connection-not-found',
    }
  }
  return {
    ok: false,
    targetSessionId: '',
    shared: false,
    errorCode: ERROR_CODES.AMBIGUOUS_OWNER,
    error: `连接 ${cid} 被多个私有会话持有，无法判定归属`,
    reason: 'ambiguous-owner',
    owners,
  }
}
