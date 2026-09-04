// @ts-check
/**
 * Session-private Modbus/HMI config scope.
 *
 * Product rules (docs/plans/2026-09-03-001-session-private-modbus-share-requirements.md):
 *   - connections+devices, points, visualization are SESSION-private by default
 *   - Settings: master "share to workspace" + per-category checkboxes
 *   - category ON  → live shared editing of ONE workspace slice
 *   - category OFF → requires confirm; shared slice is revoked back into the
 *                    revoking session's private layer
 *   - legacy flat workspace → the first session to open it CLAIMS the topology
 *   - agent/UI writes land in the EFFECTIVE layer (shared if shared, else private)
 *   - values / alarmState / trend / framesByConnection / pollingByConnection stay
 *     shared runtime state at top-level
 *
 * All functions are pure: they never mutate their inputs and return new objects.
 * Layered store ⇄ flat session view:
 *   claimLegacyPrivate → projectModbusForSession → (applyOperation) → foldModbusFromSession
 */
import { normalizeModbus } from '../../../bench-devices.mjs'
import { ERROR_CODES } from '../../domain/modbus/errors.mjs'
import {
  SHARE_CATEGORIES,
  emptySessionConfig,
  emptyShareFlags,
  isCategoryShared,
  normalizeScopeSessionId,
  normalizeSessionConfig,
  normalizeSessionConfigs,
  normalizeShareFlags,
} from '../../domain/modbus/config-scope.mjs'

export {
  SHARE_CATEGORIES,
  emptySessionConfig,
  emptyShareFlags,
  isCategoryShared,
  normalizeSessionConfig,
  normalizeSessionConfigs,
  normalizeShareFlags,
}

/** @typedef {import('../../domain/modbus/config-scope.mjs').ShareFlags} ShareFlags */
/** @typedef {import('../../domain/modbus/config-scope.mjs').ShareCategory} ShareCategory */
/** @typedef {import('../../domain/modbus/config-scope.mjs').SessionConfig} SessionConfig */

/** Error codes used by this service (single source of truth: domain ERROR_CODES). */
export const SHARE_REVOKE_CONFIRM_REQUIRED = ERROR_CODES.SHARE_REVOKE_CONFIRM_REQUIRED
export const SHARE_SESSION_REQUIRED = ERROR_CODES.SESSION_REQUIRED

/** Runtime keys that always live at top-level and are shared across sessions. */
const RUNTIME_KEYS = /** @type {const} */ ([
  'configVersion',
  'values',
  'alarmState',
  'trend',
  'framesByConnection',
  'pollingByConnection',
])

/**
 * Pick the topology slice out of a flat modbus or a stored SessionConfig.
 * @param {any} source
 * @returns {SessionConfig}
 */
function pickTopology(source) {
  const src = source && typeof source === 'object' ? source : {}
  return {
    connections: Array.isArray(src.connections) ? src.connections : [],
    devices: Array.isArray(src.devices) ? src.devices : [],
    points: Array.isArray(src.points) ? src.points : [],
    visualization: src.visualization && typeof src.visualization === 'object' ? src.visualization : null,
    activeConnectionId: typeof src.activeConnectionId === 'string' ? src.activeConnectionId : '',
    activeDeviceId: typeof src.activeDeviceId === 'string' ? src.activeDeviceId : '',
  }
}

/**
 * Copy one share category from `from` into `to` (returns a new SessionConfig).
 * `connections` carries devices and the active ids along with it.
 * @param {SessionConfig} to
 * @param {SessionConfig} from
 * @param {ShareCategory} category
 * @returns {SessionConfig}
 */
function withCategory(to, from, category) {
  switch (category) {
    case 'connections':
      return {
        ...to,
        connections: from.connections,
        devices: from.devices,
        activeConnectionId: from.activeConnectionId,
        activeDeviceId: from.activeDeviceId,
      }
    case 'points':
      return { ...to, points: from.points }
    case 'visualization':
      return { ...to, visualization: from.visualization }
    default: {
      /** @type {never} */
      const exhaustive = category
      throw new Error(`unknown share category: ${String(exhaustive)}`)
    }
  }
}

/**
 * Fingerprint of the normalized topology (connections, devices, points, visualization
 * components). Used to detect whether a workspace carries any real config vs. the
 * defaults normalizeModbus synthesizes for an empty store (c1 / d1 / no points).
 * @param {any} modbus flat or layered modbus; only top-level topology is fingerprinted
 * @returns {string}
 */
export function topologyFingerprint(modbus) {
  const topo = pickTopology(modbus)
  const norm = normalizeModbus({ version: 3, ...topo })
  const viz = norm.visualization && typeof norm.visualization === 'object' ? norm.visualization : {}
  return JSON.stringify({
    connections: norm.connections,
    devices: norm.devices,
    points: norm.points,
    visualization: Array.isArray(viz.components) ? viz.components : [],
  })
}

