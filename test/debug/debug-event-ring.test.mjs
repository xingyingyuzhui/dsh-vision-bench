import assert from 'node:assert/strict'
import test from 'node:test'
import { DEBUG_EVENT_TYPES, createDebugEvent, createDebugEventRing } from '../../src/domain/debug/debug-event.mjs'

test('createDebugEvent creates normalized event with monotonic cursor and id', () => {
  const ev = createDebugEvent({
    cursor: 5,
    debugSessionId: 'ds-1',
    workspaceCwd: '/ws',
    ownerSessionId: 'owner-1',
    type: DEBUG_EVENT_TYPES.RUNNING,
    backend: 'fake',
    payload: { pc: '0x08000100' },
  })

  assert.equal(ev.cursor, 5)
  assert.equal(ev.debugSessionId, 'ds-1')
  assert.equal(ev.type, DEBUG_EVENT_TYPES.RUNNING)
  assert.equal(ev.payload.pc, '0x08000100')
  assert.ok(ev.id.startsWith('ev_'))
  assert.ok(typeof ev.timestamp === 'number')
})

test('createDebugEventRing stores events, advances cursor and evicts over capacity', () => {
  const ring = createDebugEventRing(3)
  ring.push({
    debugSessionId: 'ds-1',
    workspaceCwd: '/ws',
    ownerSessionId: 'owner-1',
    backend: 'fake',
    type: DEBUG_EVENT_TYPES.SESSION_STARTING,
  })
  ring.push({
    debugSessionId: 'ds-1',
    workspaceCwd: '/ws',
    ownerSessionId: 'owner-1',
    backend: 'fake',
    type: DEBUG_EVENT_TYPES.SESSION_READY,
  })
  ring.push({
    debugSessionId: 'ds-1',
    workspaceCwd: '/ws',
    ownerSessionId: 'owner-1',
    backend: 'fake',
    type: DEBUG_EVENT_TYPES.RUNNING,
  })

  let events = ring.getEventsSince(1).events
  assert.equal(events.length, 3)
  assert.equal(events[0].cursor, 1)
  assert.equal(events[2].cursor, 3)

  // Push 4th event -> capacity is 3, event cursor 1 is evicted
  ring.push({
    debugSessionId: 'ds-1',
    workspaceCwd: '/ws',
    ownerSessionId: 'owner-1',
    backend: 'fake',
    type: DEBUG_EVENT_TYPES.PAUSED,
  })

  events = ring.getEventsSince(1).events
  assert.equal(events.length, 3)
  assert.equal(events[0].cursor, 2)
  assert.equal(events[2].cursor, 4)
})

test('createDebugEventRing waitForEvents long polls and honors abort signal', async () => {
  const ring = createDebugEventRing(10)

  // Immediate return if cursor already present
  ring.push({
    debugSessionId: 'ds-1',
    workspaceCwd: '/ws',
    ownerSessionId: 'owner-1',
    backend: 'fake',
    type: DEBUG_EVENT_TYPES.RUNNING,
  })
  const immediate = await ring.waitForEvents(1)
  assert.equal(immediate.events.length, 1)
  assert.equal(immediate.events[0].cursor, 1)

  // Async arrival waking up waiter
  const promise = ring.waitForEvents(2)
  setTimeout(() => {
    ring.push({
      debugSessionId: 'ds-1',
      workspaceCwd: '/ws',
      ownerSessionId: 'owner-1',
      backend: 'fake',
      type: DEBUG_EVENT_TYPES.PAUSED,
    })
  }, 20)

  const awaited = await promise
  assert.equal(awaited.events.length, 1)
  assert.equal(awaited.events[0].cursor, 2)

  // AbortSignal early return
  const ac = new AbortController()
  const abortPromise = ring.waitForEvents(5, { signal: ac.signal })
  ac.abort()
  const abortedRes = await abortPromise
  assert.deepEqual(abortedRes.events, [])
})
