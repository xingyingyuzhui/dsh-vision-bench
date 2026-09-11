// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { subscribeState } from '../../src/ui/common/state-subscription.mjs'

test('state-subscription: slow response does not cause parallel in-flight pulls or starvation', async (t) => {
  let inFlightCount = 0
  let maxConcurrent = 0
  let completedCount = 0

  const slowPost = async (path, body) => {
    inFlightCount++
    if (inFlightCount > maxConcurrent) maxConcurrent = inFlightCount
    // simulate slow response
    await new Promise((r) => setTimeout(r, 60))
    inFlightCount--
    completedCount++
    return { cwd: body.cwd, count: completedCount }
  }

  const updates = []
  const unsubscribe = subscribeState(slowPost, '/work/slow-board', (data) => {
    updates.push(data)
  })

  t.after(() => {
    unsubscribe()
  })

  // Wait for initial pull to finish
  await new Promise((r) => setTimeout(r, 100))

  assert.equal(maxConcurrent, 1, 'Never trigger concurrent pulls')
  assert.equal(updates.length, 1, 'First pull delivered successfully despite slow network')
  assert.equal(updates[0].count, 1)
})

test('subscribeState pauses while document.hidden and pulls on visible', async () => {
  let hidden = false
  const listeners = new Set()
  const prev = globalThis.document
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      get hidden() {
        return hidden
      },
      addEventListener(_type, fn) {
        listeners.add(fn)
      },
      removeEventListener(_type, fn) {
        listeners.delete(fn)
      },
    },
  })
  let n = 0
  const post = async () => ({ n: ++n })
  const seen = []
  hidden = true
  const un = subscribeState(post, '/work/hidden-pause', (data) => seen.push(data?.n))
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(seen.length, 1, 'first snapshot still loads')
  await new Promise((r) => setTimeout(r, 40))
  assert.equal(seen.length, 1, 'no follow-up /state while hidden')
  hidden = false
  for (const fn of listeners) fn()
  await new Promise((r) => setTimeout(r, 40))
  assert.ok(seen.length > 1, 'foreground pull resumes')
  un()
  if (prev === undefined) delete globalThis.document
  else globalThis.document = prev
})


