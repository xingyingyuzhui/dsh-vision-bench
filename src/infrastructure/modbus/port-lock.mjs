// @ts-check
// Host-side COM key helper. Physical owner tables live in the I/O Worker.
import { portKey } from '../../domain/modbus/port-key.mjs'

export { portKey }

/**
 * @typedef {{ chain: Promise<unknown>, busy: boolean }} PortLockEntry
 */

/** @type {Map<string, PortLockEntry>} */
const portLocks = new Map()

/** @param {unknown} port */
export const isPortBusy = (port) => {
  const entry = portLocks.get(portKey(port))
  return !!(entry && entry.busy)
}

/**
 * @template T
 * @param {unknown} port
 * @param {() => T | Promise<T>} fn
 * @returns {Promise<T>}
 */
export const withPortLock = async (port, fn) => {
  const key = portKey(port)
  if (!key) return fn()
  const entry = portLocks.get(key) || { chain: Promise.resolve(), busy: false }
  portLocks.set(key, entry)
  const run = entry.chain.then(() => {
    entry.busy = true
    return fn()
  })
  const settle = run.then(
    (value) => {
      entry.busy = false
      return value
    },
    (error) => {
      entry.busy = false
      throw error
    },
  )
  entry.chain = settle.catch(() => {
    /* keep the chain alive */
  })
  return settle
}
