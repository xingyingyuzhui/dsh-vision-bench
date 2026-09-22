// @ts-check
/**
 * Runtime identity pre-check for poll batches.
 *
 * Three distinct sets:
 *  1. RAW config rows (shared + each private layer) — discover duplicates, never pre-union.
 *  2. EFFECTIVE identities — after share/projection semantics; a private row that
 *     is shadowed by the shared definition of the same pointId is NOT effective.
 *  3. THIS read set — executable targets' points only.
 *
 * Connection ownership unique does NOT imply a unique runtime slot: values,
 * trend, alarmState and commit merge by pointId. Two different EFFECTIVE private
 * definitions writing the same pointId clobber each other, so the batch is
 * rejected BEFORE any transport / frame / runtime commit.
 *
 * Explicit sessionId resolves target ownership — it cannot repair a shared
 * runtime key collision this round (no key migration).
 */
import { ERROR_CODES } from '../../domain/modbus/errors.mjs'
import { isCategoryShared } from '../../domain/modbus/config-scope.mjs'

/**
 * @typedef {{
 *   layer: 'shared' | 'private' | 'toplevel',
 *   sessionId: string,
 *   connectionId: string,
 *   deviceId: string,
 *   pointId: string,
 *   function: number,
 *   address: number,
 * }} PointIdentity
 */

/**
 * @typedef {{
 *   entityType: 'point' | 'device' | 'connection',
 *   entityId: string,
 *   owners: string[],
 *   connectionIds: string[],
 * }} PollRuntimeConflict
 */

/**
 * Structured identity — no JSON string surgery on owner prefixes.
 * @param {any} p
 * @param {'shared' | 'private' | 'toplevel'} layer
 * @param {string} sessionId
 * @returns {PointIdentity}
 */
function toPointIdentity(p, layer, sessionId) {
  return {
    layer,
    sessionId,
    connectionId: String(p?.connectionId || p?.connId || ''),
    deviceId: String(p?.deviceId || ''),
    pointId: String(p?.id || ''),
    function: Number(p?.function) || 0,
    address: Number(p?.address) || 0,
  }
}

/**
 * Same logical definition ⇒ same geometry regardless of which view sees it.
 * Owner/session is NOT part of geometry — a shared row seen twice is one object.
 * Two private rows with the same geometry are STILL distinct objects (layer+session).
 * @param {PointIdentity} a
 * @param {PointIdentity} b
 */
function sameGeometry(a, b) {
  return (
    a.connectionId === b.connectionId &&
    a.deviceId === b.deviceId &&
    a.pointId === b.pointId &&
    a.function === b.function &&
    a.address === b.address
  )
}

/**
 * @param {PointIdentity} a
 * @param {PointIdentity} b
 */
function sameObject(a, b) {
  return a.layer === b.layer && a.sessionId === b.sessionId && sameGeometry(a, b)
}

/**
 * Effective identity rows for one pointId.
 * When points are shared, the shared definition owns the slot — private backups
 * of the same id are shadowed (kept on disk, excluded from this judgment).
 *
 * @param {any} modbus
 * @param {string} pointId
 * @returns {{ effective: PointIdentity[], raw: PointIdentity[] }}
 */
