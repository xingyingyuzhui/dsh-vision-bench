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
