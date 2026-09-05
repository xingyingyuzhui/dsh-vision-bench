// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { createDebugEventService } from '../../src/application/debug/debug-event-service.mjs'
import { createDebugEventRing } from '../../src/domain/debug/debug-event.mjs'

test('debug event ring: getEventsAfter respects strictly greater cursor and tracks expiration', () => {
  const ring = createDebugEventRing(10) // small capacity for test

  // Push 5 events (cursors 1..5)
  for (let i = 1; i <= 5; i++) {
    ring.push({
      debugSessionId: 'sess_1',
      ownerSessionId: 'owner_1',
      workspaceCwd: '/work',
      backend: 'gdb-openocd',
      type: 'test.event',
      payload: { index: i },
    })
  }

  // Query afterCursor = 3 -> should get 4 and 5
  const res = ring.getEventsAfter(3)
  assert.equal(res.events.length, 2)
  assert.equal(res.events[0].cursor, 4)
  assert.equal(res.events[1].cursor, 5)
  assert.equal(res.nextCursor, 5)
  assert.equal(res.cursorExpired, false)

  // Push 10 more events to evict initial events (total 15 pushed, capacity 10)
  for (let i = 6; i <= 15; i++) {
    ring.push({
      debugSessionId: 'sess_1',
      ownerSessionId: 'owner_1',
      workspaceCwd: '/work',
      backend: 'gdb-openocd',
      type: 'test.event',
      payload: { index: i },
    })
  }

  // Ring now contains events 6..15. Oldest cursor is 6.
  // Querying afterCursor = 2 is expired!
  const expiredRes = ring.getEventsAfter(2)
  assert.equal(expiredRes.cursorExpired, true)
})

test('debug event ring: waitForEventsAfter completes immediately if events exist or expires', async () => {
  const ring = createDebugEventRing(10)
  for (let i = 1; i <= 3; i++) {
    ring.push({
      debugSessionId: 's1',
      ownerSessionId: 'o1',
      workspaceCwd: '/work',
      backend: 'gdb-openocd',
      type: 'e',
      payload: { i },
    })
  }

  const res = await ring.waitForEventsAfter(1, { timeoutMs: 100 })
  assert.equal(res.events.length, 2)
  assert.equal(res.events[0].cursor, 2)
  assert.equal(res.events[1].cursor, 3)
})

test('debug event ring: waitForEventsAfter awaits new event then resolves', async () => {
  const ring = createDebugEventRing(10)
  ring.push({
    debugSessionId: 's1',
    ownerSessionId: 'o1',
    workspaceCwd: '/work',
    backend: 'gdb-openocd',
    type: 'init',
  })

  const waitPromise = ring.waitForEventsAfter(1, { timeoutMs: 1000 })
  setTimeout(() => {
    ring.push({
      debugSessionId: 's1',
      ownerSessionId: 'o1',
      workspaceCwd: '/work',
      backend: 'gdb-openocd',
      type: 'new_event',
      payload: { arrived: true },
    })
  }, 30)

  const res = await waitPromise
  assert.equal(res.events.length, 1)
  assert.equal(res.events[0].cursor, 2)
  assert.equal(res.events[0].payload.arrived, true)
})

test('debug event service: listAfter and waitAfter surface cursorExpired flag', async () => {
  const service = createDebugEventService({
    capacity: 5,
    debugSessionId: 'ds_test',
    ownerSessionId: 'owner_1',
    workspaceCwd: '/work',
  })

  for (let i = 1; i <= 8; i++) {
    service.append({
      debugSessionId: 'ds_test',
      ownerSessionId: 'owner_1',
      workspaceCwd: '/work',
      backend: 'gdb-openocd',
      type: 'evt',
      payload: { i },
    })
  }

  // Ring has 4..8 (oldest is 4)
  const listRes = service.listAfter(1) // afterCursor 1 is expired because oldest is 4
  assert.equal(listRes.cursorExpired, true)

  const waitRes = await service.waitAfter(1, {
    timeoutMs: 100,
  })
  assert.equal(waitRes.cursorExpired, true)
})
