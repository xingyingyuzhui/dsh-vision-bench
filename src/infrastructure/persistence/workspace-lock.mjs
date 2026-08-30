// @ts-check
/** Per-workspace exclusive run queue (Host process). Different keys may run in parallel. */

/** @type {Map<string, Promise<unknown>>} */
const chains = new Map()

/**
 * Serialize async work for one workspace key.
 * @template T
 * @param {string} key
 * @param {() => Promise<T> | T} fn
 * @returns {Promise<T>}
 */
export function runExclusive(key, fn) {
  const id = String(key || '')
  const prev = chains.get(id) || Promise.resolve()
  const next = prev.catch(() => {}).then(() => fn())
  const tracked = next.finally(() => {
    if (chains.get(id) === tracked) chains.delete(id)
  })
  chains.set(id, tracked)
  return /** @type {Promise<T>} */ (next)
}

/** Sync re-entrancy guard for migration / test seed only. Not visible to runExclusive. */
const syncBusy = new Set()

/**
 * @template T
 * @param {string} key
 * @param {() => T} fn
 * @returns {T}
 */
export function runExclusiveSync(key, fn) {
  const id = String(key || '')
  if (syncBusy.has(id)) return fn()
  syncBusy.add(id)
  try {
    return fn()
  } finally {
    syncBusy.delete(id)
  }
}
