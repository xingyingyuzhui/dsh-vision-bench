// @ts-check
/**
 * Legacy-claim eligibility and raw share-mutation preparation (review7 R1).
 *
 * share.* candidate validation must see the RAW layer rows — same-layer deviceId
 * twins have to be REJECTED, never silently deduped. The normal scope pipeline
 * (`ensureScopeFields` → `normalizeSessionConfigs` → `keepIdentified`) dedupes by
 * id, so `resolveMutationScope` may not run it before `applyShareFlags` captures
 * the raw candidate rows. This module prepares a share candidate without
 * normalize/dedupe/trim and shares the legacy-claim eligibility predicate with
 * `claimLegacyPrivate`, so claim semantics cannot drift between the two paths.
 *
 * One-way dependency: `config-scope-service.mjs` imports from here (never the
 * reverse), and this module stays on domain helpers + `normalizeModbus`.
 */
import { normalizeModbus } from '../../domain/modbus/modbus-migration.mjs'
import {
  emptySessionConfig,
  emptyShareFlags,
  normalizeScopeSessionId,
} from '../../domain/modbus/config-scope.mjs'

/** @typedef {import('../../domain/modbus/config-scope.mjs').SessionConfig} SessionConfig */

/**
 * Pick the topology slice out of a flat modbus or a stored SessionConfig.
 * Array references are preserved as-is (no normalize, no dedupe).
 * @param {any} source
 * @returns {SessionConfig}
 */
export function pickTopology(source) {
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
 * Fingerprint of the normalized topology (connections, devices, points, visualization
 * components). Used to detect whether a workspace carries any real config vs. the
 * defaults normalizeModbus synthesizes for an empty store (c1 / d1 / no points).
 * Read-only probe: the normalization result never replaces a candidate.
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
 * Whether `sessionConfigs` holds at least one usable session partition. Only key
 * and value-object validity is judged (mirrors normalizeSessionConfigs key
 * filtering) — slice rows are never normalized or deduped here.
 * @param {unknown} sessionConfigs
 * @returns {boolean}
 */
function hasSessionPartition(sessionConfigs) {
  if (!sessionConfigs || typeof sessionConfigs !== 'object' || Array.isArray(sessionConfigs)) return false
  for (const [key, value] of Object.entries(sessionConfigs)) {
    if (normalizeScopeSessionId(key) && value && typeof value === 'object') return true
  }
  return false
}

/**
 * Shared legacy-claim eligibility: claim only when ALL hold — a non-empty
 * sessionId, no claim marker yet, no session partition yet, and real top-level
 * topology. Used by `claimLegacyPrivate` and `prepareRawShareMutation`.
 * @param {any} modbus raw (or lightly normalized) layered modbus
 * @param {string} sessionId
 * @returns {boolean}
 */
export function isLegacyClaimable(modbus, sessionId) {
  const sid = normalizeScopeSessionId(sessionId)
  if (!sid) return false
  const src = modbus && typeof modbus === 'object' ? modbus : {}
  if (normalizeScopeSessionId(src.privateClaimSessionId)) return false
  if (hasSessionPartition(src.sessionConfigs)) return false
  return hasTopology(src)
}

/**
 * Prepare the candidate for a share.* mutation without touching the raw rows.
 *
 * - not claimable → the input is returned as-is (layers stay raw: no
 *   normalizeModbus / normalizeSessionConfig / ensureScopeFields, no count trim,
 *   no id dedupe) so `applyShareFlags` can reject same-layer deviceId twins
 * - claimable → legacy claim per the original semantics, except the copied
 *   topology keeps RAW rows (claiming must not drop a twin before validation):
 *   top-level topology moves into sessionConfigs[sessionId], top-level topology
 *   is cleared, share resets to emptyShareFlags, the claim marker is set and
 *   runtime state is preserved
 *
 * All changes live in the returned candidate; the input is never mutated and a
 * rejected candidate persists nothing (no claim marker, no flags, no version).
 * @param {any} modbus layered (or legacy flat) modbus
 * @param {string} sessionId
 * @returns {{ modbus: any, claimed: boolean }}
 */
export function prepareRawShareMutation(modbus, sessionId) {
  const src = modbus && typeof modbus === 'object' ? modbus : {}
  if (!isLegacyClaimable(src, sessionId)) return { modbus: src, claimed: false }
  const sid = normalizeScopeSessionId(sessionId)
  return {
    modbus: {
      ...src,
      ...emptySessionConfig(),
      share: emptyShareFlags(),
      sessionConfigs: { [sid]: pickTopology(src) },
      privateClaimSessionId: sid,
    },
    claimed: true,
  }
}
