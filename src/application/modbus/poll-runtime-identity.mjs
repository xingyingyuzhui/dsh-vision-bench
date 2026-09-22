// @ts-check
/**
 * Runtime identity pre-check for poll batches.
 *
 * Connection ownership unique does NOT imply a unique runtime slot: values,
 * trend, alarmState and commit merge by pointId. Two different private
 * definitions writing the same pointId would clobber each other, so the whole
 * batch is rejected BEFORE any transport / frame / runtime commit.
 *
 * Explicit sessionId resolves target ownership — it cannot repair a shared
 * runtime key collision this round (no key migration).
 */
import { ERROR_CODES } from '../../domain/modbus/errors.mjs'
import { isCategoryShared, normalizeScopeSessionId } from '../../domain/modbus/config-scope.mjs'

/**
 * @typedef {{
 *   entityType: 'point' | 'device' | 'connection',
 *   entityId: string,
 *   owners: string[],
 *   connectionIds: string[],
 * }} PollRuntimeConflict
 */

/**
 * Identity of one raw point definition. Two private defs with the same
 * address/endpoint are still distinct identities.
 * @param {any} p
 * @param {string} owner
 * @param {string} connectionId
 */
function pointIdentity(p, owner, connectionId) {
  return JSON.stringify([
    owner,
    connectionId,
    String(p?.deviceId || ''),
    String(p?.id || ''),
    Number(p?.function) || 0,
    Number(p?.address) || 0,
  ])
}

/**
 * Enumerate raw point identities from shared + every private layer.
 * Never union first — union hides same-id twins.
 *
 * @param {any} modbus
 * @returns {Map<string, Array<{ owner: string, connectionId: string, identity: string }>>}
 */
function enumerateRawPointIdentities(modbus) {
  const scMap = modbus.sessionConfigs && typeof modbus.sessionConfigs === 'object' ? modbus.sessionConfigs : {}
  const pointsShared = isCategoryShared(modbus.share, 'points')
  /** @type {Map<string, Array<{ owner: string, connectionId: string, identity: string }>>} */
  const byPointId = new Map()

  /**
   * @param {any} p
   * @param {string} owner
   */
  const add = (p, owner) => {
    if (!p || !p.id) return
    const pid = String(p.id)
    const cid = String(p.connectionId || p.connId || '')
    const list = byPointId.get(pid) || []
    list.push({ owner, connectionId: cid, identity: pointIdentity(p, owner, cid) })
    byPointId.set(pid, list)
  }

  for (const p of Array.isArray(modbus.points) ? modbus.points : []) {
    add(p, pointsShared ? '__shared__' : '__toplevel__')
  }
  for (const sid of Object.keys(scMap)) {
    const sc = scMap[sid]
    if (!sc || typeof sc !== 'object') continue
    for (const p of Array.isArray(sc.points) ? sc.points : []) {
      add(p, sid)
    }
  }
  return byPointId
}

/**
 * Same shared definition seen from multiple effective views collapses to one.
 * Private twins with equal addresses stay distinct identities.
 *
 * @param {Array<{ owner: string, connectionId: string, identity: string }>} rows
 * @returns {boolean} true when rows represent more than one logical definition
 */
function hasConflictingDefinitions(rows) {
  const sharedRows = rows.filter((r) => r.owner === '__shared__')
  const privateRows = rows.filter((r) => r.owner !== '__shared__' && r.owner !== '__toplevel__')
  // Shared def is one object regardless of how many views see it.
  const sharedIdentities = new Set(sharedRows.map((r) => r.identity.replace('"__shared__"', '"__ANY__"')))
  // Private defs: owner is part of identity — twins never merge.
  const privateIdentities = new Set(
    privateRows.map((r) => {
      // Normalize owner out only for comparing geometry? No — plan: two private
      // definitions with the same address are still not the same shared object.
      // Distinct owners ⇒ distinct identities even if the rest matches.
      return r.identity
    }),
  )
  // Collapse identical private geometry under the SAME owner (dup rows).
  const byOwnerGeom = new Set(
    privateRows.map((r) => r.identity.replace(/^"\[[^,]+"/, '"[__GEOM__"')),
  )
  const owners = new Set(privateRows.map((r) => r.owner))
  // More than one private owner for this pointId ⇒ conflict (runtime slot is global).
  if (owners.size > 1) return true
  // Shared + private defining the same pointId ⇒ conflict unless they are the
  // exact same geometry AND only one side is active. Conservative: mixed = conflict.
  if (sharedRows.length && privateRows.length) {
    // If shared and the single private owner disagree on connection/geometry → conflict.
    const sGeom = sharedRows[0].identity.replace(/^"\[[^,]+"/, '"[__GEOM__"')
    for (const r of privateRows) {
      const pGeom = r.identity.replace(/^"\[[^,]+"/, '"[__GEOM__"')
      if (sGeom !== pGeom) return true
    }
  }
  // Multiple distinct geometries under one owner (should not happen) → conflict.
  if (byOwnerGeom.size > 1) return true
  if (sharedIdentities.size > 1) return true
  void privateIdentities
  return false
}

