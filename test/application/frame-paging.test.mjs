import assert from 'node:assert/strict'
import test from 'node:test'

/** Pure helper mirroring frame-service page slice (tested in isolation). */
function pageFrames(enriched, limit, offset) {
  const length = enriched.length
  if (offset >= length) return []
  const end = Math.max(0, length - offset)
  const start = Math.max(0, end - limit)
  return enriched.slice(start, end)
}

test('Agent frame paging: offset beyond total returns empty', () => {
  const enriched = Array.from({ length: 10 }, (_, i) => ({ id: `f${i}` }))
  assert.deepEqual(pageFrames(enriched, 50, 11), [])
  assert.deepEqual(pageFrames(enriched, 50, 10), [])
})

test('Agent frame paging: newest-first window with offset', () => {
  const enriched = Array.from({ length: 10 }, (_, i) => ({ id: `f${i}` }))
  const page0 = pageFrames(enriched, 3, 0)
  assert.deepEqual(
    page0.map((f) => f.id),
    ['f7', 'f8', 'f9'],
  )
  const page1 = pageFrames(enriched, 3, 3)
  assert.deepEqual(
    page1.map((f) => f.id),
    ['f4', 'f5', 'f6'],
  )
})