function identitiesForPoint(modbus, pointId) {
  const scMap = modbus.sessionConfigs && typeof modbus.sessionConfigs === 'object' ? modbus.sessionConfigs : {}
  const pointsShared = isCategoryShared(modbus.share, 'points')
  const partitioned = Object.keys(scMap).length > 0
  /** @type {PointIdentity[]} */
  const raw = []

  for (const p of Array.isArray(modbus.points) ? modbus.points : []) {
    if (!p || String(p.id) !== pointId) continue
    raw.push(toPointIdentity(p, pointsShared ? 'shared' : 'toplevel', ''))
  }
  for (const sid of Object.keys(scMap)) {
    const sc = scMap[sid]
    if (!sc || typeof sc !== 'object') continue
    for (const p of Array.isArray(sc.points) ? sc.points : []) {
      if (!p || String(p.id) !== pointId) continue
      raw.push(toPointIdentity(p, 'private', sid))
    }
  }

  /** @type {PointIdentity[]} */
  const effective = []
  const sharedRows = raw.filter((r) => r.layer === 'shared')
  const privateRows = raw.filter((r) => r.layer === 'private')
  const topRows = raw.filter((r) => r.layer === 'toplevel')

  // One shared object — de-dupe identical shared geometry (multiple views).
  for (const s of sharedRows) {
    if (!effective.some((e) => sameObject(e, s) || (e.layer === 'shared' && sameGeometry(e, s)))) {
      effective.push(s)
    }
  }

  if (pointsShared) {
    // Shared definition wins. Private backups of this id are shadowed — not effective.
    // If there is NO shared row, private defs remain effective (points not actually shared).
    if (sharedRows.length) return { effective, raw }
  }

  if (!partitioned) {
    // Legacy unpartitioned workspace: top-level is the effective definition.
    for (const t of topRows) {
      if (!effective.some((e) => sameObject(e, t))) effective.push(t)
    }
    return { effective, raw }
  }

  // Partitioned + not shared: each private definition is an effective object.
  // Distinct sessions are distinct objects even with identical geometry.
  for (const pr of privateRows) {
    if (!effective.some((e) => sameObject(e, pr))) effective.push(pr)
  }
  // Unshared top-level leftovers in a partitioned workspace are not extra owners
  // for the slot when private layers own the id — but if ONLY top-level has it
  // (legacy claim in progress), keep it.
  if (!privateRows.length) {
    for (const t of topRows) {
      if (!effective.some((e) => sameObject(e, t))) effective.push(t)
    }
  }
  return { effective, raw }
}

/**
 * Effective rows conflict when they are more than one logical object and are not
 * merely the same shared object seen twice.
 * @param {PointIdentity[]} effective
 * @returns {boolean}
 */
function effectiveRowsConflict(effective) {
  if (effective.length <= 1) return false
  const shared = effective.filter((r) => r.layer === 'shared')
  const others = effective.filter((r) => r.layer !== 'shared')
  // More than one shared geometry is already a raw-config oddity → conflict.
  if (shared.length > 1) {
    const geoms = new Set(shared.map((r) => JSON.stringify([r.connectionId, r.deviceId, r.function, r.address])))
    if (geoms.size > 1) return true
    if (others.length) return true
  }
  // Any non-shared pair (private×private or private×shared) is multiple owners
  // of one runtime slot.
  if (others.length > 1) return true
  if (shared.length && others.length) return true
  return false
}

/**
 * @param {PointIdentity[]} rows
 * @returns {PollRuntimeConflict}
 */
function conflictFromRows(rows) {
  return {
    entityType: 'point',
    entityId: rows[0]?.pointId || '',
    owners: [...new Set(rows.map((r) => (r.layer === 'private' ? r.sessionId || r.layer : r.layer)))],
    connectionIds: [...new Set(rows.map((r) => r.connectionId).filter(Boolean))],
  }
}

/**
 * Validate runtime point identities for the points this batch will actually read.
 * Unrelated conflicting pointIds do not block the call.
 *
 * @param {any} workspace
 * @param {Array<{ connectionId: string, sourceSessionId: string, points: any[] }>} readTargets
 * @returns {{ ok: true } | { ok: false, errorCode: string, reason: string, error: string, conflicts: PollRuntimeConflict[] }}
 */
export function validatePollRuntimeIdentities(workspace, readTargets) {
  const modbus = workspace?.modbus || {}
  /** @type {PollRuntimeConflict[]} */
  const conflicts = []

  /** Point ids this batch will read. */
  /** @type {Set<string>} */
  const readPointIds = new Set()
  for (const t of readTargets || []) {
    for (const p of Array.isArray(t.points) ? t.points : []) {
      if (p?.id) readPointIds.add(String(p.id))
    }
  }

  // Batch-internal duplicates: same pointId prepared for two connections/sessions.
  /** @type {Map<string, Set<string>>} */
  const batchOwnersByPoint = new Map()
  for (const t of readTargets || []) {
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
      conflicts.push({
        entityType: 'point',
        entityId: pid,
        owners: [...keys].map((k) => k.split('|')[0]),
        connectionIds: [...keys].map((k) => k.split('|')[1]),
      })
    }
  }

  // Cross-layer definition conflicts for points this batch touches.
  for (const pid of readPointIds) {
    if (conflicts.some((c) => c.entityType === 'point' && c.entityId === pid)) continue
    const { effective } = identitiesForPoint(modbus, pid)
    if (!effectiveRowsConflict(effective)) continue
    conflicts.push(conflictFromRows(effective))
  }

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