const EMPTY_TOPOLOGY_FINGERPRINT = topologyFingerprint({})

/**
 * True when the top-level topology differs from the synthesized empty defaults.
 * @param {any} modbus
 * @returns {boolean}
 */
export function hasTopology(modbus) {
  return topologyFingerprint(modbus) !== EMPTY_TOPOLOGY_FINGERPRINT
}

/**
 * Ensure `share`, `sessionConfigs` and `privateClaimSessionId` exist and are
 * normalized. Returns a new object (input is not mutated). Does NOT run
 * normalizeModbus so callers can chain it cheaply.
 * @param {any} modbus
 * @returns {any}
 */
export function ensureScopeFields(modbus) {
  const src = modbus && typeof modbus === 'object' ? modbus : {}
  return {
    ...src,
    share: normalizeShareFlags(src.share),
    sessionConfigs: normalizeSessionConfigs(src.sessionConfigs),
    privateClaimSessionId: normalizeScopeSessionId(src.privateClaimSessionId),
  }
}

/**
 * Migration: the first session to open a legacy flat workspace claims the whole
 * top-level topology as its private config.
 *
 * Claims only when ALL hold: no claim yet, no session slices yet, and the top-level
 * carries real topology. An empty workspace stays unclaimed until the first writer
 * (foldModbusFromSession / applyShareFlags) stamps `privateClaimSessionId`, so a
 * later session can never "steal" an empty claim either.
 *
 * @param {any} modbus layered (or legacy flat) modbus
 * @param {string} sessionId
 * @returns {{ modbus: any, claimed: boolean }}
 */
export function claimLegacyPrivate(modbus, sessionId) {
  const base = ensureScopeFields(modbus)
  const sid = normalizeScopeSessionId(sessionId)
  if (!sid) return { modbus: base, claimed: false }
  if (base.privateClaimSessionId) return { modbus: base, claimed: false }
  if (Object.keys(base.sessionConfigs).length) return { modbus: base, claimed: false }
  if (!hasTopology(base)) return { modbus: base, claimed: false }
  const claimedTopology = normalizeSessionConfig(pickTopology(base))
  const next = normalizeModbus({
    ...base,
    ...emptySessionConfig(),
    share: emptyShareFlags(),
    sessionConfigs: { [sid]: claimedTopology },
    privateClaimSessionId: sid,
  })
  return { modbus: next, claimed: true }
}

/**
 * Build the effective FLAT topology view for one session.
 *
 * Per category: shared (top-level) when `share.enabled && share.<category>`, else
 * that session's private slice. `connections` covers devices and active ids.
 * Runtime fields (configVersion, values, alarms, polling, frames, trend) come from
 * top-level; `share`, `sessionConfigs`, `privateClaimSessionId` are carried through
 * so the projection can be folded back with foldModbusFromSession.
 *
 * Note: normalizeModbus repairs dangling point→connection/device references against
 * the projected connections. In mixed mode (e.g. shared connections + private
 * points) a private point bound to a private connection is re-pointed to the first
 * shared connection in the VIEW; folding writes that repaired point back.
 *
 * @param {any} modbus layered modbus
 * @param {string} sessionId
 * @returns {any} normalized flat modbus for this session
 */
export function projectModbusForSession(modbus, sessionId) {
  const base = ensureScopeFields(modbus)
  const sid = normalizeScopeSessionId(sessionId)
  const shared = pickTopology(base)
  const priv = pickTopology(sid ? base.sessionConfigs[sid] : null)
  let topo = emptySessionConfig()
  for (const category of SHARE_CATEGORIES) {
    topo = withCategory(topo, isCategoryShared(base.share, category) ? shared : priv, category)
  }
  return normalizeModbus({ ...base, ...topo })
}

/**
 * Fold a projected (flat, per-session) modbus back into the layered store.
 *
 * - topology categories go to shared or to sessionConfigs[sessionId] per flags
 * - other sessions' private slices are preserved verbatim
 * - runtime fields are taken from `projected` (mutations may drop values etc.);
 *   values missing from the projection (e.g. shared points hidden from a private
 *   view) are retained from `base` and re-filtered by normalizeModbus against the
 *   union of all layers
 * - `projected.share`, when present, updates the flags (no revoke semantics here —
 *   use applyShareFlags for user-facing toggles)
 * - stamps `privateClaimSessionId` on first write so legacy claim can't fire later
 *
 * @param {any} baseModbus layered modbus the projection was built from
 * @param {any} projectedModbus result of applyOperation on projectModbusForSession(...)
 * @param {string} sessionId
 * @returns {any} normalized layered modbus
 */
