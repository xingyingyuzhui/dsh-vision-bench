// Poll-time read planner: independent points, efficient bus. Points sharing a
// function code are merged while their addresses stay contiguous, producing at
// most one transaction per contiguous window (spec limits respected).

export const MAX_READ_REGS = 125
export const MAX_READ_COILS = 2000

const spanLimitFor = (fc) => (fc === 1 || fc === 2 ? MAX_READ_COILS : MAX_READ_REGS)

// points: normalized [{function, address}] — order irrelevant.
// returns [{fc, address, count}] sorted by fc then address.
export function planReadBatches(points) {
  const groups = new Map()
  for (const p of Array.isArray(points) ? points : []) {
    const fn = Number(p && p.function)
    const addr = Number(p && p.address)
    if (![1, 2, 3, 4].includes(fn)) continue
    if (!Number.isFinite(addr) || addr < 0 || addr > 65535) continue
    if (!groups.has(fn)) groups.set(fn, [])
    groups.get(fn).push(addr)
  }
  const batches = []
  for (const fn of [1, 2, 3, 4]) {
    const addrs = groups.get(fn)
    if (!addrs || !addrs.length) continue
    addrs.sort((a, b) => a - b)
    let start = addrs[0]
    let prev = start
    for (let i = 1; i <= addrs.length; i++) {
      const cur = addrs[i]
      const contiguous = cur === prev + 1
      const withinSpan = cur - start + 1 <= spanLimitFor(fn)
      if (i < addrs.length && contiguous && withinSpan) {
        prev = cur
        continue
      }
      batches.push({ fc: fn, address: start, count: prev - start + 1 })
      if (cur !== undefined && Number.isFinite(cur)) {
        start = cur
        prev = cur
      }
    }
  }
  return batches
}

export function planScopedReadBatches(points) {
  const buckets = new Map()
  for (const p of Array.isArray(points) ? points : []) {
    const connectionId = String(p.connectionId || p.connId || '')
    const deviceId = String(p.deviceId || '')
    const unitId = Math.min(247, Math.max(1, Math.trunc(Number(p.unitId) || 1)))
    const functionCode = Number(p.function) || 3
    const key = [connectionId, deviceId, unitId, functionCode].join('\0')
    if (!buckets.has(key)) {
      buckets.set(key, { connectionId, deviceId, unitId, functionCode, points: [] })
    }
    buckets.get(key).points.push(p)
  }
  const scopes = []
  for (const scope of buckets.values()) {
    const batches = planReadBatches(scope.points).map((batch) => ({
      ...batch,
      connectionId: scope.connectionId,
      deviceId: scope.deviceId,
      unitId: scope.unitId,
    }))
    scopes.push({ ...scope, batches })
  }
  return scopes
}
