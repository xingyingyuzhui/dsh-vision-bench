import assert from 'node:assert/strict'
import test from 'node:test'
import { POLL_MS, subscribeState } from '../../src/ui/common/state-subscription.mjs'

test('stage4: last state unsubscribe clears timer and stops pulls', async () => {
  let posts = 0
  const post = async () => {
    posts += 1
    return { ok: true, t: posts }
  }
  const realSetTimeout = globalThis.setTimeout
  /** @type {Array<{ fn: () => void, ms: number }>} */
  const scheduled = []
  globalThis.setTimeout = /** @type {any} */ (
    (fn, ms) => {
      scheduled.push({ fn, ms: Number(ms) || 0 })
      return scheduled.length
    }
  )
  globalThis.clearTimeout = () => {}
  try {
    const stopA = subscribeState(post, '/ws-a', () => {}, { sessionId: 's1' })
    await new Promise((r) => setImmediate(r))
    assert.equal(posts, 1, 'first subscriber triggers one pull')
    const stopB = subscribeState(post, '/ws-a', () => {}, { sessionId: 's1' })
    assert.equal(posts, 1, 'second subscriber shares bus; no extra pull until schedule')
    stopA()
    stopB()
    const afterUnsub = posts
    for (const row of scheduled.splice(0)) {
      if (row.ms === POLL_MS) row.fn()
    }
    await new Promise((r) => setImmediate(r))
    assert.equal(posts, afterUnsub, 'no further pulls after last unsubscribe')
  } finally {
    globalThis.setTimeout = realSetTimeout
  }
})
