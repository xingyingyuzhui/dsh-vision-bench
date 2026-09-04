// @ts-check
/**
 * Session-private config scope: pure shape helpers shared by `bench-devices.mjs`
 * (normalizeModbus must persist these fields) and the application-level
 * `config-scope-service.mjs` (claim / project / fold / share semantics).
 *
 * Kept dependency-free on purpose: bench-devices imports this module, and the
 * service imports bench-devices, so anything heavier here would create a cycle.
 *
 * Layered store shape (persisted inside `workspace.modbus`):
 *   - top-level connections / devices / points / visualization / active* = the
 *     WORKSPACE-SHARED slice (only meaningful per category when share.<cat> is on)
 *   - sessionConfigs[sessionId]                                        = private slices
 *   - share                                                             = share flags
 *   - privateClaimSessionId                                             = legacy claim marker
 *   - values / alarmState / trend / framesByConnection / pollingByConnection stay
 *     shared runtime state at top-level.
 */

/** Share categories. `connections` covers BOTH connections and devices (one product checkbox). */
export const SHARE_CATEGORIES = /** @type {const} */ (['connections', 'points', 'visualization'])

/** @typedef {(typeof SHARE_CATEGORIES)[number]} ShareCategory */

/**
 * @typedef {{
 *   enabled: boolean,
 *   connections: boolean,
 *   points: boolean,
 *   visualization: boolean,
 * }} ShareFlags
 */

/**
 * @typedef {{
 *   connections: any[],
 *   devices: any[],
 *   points: any[],
 *   visualization: any | null,
 *   activeConnectionId: string,
 *   activeDeviceId: string,
 * }} SessionConfig
 */

const MAX_SESSION_CONFIGS = 64
const MAX_SESSION_ID = 128

/** @param {unknown} value @returns {string} */
export const normalizeScopeSessionId = (value) =>
  typeof value === 'string' ? value.trim().slice(0, MAX_SESSION_ID) : ''

/** @returns {ShareFlags} */
export function emptyShareFlags() {
  return { enabled: false, connections: false, points: false, visualization: false }
}

/**
 * Coerce arbitrary input into ShareFlags. Every flag must be literally `true` to be on.
 * Category checkboxes are preserved even when `enabled` is false (the UI shows them
 * disabled); callers must use `effectiveShare()` to decide what is actually shared.
 * @param {unknown} input
 * @returns {ShareFlags}
 */
export function normalizeShareFlags(input) {
  const src = /** @type {Record<string, unknown>} */ (input && typeof input === 'object' ? input : {})
  return {
    enabled: src.enabled === true,
    connections: src.connections === true,
    points: src.points === true,
    visualization: src.visualization === true,
  }
}

/**
 * Whether a category is live-shared right now (master AND category on).
 * @param {unknown} share
 * @param {ShareCategory} category
 * @returns {boolean}
 */
export function isCategoryShared(share, category) {
  const flags = normalizeShareFlags(share)
  return flags.enabled && flags[category] === true
}

/** @returns {SessionConfig} */
export function emptySessionConfig() {
  return {
    connections: [],
    devices: [],
    points: [],
    visualization: null,
    activeConnectionId: '',
    activeDeviceId: '',
  }
}

/**
 * Keep only object entries that carry a string id. Private slices are stored
 * "raw-ish" and go through the full normalizeModbus pipeline on projection, so the
 * only invariant we enforce here is a stable id (otherwise projection would mint a
 * fresh id on every read).
 * @param {unknown} list
 * @param {number} max
 * @returns {any[]}
 */
function keepIdentified(list, max) {
  if (!Array.isArray(list)) return []
  /** @type {any[]} */
  const out = []
  const seen = new Set()
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(item)
    if (out.length >= max) break
  }
  return out
}

/**
 * Lightly normalize one session's private slice. Accepts an already-normalized
 * flat modbus (only topology keys are picked) or a stored SessionConfig.
 * @param {unknown} input
 * @returns {SessionConfig}
 */
