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
