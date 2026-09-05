import assert from 'node:assert/strict'
// @ts-check
import test from 'node:test'
import { createDebugEventRing } from '../../src/domain/debug/debug-event.mjs'

test('PR-1: DebugEventRing afterCursor semantics strictly filters cursor > afterCursor', async () => {
  const ring = createDebugEventRing(100)

  // Push 3 events
  ring.push({
    debugSessionId: 'ds_1',
    ownerSessionId: 'owner_1',
    workspaceCwd: '/ws',
    type: 'test.event.1',
  })
  ring.push({
    debugSessionId: 'ds_1',
    ownerSessionId: 'owner_1',
    workspaceCwd: '/ws',
    type: 'test.event.2',
  })
  ring.push({
    debugSessionId: 'ds_1',
    ownerSessionId: 'owner_1',
    workspaceCwd: '/ws',
    type: 'test.event.3',
  })

  // 1. Initial read with afterCursor = 0
  const first = ring.getEventsAfter(0)
  assert.equal(first.events.length, 3)
  assert.equal(first.events[0].cursor, 1)
  assert.equal(first.events[1].cursor, 2)
  assert.equal(first.events[2].cursor, 3)
  assert.equal(first.nextCursor, 3)

  // 2. Subsequent read with afterCursor = 3 must return empty list and must NOT return cursor 3
  const second = ring.getEventsAfter(3)
  assert.equal(second.events.length, 0)
  assert.equal(second.nextCursor, 3)

  // 3. Push events 4 and 5
  ring.push({
    debugSessionId: 'ds_1',
    ownerSessionId: 'owner_1',
    workspaceCwd: '/ws',
    type: 'test.event.4',
  })
  ring.push({
    debugSessionId: 'ds_1',
    ownerSessionId: 'owner_1',
    workspaceCwd: '/ws',
    type: 'test.event.5',
  })

  const third = ring.getEventsAfter(3)
  assert.equal(third.events.length, 2)
  assert.equal(third.events[0].cursor, 4)
  assert.equal(third.events[1].cursor, 5)
  assert.equal(third.nextCursor, 5)

  // 4. waitForEventsAfter with afterCursor = 5 asynchronously resolves when event 6 is pushed
  const waitPromise = ring.waitForEventsAfter(5, { timeoutMs: 5000 })
  setTimeout(() => {
    ring.push({
      debugSessionId: 'ds_1',
      ownerSessionId: 'owner_1',
      workspaceCwd: '/ws',
      type: 'test.event.6',
    })
  }, 20)

  const fourth = await waitPromise
  assert.equal(fourth.events.length, 1)
  assert.equal(fourth.events[0].cursor, 6)
  assert.equal(fourth.nextCursor, 6)
})