export function foldModbusFromSession(baseModbus, projectedModbus, sessionId) {
  const base = ensureScopeFields(baseModbus)
  const sid = normalizeScopeSessionId(sessionId)
  const proj = projectedModbus && typeof projectedModbus === 'object' ? projectedModbus : {}
  const share = proj.share !== undefined ? normalizeShareFlags(proj.share) : base.share
  const view = pickTopology(proj)
  let shared = pickTopology(base)
  let priv = pickTopology(sid ? base.sessionConfigs[sid] : null)
  for (const category of SHARE_CATEGORIES) {
    if (isCategoryShared(share, category)) shared = withCategory(shared, view, category)
    else if (sid) priv = withCategory(priv, view, category)
  }
  /** @type {Record<string, SessionConfig>} */
  const sessionConfigs = { ...base.sessionConfigs }
  if (sid) sessionConfigs[sid] = normalizeSessionConfig(priv)

  /** @type {Record<string, any>} */
  const runtime = {}
  for (const key of RUNTIME_KEYS) {
    if (proj[key] !== undefined) runtime[key] = proj[key]
  }
  runtime.values = mergeValues(proj.values, base.values)

  return normalizeModbus({
    ...base,
    ...runtime,
    ...shared,
    share,
    sessionConfigs,
    privateClaimSessionId: base.privateClaimSessionId || sid,
  })
}

/**
 * Projected values win; base values for points the projection did not see are kept.
 * normalizeModbus drops anything whose point no longer exists in any layer.
 * @param {any} projectedValues
 * @param {any} baseValues
 * @returns {any[]}
 */
function mergeValues(projectedValues, baseValues) {
  const out = Array.isArray(projectedValues) ? projectedValues.slice() : []
  const seen = new Set(out.map((v) => v && (v.pointId || v.key || v.id)).filter(Boolean))
  for (const v of Array.isArray(baseValues) ? baseValues : []) {
    const id = v && (v.pointId || v.key || v.id)
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(v)
  }
  return out
}

/**
 * Apply a share-flag update with publish / revoke semantics.
 *
 * Effective share per category = `enabled && <category>`.
 * - category becomes effective   → PUBLISH: copy the session's private slice into shared
 *                                   (replacing the shared category)
 * - category stops being effective → REVOKE: requires `opts.confirmed === true`; moves
 *                                   the shared category into sessionConfigs[sessionId]
 *                                   (replacing that session's private category) and
 *                                   clears the shared category
 * - master off                    → revokes every effective category (same rules)
 *
 * Confirmation is only demanded when something is actually revoked; toggling flags
 * that change nothing effective is a no-op update.
 *
 * @param {any} modbus layered modbus
 * @param {string} sessionId session performing the toggle
 * @param {Partial<ShareFlags> | any} nextShare
 * @param {{ confirmed?: boolean }} [opts]
 * @returns {{ ok: true, modbus: any, published: ShareCategory[], revoked: ShareCategory[] }
 *   | { ok: false, errorCode: string, error: string, needsConfirm?: boolean, revoked?: ShareCategory[] }}
 */
export function applyShareFlags(modbus, sessionId, nextShare, opts = {}) {
  const base = ensureScopeFields(modbus)
  const sid = normalizeScopeSessionId(sessionId)
  if (!sid) return { ok: false, errorCode: SHARE_SESSION_REQUIRED, error: '共享设置必须携带 sessionId' }
  const prev = base.share
  const next = normalizeShareFlags(nextShare)
  /** @type {ShareCategory[]} */
  const published = []
  /** @type {ShareCategory[]} */
  const revoked = []
  for (const category of SHARE_CATEGORIES) {
    const was = isCategoryShared(prev, category)
    const will = isCategoryShared(next, category)
    if (!was && will) published.push(category)
    else if (was && !will) revoked.push(category)
  }
  if (revoked.length && opts.confirmed !== true) {
    return {
      ok: false,
      errorCode: SHARE_REVOKE_CONFIRM_REQUIRED,
      needsConfirm: true,
      revoked,
      error: '关闭共享将使其他会话失去这些配置的可见性，需要确认',
    }
  }
  let shared = pickTopology(base)
  let priv = pickTopology(base.sessionConfigs[sid])
  const empty = emptySessionConfig()
  for (const category of published) shared = withCategory(shared, priv, category)
  for (const category of revoked) {
    priv = withCategory(priv, shared, category)
    shared = withCategory(shared, empty, category)
  }
  const sessionConfigs = { ...base.sessionConfigs, [sid]: normalizeSessionConfig(priv) }
  const nextModbus = normalizeModbus({
    ...base,
    ...shared,
    share: next,
    sessionConfigs,
    privateClaimSessionId: base.privateClaimSessionId || sid,
  })
  return { ok: true, modbus: nextModbus, published, revoked }
}
