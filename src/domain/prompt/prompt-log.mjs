// @ts-check
const MAX_LOG = 8
const SUMMARY_CAP = 180

/** Actions emitted by recordBenchEvent / known short-log producers. */
export const KNOWN_LOG_ACTIONS = new Set([
  'select-project',
  'build',
  'read',
  'write',
  'connect',
  'alarm',
  'alarm-clear',
  'focus',
  'event',
])

export const emptyLog = () => []

/**
 * @param {any} [input]
 * @returns {string}
 */
function resolveKind(input) {
  const raw = typeof input?.kind === 'string' ? input.kind.trim() : ''
  if (raw && KNOWN_LOG_ACTIONS.has(raw)) return raw
  const action = typeof input?.action === 'string' ? input.action.trim() : ''
  if (action && KNOWN_LOG_ACTIONS.has(action)) return action
  if (action) return 'event'
  return 'event'
}

/**
 * @param {any} [input]
 * @returns {any}
 */
export const normalizeEvent = (input) => {
  const hasV2 = Number(input?.schemaVersion) >= 2 || input?.kind != null
  const kind = resolveKind(input)
  // Known action keeps its label for UI; unknown producers collapse to event.
  const actionRaw = typeof input?.action === 'string' ? input.action.trim() : ''
  const action = KNOWN_LOG_ACTIONS.has(actionRaw) ? actionRaw : kind === 'event' && actionRaw ? 'event' : kind
  const summary = String((input && input.summary) || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SUMMARY_CAP)
  const at = Number(input && input.at)
  /** @type {Record<string, unknown>} */
  const row = {
    at: Number.isFinite(at) && at > 0 ? at : Date.now(),
    action,
    kind,
    ok: !!(input && input.ok),
    summary,
    schemaVersion: 2,
  }
  // Pre-v2 rows that already said action=build cannot be reclassified.
  if (!hasV2 && actionRaw === 'build') {
    row.legacyTypeUnverified = true
  } else if (input?.legacyTypeUnverified === true) {
    row.legacyTypeUnverified = true
  }
  return row
}

/**
 * @param {any} [prev]
 * @param {any} [event]
 * @returns {any}
 */
export const mergeLog = (prev, event) => {
  const next = [normalizeEvent(event)]
  const old = Array.isArray(prev) ? prev : []
  for (const item of old) {
    if (next.length >= MAX_LOG) break
    next.push(normalizeEvent(item))
  }
  return next
}
