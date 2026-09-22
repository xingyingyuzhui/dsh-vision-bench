// @ts-check
/**
 * Poll target → session ownership without guessing.
 * Explicit sessionId verifies ownership; inference only when one private
 * session owns the connection; shared connections follow share rules.
 *
 * Batch resolution (`resolvePollTargets`) enumerates RAW shared + private
 * layers first — union must never hide a private-id collision.
 */
import { ERROR_CODES } from '../../domain/modbus/errors.mjs'
import { isCategoryShared, normalizeScopeSessionId } from '../../domain/modbus/config-scope.mjs'

/**
 * @typedef {{
 *   connectionId: string,
 *   sourceSessionId: string,
 *   shared: boolean,
 * }} ResolvedPollTarget
 */

/**
 * @typedef {{
 *   connectionId: string,
 *   owners: string[],
 * }} PollOwnershipConflict
 */

/**
 * Build raw candidate owners per connectionId from shared + every private layer.
 * `shared` owners are recorded as the sentinel `__shared__`.
 *
 * @param {any} modbus
 * @returns {{ ownersByConnectionId: Map<string, string[]>, endpointsByConnectionId: Map<string, string> }}
 */
function enumerateRawConnectionOwners(modbus) {
  const scMap = modbus.sessionConfigs && typeof modbus.sessionConfigs === 'object' ? modbus.sessionConfigs : {}
  const connectionsShared = isCategoryShared(modbus.share, 'connections')
  /** @type {Map<string, string[]>} */
  const ownersByConnectionId = new Map()
  /** @type {Map<string, string>} */
  const endpointsByConnectionId = new Map()

  /**
   * @param {string} cid
   * @param {string} owner
   * @param {any} conn
   */
  const add = (cid, owner, conn) => {
    if (!cid) return
    const list = ownersByConnectionId.get(cid) || []
    if (!list.includes(owner)) list.push(owner)
    ownersByConnectionId.set(cid, list)
    const ep = endpointKey(conn)
    if (ep && !endpointsByConnectionId.has(cid)) endpointsByConnectionId.set(cid, ep)
  }

  for (const c of Array.isArray(modbus.connections) ? modbus.connections : []) {
    if (!c || !c.id) continue
    add(String(c.id), connectionsShared ? '__shared__' : '__toplevel__', c)
  }
  for (const sid of Object.keys(scMap)) {
    const sc = scMap[sid]
    if (!sc || typeof sc !== 'object') continue
    for (const c of Array.isArray(sc.connections) ? sc.connections : []) {
      if (!c || !c.id) continue
      add(String(c.id), sid, c)
    }
  }
  return { ownersByConnectionId, endpointsByConnectionId }
}

/**
 * @param {any} conn
 * @returns {string}
 */
function endpointKey(conn) {
  if (!conn || typeof conn !== 'object') return ''
  const src = conn.conn && typeof conn.conn === 'object' ? conn.conn : conn
  return [src.mode || '', src.port || '', src.host || '', src.tcpPort || '', src.baudrate || ''].join('|')
}

/**
 * Resolve one connection's poll ownership from the raw candidate table.
 *
 * @param {Map<string, string[]>} ownersByConnectionId
 * @param {string} cid
 * @param {string} sid explicit session or ''
 * @param {{ boundId?: string }} [opts]
 * @returns {ResolvedPollTarget | { error: 'ambiguous-owner' | 'target-mismatch' | 'connection-not-found', owners: string[] }}
 */
function resolveOneConnection(ownersByConnectionId, cid, sid, opts = {}) {
  const owners = ownersByConnectionId.get(cid) || []
  const privateOwners = owners.filter((o) => o !== '__shared__' && o !== '__toplevel__')
  const hasShared = owners.includes('__shared__')
  const hasTop = owners.includes('__toplevel__')

  if (sid) {
    // Explicit session is the only authorization that can pick among private twins.
    if (privateOwners.includes(sid)) {
      return { connectionId: cid, sourceSessionId: sid, shared: false }
    }
    if (hasShared) {
      return { connectionId: cid, sourceSessionId: sid, shared: true }
    }
    // Legacy unpartitioned top-level remains visible to a claiming session.
    if (hasTop && privateOwners.length === 0) {
      return { connectionId: cid, sourceSessionId: sid, shared: true }
    }
    return { error: 'target-mismatch', owners }
  }

  if (hasShared && privateOwners.length === 0) {
    return { connectionId: cid, sourceSessionId: '', shared: true }
  }
  if (privateOwners.length === 1 && !hasShared) {
    // Unique private owner. Top-level twin without share is not an extra owner.
    return { connectionId: cid, sourceSessionId: privateOwners[0], shared: false }
  }
  if (privateOwners.length === 1 && hasShared) {
    // Shared definition wins only when share is on (hasShared already encodes that).
    return { connectionId: cid, sourceSessionId: '', shared: true }
  }
  if (privateOwners.length === 0 && hasTop) {
    // Unpartitioned legacy workspace.
    return { connectionId: cid, sourceSessionId: '', shared: true }
  }
  if (privateOwners.length > 1) {
    return { error: 'ambiguous-owner', owners: privateOwners }
  }
  if (!owners.length) {
    return { error: 'connection-not-found', owners: [] }
  }
  return { error: 'ambiguous-owner', owners }
}

