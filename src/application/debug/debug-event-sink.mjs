// @ts-check
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Lifecycle / error events worth persisting to disk.
 *
 * The in-memory ring is the source of truth for the UI (cursor long-polling);
 * this sink exists purely for post-mortem diagnosis. Persisting *every* event
 * would put a synchronous write on the stepping hot path, so we persist only
 * the events that explain "why did this session die / start".
 */
const PERSISTED_TYPES = new Set([
  'debug.session.starting',
  'debug.session.ready',
  'debug.session.stopped',
  'debug.session.failed',
  'debug.session.closed',
  'debug.exception',
])

/**
 * @param {any} event
 * @returns {boolean}
 */
export function shouldPersistDebugEvent(event) {
  if (!event || typeof event !== 'object') return false
  if (PERSISTED_TYPES.has(String(event.type || ''))) return true
  // Any event carrying an error payload is worth keeping regardless of type.
  return Boolean(event.payload && event.payload.error)
}

/**
 * @param {string} home
 * @returns {string}
 */
export function debugJournalDir(home) {
  return join(home, 'vision-bench', 'debug-journal')
}

/**
 * Appends a debug event to a per-session NDJSON journal under `<home>/vision-bench/debug-journal/`.
 *
 * Best-effort by design: a diagnostic sink must never break the debug hot path,
 * so every failure (missing home, read-only disk, permission error) is swallowed.
 *
 * @param {string} home
 * @param {string} debugSessionId
 * @param {any} event
 * @returns {boolean} true when the line was written
 */
export function appendDebugEvent(home, debugSessionId, event) {
  if (!home || !debugSessionId || !shouldPersistDebugEvent(event)) return false
  try {
    const dir = debugJournalDir(home)
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, `${debugSessionId}.ndjson`), `${JSON.stringify(event)}\n`, 'utf8')
    return true
  } catch {
    return false
  }
}

/**
 * Wraps an in-memory debug event ring so every push is mirrored to disk.
 *
 * The wrapper MUST forward the whole ring interface: the ring object is handed
 * to the backend via `backendFactory(..., { eventRing })` and is also used for
 * cursor long-polling, so dropping any method would silently break the UI.
 *
 * @template T
 * @param {T} ring
 * @param {{ home?: string }} [options]
 * @returns {T}
 */
export function withDebugEventPersistence(ring, options = {}) {
  const home = String(options.home || '')
  if (!home) return ring

  /** @type {any} */
  const source = ring
  /** @type {any} */
  const wrapped = {
    /** @param {any} item */
    push(item) {
      const event = source.push(item)
      appendDebugEvent(home, event?.debugSessionId, event)
      return event
    },
    /** @param {any[]} args */
    getEventsSince: (...args) => source.getEventsSince(...args),
    /** @param {any[]} args */
    getEventsAfter: (...args) => source.getEventsAfter(...args),
    getCurrentCursor: () => source.getCurrentCursor(),
    /** @param {any[]} args */
    waitForEvents: (...args) => source.waitForEvents(...args),
    /** @param {any[]} args */
    waitForEventsAfter: (...args) => source.waitForEventsAfter(...args),
  }
  return wrapped
}
