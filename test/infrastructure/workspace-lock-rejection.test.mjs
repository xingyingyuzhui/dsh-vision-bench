// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { runExclusive } from '../../src/infrastructure/persistence/workspace-lock.mjs'

test('F12: runExclusive rejecting does not produce unhandledRejection event', async () => {
  /** @type {any[]} */
  const unhandled = []
  const onUnhandled = (err) => {
    unhandled.push(err)
  }
  process.on('unhandledRejection', onUnhandled)

  try {
    const key = `test_key_${Date.now()}`

    // Call runExclusive with a failing mutator
    let caughtErr = null
    try {
      await runExclusive(key, async () => {
        throw new Error('controlled-mutator-failure')
      })
    } catch (err) {
      caughtErr = err
    }

    assert.ok(caughtErr)
    assert.equal(caughtErr.message, 'controlled-mutator-failure')

    // Small delay to ensure any potential unhandledRejection event would have fired
    await new Promise((r) => setTimeout(r, 50))

    // Verify unhandled rejections list is strictly empty
    assert.equal(unhandled.length, 0)

    // Verify subsequent operation on same key succeeds
    const nextRes = await runExclusive(key, async () => 'success')
    assert.equal(nextRes, 'success')
  } finally {
    process.removeListener('unhandledRejection', onUnhandled)
  }
})
