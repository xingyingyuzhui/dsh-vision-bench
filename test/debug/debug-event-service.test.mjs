import assert from 'node:assert/strict'
import test from 'node:test'
import { createDebugEventService } from '../../src/application/debug/debug-event-service.mjs'

test('DebugEventService appends and lists events with monotonic cursors', () => {
  const svc = createDebugEventService({
    capacity: 10,
    debugSessionId: 'ds_1',
    ownerSessionId: 'owner_1',
    workspaceCwd: '/workspace',
  })

  const ev1 = svc.append({
    debugSessionId: 'ds_1',
    ownerSessionId: 'owner_1',
    workspaceCwd: '/workspace',
    backend: 'gdb-openocd',
    type: 'debug.test.1',
    payload: { a: 1 },
  })

  const ev2 = svc.append({
    debugSessionId: 'ds_1',
    ownerSessionId: 'owner_1',
    workspaceCwd: '/workspace',
    backend: 'gdb-openocd',
    type: 'debug.test.2',
    payload: { a: 2 },
  })

  assert.equal(ev1.cursor, 1)
  assert.equal(ev2.cursor, 2)

  const listed = svc.listAfter(0)
  assert.equal(listed.events.length, 2)
  assert.equal(listed.closed, false)

  const after1 = svc.listAfter(1)
  assert.equal(after1.events.length, 1)
  assert.equal(after1.events[0].cursor, 2)
})

test('DebugEventService waitAfter returns immediately if events exist', async () => {
  const svc = createDebugEventService({
    capacity: 10,
    debugSessionId: 'ds_1',
    ownerSessionId: 'owner_1',
    workspaceCwd: '/workspace',
  })

  svc.append({
    debugSessionId: 'ds_1',
    ownerSessionId: 'owner_1',
    workspaceCwd: '/workspace',
    backend: 'gdb-openocd',
    type: 'debug.test.1',
  })

  const res = await svc.waitAfter(0)
  assert.equal(res.events.length, 1)
  assert.equal(res.closed, false)
})

test('DebugEventService waitAfter suspends and wakes on new event', async () => {
  const svc = createDebugEventService({
    capacity: 10,
    debugSessionId: 'ds_1',
    ownerSessionId: 'owner_1',
    workspaceCwd: '/workspace',
  })

  const waitPromise = svc.waitAfter(0, { timeoutMs: 2000 })

  // Append shortly after
  setTimeout(() => {
    svc.append({
      debugSessionId: 'ds_1',
      ownerSessionId: 'owner_1',
      workspaceCwd: '/workspace',
      backend: 'gdb-openocd',
      type: 'debug.arrived',
    })
  }, 30)

  const res = await waitPromise
  assert.equal(res.events.length, 1)
  assert.equal(res.events[0].type, 'debug.arrived')
  assert.equal(res.closed, false)
})

test('DebugEventService waitAfter respects AbortSignal', async () => {
  const svc = createDebugEventService({
    capacity: 10,
    debugSessionId: 'ds_1',
    ownerSessionId: 'owner_1',
    workspaceCwd: '/workspace',
  })

  const ac = new AbortController()
  const waitPromise = svc.waitAfter(0, { signal: ac.signal, timeoutMs: 5000 })
  ac.abort()

  const res = await waitPromise
  assert.equal(res.events.length, 0)
  assert.equal(res.closed, false)
})

test('DebugEventService close() wakes up waiters with closed: true', async () => {
  const svc = createDebugEventService({
    capacity: 10,
    debugSessionId: 'ds_1',
    ownerSessionId: 'owner_1',
    workspaceCwd: '/workspace',
  })

  const waitPromise = svc.waitAfter(0, { timeoutMs: 5000 })
  svc.close()

  const res = await waitPromise
  assert.equal(res.events.length, 0)
  assert.equal(res.closed, true)

  // Subsequent append throws
  assert.throws(() => {
    svc.append({
      debugSessionId: 'ds_1',
      ownerSessionId: 'owner_1',
      workspaceCwd: '/workspace',
      backend: 'gdb-openocd',
      type: 'debug.late',
    })
  }, /已关闭/)
})