/**
 * Full batch pre-check: every connection that would be collected must resolve
 * before any transport/commit. One ambiguous target fails the whole round.
 *
 * @param {any} workspace
 * @param {{ sessionId?: string, connectionId?: string, connId?: string }} target
 * @returns {{
 *   ok: true,
 *   targets: ResolvedPollTarget[],
 *   conflicts: PollOwnershipConflict[],
 * } | {
 *   ok: false,
 *   errorCode: string,
 *   reason: string,
 *   error: string,
 *   conflicts: PollOwnershipConflict[],
 * }}
 */
export function resolvePollTargets(workspace, target) {
  const modbus = workspace?.modbus || {}
  const sid = normalizeScopeSessionId(target.sessionId)
  const cid = String(target.connectionId || target.connId || '').trim()
  const { ownersByConnectionId } = enumerateRawConnectionOwners(modbus)
  const scMap = modbus.sessionConfigs && typeof modbus.sessionConfigs === 'object' ? modbus.sessionConfigs : {}
  const partitioned = Object.keys(scMap).length > 0

  /** @type {string[]} */
  let candidateIds
  if (cid) {
    candidateIds = [cid]
  } else if (sid) {
    // Explicit session default view: its own private connections + shared.
    /** @type {string[]} */
    const ids = []
    const sc = scMap[sid]
    for (const c of Array.isArray(sc?.connections) ? sc.connections : []) {
      if (c?.id && !ids.includes(String(c.id))) ids.push(String(c.id))
    }
    for (const [id, owners] of ownersByConnectionId) {
      if (owners.includes('__shared__') && !ids.includes(id)) ids.push(id)
    }
    // Legacy top-level when the session has not claimed a private slice yet.
    if (!ids.length && !partitioned) {
      for (const id of ownersByConnectionId.keys()) ids.push(id)
    }
    candidateIds = ids
  } else {
    candidateIds = [...ownersByConnectionId.keys()]
  }

  if (!candidateIds.length) {
    return {
      ok: false,
      errorCode: ERROR_CODES.CONNECTION_NOT_FOUND,
      reason: 'connection-not-found',
      error: cid ? `连接不存在: ${cid}` : '无可用连接',
      conflicts: [],
    }
  }

  /** @type {ResolvedPollTarget[]} */
  const targets = []
  /** @type {PollOwnershipConflict[]} */
  const conflicts = []
  /** @type {string[]} */
  const reasons = []
  for (const id of candidateIds) {
    const resolved = resolveOneConnection(ownersByConnectionId, id, sid)
    if ('error' in resolved) {
      if (resolved.error === 'connection-not-found' && !cid) continue
      conflicts.push({ connectionId: id, owners: resolved.owners })
      reasons.push(resolved.error)
      continue
    }
    targets.push(resolved)
  }

  if (conflicts.length) {
    const reason = reasons.includes('ambiguous-owner')
      ? 'ambiguous-owner'
      : reasons.includes('target-mismatch')
        ? 'target-mismatch'
        : 'connection-not-found'
    const errorCode =
      reason === 'ambiguous-owner'
        ? ERROR_CODES.AMBIGUOUS_OWNER
        : reason === 'target-mismatch'
          ? ERROR_CODES.TARGET_MISMATCH
          : ERROR_CODES.CONNECTION_NOT_FOUND
    return {
      ok: false,
      errorCode,
      reason,
      error: `连接归属无法判定: ${conflicts.map((c) => `${c.connectionId}(${(c.owners || []).join(',') || 'none'})`).join('；')}`,
      conflicts,
    }
  }
  if (!targets.length) {
    return {
      ok: false,
      errorCode: ERROR_CODES.CONNECTION_NOT_FOUND,
      reason: 'connection-not-found',
      error: cid ? `连接不存在: ${cid}` : '无可用连接',
      conflicts: [],
    }
  }
  return { ok: true, targets, conflicts: [] }
}

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
  const batch = resolvePollTargets(workspace, target)
  if (!batch.ok) {
    const owners = batch.conflicts[0]?.owners || []
    return {
      ok: false,
      targetSessionId: '',
      shared: false,
      errorCode: batch.errorCode,
      error: batch.error,
      reason: batch.reason,
      owners,
    }
  }
  const first = batch.targets[0]
  return {
    ok: true,
    targetSessionId: first.sourceSessionId,
    shared: first.shared,
  }
}
