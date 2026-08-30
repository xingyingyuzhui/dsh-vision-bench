// @ts-check
import { createHash } from 'node:crypto'

const DEFAULT_TTL_MS = 10 * 60 * 1000
const DEFAULT_MAX = 1000

/**
 * @param {any} value
 * @returns {any}
 */
function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {}
    for (const key of Object.keys(value).sort()) out[key] = stable(value[key])
    return out
  }
  return value
}

/**
 * @param {any} cmd
 * @returns {any}
 */
export function commandFingerprint(cmd) {
  const body = {
    action: cmd.action || '',
    payload: cmd.payload || {},
    expectedConfigVersion: cmd.expectedConfigVersion ?? null,
    cwd: cmd.cwd || '',
    sessionId: cmd.sessionId || '',
    source: cmd.source || '',
  }
  return createHash('sha256')
    .update(JSON.stringify(stable(body)))
    .digest('hex')
}

/**
 * @param {any} cmd
 * @returns {any}
 */
export function commandCacheKey(cmd) {
  return [cmd.home, cmd.cwd, cmd.sessionId, cmd.source, cmd.commandId]
    .map((/** @type {any} */ part) => encodeURIComponent(String(part ?? '')))
    .join('|')
}

/**
 * @param {any} options
 * @returns {any}
 */
export function createCommandIdempotencyCache(options = {}) {
  const ttlMs = Number(options.ttlMs) > 0 ? Number(options.ttlMs) : DEFAULT_TTL_MS
  const maxEntries = Number(options.maxEntries) > 0 ? Number(options.maxEntries) : DEFAULT_MAX
  /** @type {Map<string, { fingerprint: string, startedAt: number, promise: Promise<unknown>, result?: object, completedAt?: number }>} */
  const entries = new Map()

  /**
   * @returns {any}
   */
  const prune = () => {
    const now = Date.now()
    for (const [key, row] of entries) {
      if (row.completedAt && now - row.completedAt > ttlMs) entries.delete(key)
    }
    while (entries.size > maxEntries) {
      const completed = [...entries.entries()].filter(([, row]) => row.completedAt)
      if (!completed.length) break
      completed.sort((a, b) => (a[1].completedAt || 0) - (b[1].completedAt || 0))
      entries.delete(completed[0][0])
    }
  }

  /**
   * @param {any} cmd
   * @param {any} executor
   * @returns {Promise<any>}
   */
  const run = async (/** @type {any} */ cmd, /** @type {any} */ executor) => {
    const commandId = String(cmd.commandId || '').trim()
    if (!commandId) return executor()
    prune()
    const key = commandCacheKey(cmd)
    const fingerprint = commandFingerprint(cmd)
    const existing = entries.get(key)
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return {
          ok: false,
          errorCode: 'COMMAND_ID_REUSE',
          error: '同一 commandId 已用于不同命令',
          commandId,
        }
      }
      const result = /** @type {any} */ (await existing.promise)
      return { ...result, commandId, idempotent: true }
    }
    const startedAt = Date.now()
    const promise = Promise.resolve()
      .then(() => executor())
      .then((result) => {
        const row = entries.get(key)
        if (row) {
          row.result = result
          row.completedAt = Date.now()
        }
        return result
      })
    entries.set(key, { fingerprint, startedAt, promise })
    return promise
  }

  return { run, _internal: { entries, prune, commandCacheKey, commandFingerprint } }
}

export const globalCommandIdempotency = createCommandIdempotencyCache()