/**
 * Validate runtime point identities for the points this batch will actually read.
 * Unrelated conflicting pointIds do not block the call.
 *
 * @param {any} workspace
 * @param {Array<{ connectionId: string, sourceSessionId: string, points: any[] }>} preparedTargets
 * @returns {{ ok: true } | { ok: false, errorCode: string, reason: string, error: string, conflicts: PollRuntimeConflict[] }}
 */
export function validatePollRuntimeIdentities(workspace, preparedTargets) {
  const modbus = workspace?.modbus || {}
  const byPointId = enumerateRawPointIdentities(modbus)
  /** @type {PollRuntimeConflict[]} */
  const conflicts = []

  /** Point ids this batch will read. */
  /** @type {Set<string>} */
  const readPointIds = new Set()
  for (const t of preparedTargets || []) {
    for (const p of Array.isArray(t.points) ? t.points : []) {
      if (p?.id) readPointIds.add(String(p.id))
    }
  }

  // Batch-internal duplicates: same pointId prepared for two connections/sessions.
  /** @type {Map<string, Set<string>>} */
  const batchOwnersByPoint = new Map()
  for (const t of preparedTargets || []) {
    for (const p of Array.isArray(t.points) ? t.points : []) {
      if (!p?.id) continue
      const pid = String(p.id)
      const key = `${t.sourceSessionId || '__shared__'}|${t.connectionId}`
      const set = batchOwnersByPoint.get(pid) || new Set()
      set.add(key)
      batchOwnersByPoint.set(pid, set)
    }
  }
  for (const [pid, keys] of batchOwnersByPoint) {
    if (keys.size > 1) {
      const connectionIds = [...keys].map((k) => k.split('|')[1])
      const owners = [...keys].map((k) => k.split('|')[0])
      conflicts.push({
        entityType: 'point',
        entityId: pid,
        owners,
        connectionIds,
      })
    }
  }

  // Cross-layer definition conflicts for points this batch touches.
  for (const pid of readPointIds) {
    if (conflicts.some((c) => c.entityType === 'point' && c.entityId === pid)) continue
    const rows = byPointId.get(pid) || []
    if (rows.length <= 1) continue
    if (!hasConflictingDefinitions(rows)) continue
    conflicts.push({
      entityType: 'point',
      entityId: pid,
      owners: [...new Set(rows.map((r) => r.owner))],
      connectionIds: [...new Set(rows.map((r) => r.connectionId).filter(Boolean))],
    })
  }

  // Device ids: only conflict when the actual lookup/commit chain would mix
  // different device definitions under one runtime/query key AND this batch
  // touches them. Empirical rule: same deviceId on different connections is
  // safe when every read path is scoped by connectionId (see regression test).
  // No device conflict is raised for that case.

  if (conflicts.length) {
    const detail = conflicts
      .map((c) => `${c.entityType}:${c.entityId}(${c.owners.join(',')}/${c.connectionIds.join(',')})`)
      .join('；')
    return {
      ok: false,
      errorCode: ERROR_CODES.AMBIGUOUS_OWNER,
      reason: 'ambiguous-owner',
      error: `运行态点位身份冲突，需更换冲突点位 ID：${detail}`,
      conflicts,
    }
  }
  return { ok: true }
}

/**
 * @param {any} workspace
 * @param {Array<{ connectionId: string, sourceSessionId: string, points: any[] }>} preparedTargets
 */
export function _internalHasConflict(workspace, preparedTargets) {
  const r = validatePollRuntimeIdentities(workspace, preparedTargets)
  return !r.ok
}

export { normalizeScopeSessionId }