export function normalizeSessionConfig(input) {
  const src = /** @type {Record<string, any>} */ (input && typeof input === 'object' ? input : {})
  const visualization =
    src.visualization && typeof src.visualization === 'object' && !Array.isArray(src.visualization)
      ? src.visualization
      : null
  return {
    connections: keepIdentified(src.connections, 16),
    devices: keepIdentified(src.devices, 64),
    points: keepIdentified(src.points, 256),
    visualization,
    activeConnectionId: normalizeScopeSessionId(src.activeConnectionId),
    activeDeviceId: normalizeScopeSessionId(src.activeDeviceId),
  }
}

/**
 * Normalize the sessionId → SessionConfig map. Entries without a usable key are dropped.
 * @param {unknown} input
 * @returns {Record<string, SessionConfig>}
 */
export function normalizeSessionConfigs(input) {
  /** @type {Record<string, SessionConfig>} */
  const out = {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out
  let count = 0
  for (const [rawKey, value] of Object.entries(input)) {
    const key = normalizeScopeSessionId(rawKey)
    if (!key || !value || typeof value !== 'object') continue
    out[key] = normalizeSessionConfig(value)
    count += 1
    if (count >= MAX_SESSION_CONFIGS) break
  }
  return out
}

/**
 * Collect identified rows across the shared slice and every private slice.
 * First id wins. Used so shared runtime (values / trend / alarms / commit) still
 * sees topology that only lives in a session-private layer.
 * @param {unknown} topLevel
 * @param {unknown} sessionConfigs
 * @param {'connections' | 'devices' | 'points'} field
 * @returns {any[]}
 */
function unionScopedField(topLevel, sessionConfigs, field) {
  /** @type {any[]} */
  const out = []
  const seen = new Set()
  /** @param {unknown} list */
  const push = (list) => {
    if (!Array.isArray(list)) return
    for (const row of list) {
      const id = row && typeof row === 'object' && typeof row.id === 'string' ? row.id : ''
      if (!id || seen.has(id)) continue
      seen.add(id)
      out.push(row)
    }
  }
  push(topLevel)
  const map = sessionConfigs && typeof sessionConfigs === 'object' ? Object.values(sessionConfigs) : []
  for (const cfg of map) {
    push(cfg && typeof cfg === 'object' ? /** @type {any} */ (cfg)[field] : null)
  }
  return out
}

/**
 * Collect points across the shared slice and every private slice. Used by
 * normalizeModbus so shared runtime `values` are not dropped just because a point
 * lives in a private layer rather than at top-level.
 * @param {unknown} topLevelPoints
 * @param {unknown} sessionConfigs
 * @returns {any[]}
 */
export function unionScopedPoints(topLevelPoints, sessionConfigs) {
  return unionScopedField(topLevelPoints, sessionConfigs, 'points')
}

/** @param {unknown} topLevel @param {unknown} sessionConfigs @returns {any[]} */
export function unionScopedConnections(topLevel, sessionConfigs) {
  return unionScopedField(topLevel, sessionConfigs, 'connections')
}

/** @param {unknown} topLevel @param {unknown} sessionConfigs @returns {any[]} */
export function unionScopedDevices(topLevel, sessionConfigs) {
  return unionScopedField(topLevel, sessionConfigs, 'devices')
}

/**
 * A workspace is "partitioned" once any session owns a private layer (legacy claim
 * or first scoped write). From then on topology edits must name their session.
 * @param {unknown} modbus layered modbus
 * @returns {boolean}
 */
export function isScopePartitioned(modbus) {
  const src = /** @type {Record<string, any>} */ (modbus && typeof modbus === 'object' ? modbus : {})
  if (normalizeScopeSessionId(src.privateClaimSessionId)) return true
  const configs = src.sessionConfigs
  return Boolean(configs && typeof configs === 'object' && Object.keys(configs).length > 0)
}

/**
 * Strip other sessions' private layers before handing a modbus view to a client.
 * `share` and `privateClaimSessionId` stay so the settings UI can render the toggles.
 * @template {Record<string, any>} T
 * @param {T} modbus
 * @returns {Omit<T, 'sessionConfigs'>}
 */
export function omitSessionConfigs(modbus) {
  const src = /** @type {Record<string, any>} */ (modbus && typeof modbus === 'object' ? modbus : {})
  const { sessionConfigs, ...rest } = src
  void sessionConfigs
  return /** @type {Omit<T, 'sessionConfigs'>} */ (rest)
}
