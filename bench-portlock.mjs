// Serial ports are exclusive on Windows: every pymodbus transaction goes through
// a per-port mutex so readers, writers and polls never open the same COM twice.
const portLocks = new Map()

export const portKey = (port) =>
  String(port || '').replace(/^\\\\\.\\/, '').trim().toUpperCase()

export const isPortBusy = (port) => {
  const entry = portLocks.get(portKey(port))
  return !!(entry && entry.busy)
}

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
  entry.chain = settle.catch(() => { /* keep the chain alive */ })
  return settle
}
