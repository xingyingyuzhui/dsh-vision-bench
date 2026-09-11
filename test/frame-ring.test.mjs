// Task1.1/0.19.2 regression: frame ring cursors must never skip unreturned
// records, must report hasMore and dropped-when-overwritten.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createFrameRing } from '../runtime/io/frame-ring.mjs'

const push = (ring, n) => {
  for (let i = 0; i < n; i++) ring.push({ direction: 'tx', hex: '00', byteLength: 1 })
}

test('page of 500 out of 600: next read returns the remaining 100 (no silent skip)', async () => {
  const ring = createFrameRing()
  push(ring, 600)
  const page1 = ring.feed(0, 500)
  assert.equal(page1.items.length, 500)
  assert.equal(page1.cursor, 500, 'cursor = last RETURNED record')
  assert.equal(page1.hasMore, true, 'more records remain')
  assert.equal(page1.dropped, 0)
  const page2 = ring.feed(page1.cursor, 500)
  assert.equal(page2.items.length, 100, 'exactly the remaining 100 records')
  assert.equal(page2.hasMore, false)
  assert.deepEqual(
    page2.items.map((i) => i.id),
    Array.from({ length: 100 }, (_, i) => 501 + i),
  )
})

test('1500 continuous records are never lost across pages', async () => {
  const ring = createFrameRing()
  push(ring, 1500)
  let cursor = 0
  const seen = []
  for (let pages = 0; pages < 10; pages++) {
    const page = ring.feed(cursor, 500)
    seen.push(...page.items.map((i) => i.id))
    cursor = page.cursor
    if (!page.hasMore) break
  }
  assert.equal(seen.length, 1500, 'all 1500 records read')
  assert.ok(
    seen.every((id, idx) => idx === 0 || id === seen[idx - 1] + 1),
    'no duplicates, no gaps',
  )
})

test('same-timestamp records survive pagination (id order is categorical)', async () => {
  const ring = createFrameRing()
  push(ring, 1200)
  const p1 = ring.feed(0, 500)
  const p2 = ring.feed(p1.cursor, 500)
  const p3 = ring.feed(p2.cursor, 500)
  assert.equal(p1.items.length + p2.items.length + p3.items.length, 1200)
  const all = [...p1.items, ...p2.items, ...p3.items].map((i) => i.id)
  assert.equal(new Set(all).size, 1200, 'no duplicate record ids')
})

test('ring overwrite reports dropped instead of silent skip', async () => {
  const ring = createFrameRing()
  // 2100 pushed → ring holds ids 101..2100
  push(ring, 2100)
  const p1 = ring.feed(0, 500)
  assert.equal(p1.items[0].id, 101, 'ring oldest held record is id 101')
  assert.equal(p1.dropped, 0, 'nothing dropped below the held window at cursor 0')
  // caller advances slowly; many more records arrive → ring evicts ids the
  // caller never read
  push(ring, 2000) // total 4100 → ring holds ids 2101..4100 (oldest=2101)
  const late = ring.feed(p1.cursor, 500) // p1.cursor = 600
  assert.ok(late.dropped >= 1500, 'records the caller never read were overwritten, dropped=' + late.dropped)
  assert.ok(late.items[0].id >= 2101, 'remaining page starts after the evicted window')
  assert.ok(late.items.length === 500)
})

test('push keeps global seq so all-ports feed can page across connections', () => {
  const ring = createFrameRing()
  const a = ring.push({ direction: 'tx', hex: 'AA', byteLength: 1, seq: 11 })
  const b = ring.push({ direction: 'rx', hex: 'BB', byteLength: 1, seq: 12 })
  assert.equal(a.seq, 11)
  assert.equal(b.seq, 12)
  assert.equal(a.id, 1)
  assert.equal(b.id, 2)
  const noSeq = ring.push({ direction: 'tx', hex: 'CC', byteLength: 1 })
  assert.equal(noSeq.seq, undefined)
})

test('cursor never exceeds the last returned record (empty page keeps cursor)', async () => {
  const ring = createFrameRing()
  push(ring, 10)
  const p1 = ring.feed(0, 500)
  assert.equal(p1.cursor, 10)
  const p2 = ring.feed(p1.cursor, 500)
  assert.equal(p2.items.length, 0)
  assert.equal(p2.hasMore, false)
  assert.equal(p2.cursor, 10, 'cursor stays put on an empty page')
})
