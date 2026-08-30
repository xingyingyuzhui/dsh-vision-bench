// Task1.1/0.19.2: fixed-size frame ring with a CORRECT cursor.
//
// cursor semantics: cursor points at the LAST RECORD ACTUALLY RETURNED, never
// the newest record in the ring — so a 600-record ring with a 500-record page
// must not skip the middle 100 records on the next read.
const RING = 2000

export function createFrameRing() {
  const buffer = []
  let nextId = 1
  let epoch = Date.now().toString(36)

  return {
    get epoch() {
      return epoch
    },
    bumpEpoch() {
      epoch = Date.now().toString(36) + ':' + nextId
      return epoch
    },
    push(rec) {
      const item = {
        id: nextId++,
        epoch,
        at: Date.now(),
        direction: rec.direction === 'rx' ? 'rx' : 'tx',
        hex: String(rec.hex || ''),
        byteLength: Number(rec.byteLength) || 0,
        cwd: rec.cwd || '',
        connectionId: rec.connectionId || '',
        port: rec.port || '',
        transactionId: rec.transactionId || '',
        source: rec.source || 'system',
      }
      buffer.push(item)
      if (buffer.length > RING) buffer.splice(0, buffer.length - RING)
      return item
    },
    // since: the cursor from the previous read (0 = from the oldest held record).
    // max: page size (hard cap 500). Returns {items, cursor, hasMore, dropped,
    // oldestCursor, latestCursor, epoch, bufferCount}.
    feed(since, max) {
      const cap = Math.min(500, Math.max(1, Math.trunc(Number(max) || 200)))
      const after = Number(since) > 0 ? Number(since) : 0
      const oldest = buffer.length ? buffer[0].id : 0
      const latest = buffer.length ? buffer[buffer.length - 1].id : 0
      // caller cursor older than the oldest record we still hold → those records
      // were dropped by the ring cap
      let dropped = 0
      if (after > 0 && after < oldest && oldest > 1) {
        dropped = oldest - 1 - after
      }
      const items = buffer.filter((item) => item.id > after).slice(0, cap)
      const lastReturned = items.length ? items[items.length - 1].id : after
      return {
        items,
        cursor: lastReturned,
        // cursor points at the LAST RETURNED record, so the next page resumes
        // exactly after it (never beyond unreturned records)
        hasMore: lastReturned < latest,
        dropped,
        oldestCursor: oldest,
        latestCursor: latest,
        epoch,
        bufferCount: buffer.length,
      }
    },
    all() {
      return buffer.slice()
    },
    clear() {
      buffer.length = 0
    },
  }
}
