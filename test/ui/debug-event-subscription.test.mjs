// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { useDebugEvents } from '../../src/ui/debug/runtime/use-debug-events.mjs'
import { createMockReact } from '../helpers/mock-react.mjs'

test('useDebugEvents queries state once then waits; idle wake does not tight-loop', async () => {
  const React = createMockReact()
  /** @type {Array<() => any>} */
  const effects = []
  React.useEffect = (fn) => {
    effects.push(fn)
  }
  let stateCalls = 0
  let waitCalls = 0
  /** @type {(value: any) => void} */
  let settleWait
  const waitGate = new Promise((resolve) => {
    settleWait = resolve
  })
  const mockPost = async (path) => {
    if (String(path).includes('/debug/state')) {
      stateCalls += 1
      return { ok: true, session: { state: 'running', variables: [] } }
    }
    if (String(path).includes('/debug/events/wait')) {
      waitCalls += 1
      if (waitCalls === 1) return waitGate
      return new Promise(() => {})
    }
    return { ok: true }
  }
  useDebugEvents(React, mockPost, { cwd: '/ws', sessionId: 'sess-1' })
  const stop = effects[0]?.()
  await new Promise((r) => setImmediate(r))
  assert.equal(stateCalls, 1, 'bootstraps with a single state query')
  assert.equal(waitCalls, 1, 'then parks on waitEvents')
  settleWait({ ok: true, woke: true, events: [], nextCursor: 0 })
  await new Promise((r) => setTimeout(r, 30))
  assert.ok(waitCalls >= 2, 'idle wake resumes waiting')
  assert.ok(waitCalls <= 4, 'idle wake must not tight-loop')
  if (typeof stop === 'function') stop()
})

test('stage4: missing sessionId does not poll debug events', async () => {
  const React = createMockReact()
  /** @type {Array<() => any>} */
  const effects = []
  React.useEffect = (fn) => {
    effects.push(fn)
  }
  let stateCalls = 0
  let waitCalls = 0
  const mockPost = async (path) => {
    if (String(path).includes('/debug/state')) stateCalls += 1
    if (String(path).includes('/debug/events/wait')) waitCalls += 1
    return { ok: true }
  }
  useDebugEvents(React, mockPost, { cwd: '/ws', sessionId: '' })
  const stop = effects[0]?.()
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(stateCalls, 0)
  assert.equal(waitCalls, 0)
  if (typeof stop === 'function') stop()
})

test('idle with identity hangs on one waitForOwnerSession (no 1Hz poll)', async () => {
  const React = createMockReact()
  /** @type {Array<() => any>} */
  const effects = []
  React.useEffect = (fn) => {
    effects.push(fn)
  }
  let stateCalls = 0
  let waitCalls = 0
  const mockPost = async (path) => {
    if (String(path).includes('/debug/state')) {
      stateCalls += 1
      return { ok: true, session: null, pendingApprovals: [] }
    }
    if (String(path).includes('/debug/events/wait')) {
      waitCalls += 1
      return new Promise(() => {})
    }
    return { ok: true }
  }
  useDebugEvents(React, mockPost, { cwd: '/ws', sessionId: 'sess-idle' })
  const stop = effects[0]?.()
  await new Promise((r) => setTimeout(r, 50))
  assert.equal(stateCalls, 1)
  assert.equal(waitCalls, 1, 'exactly one hung wait while discovering Agent sessions')
  if (typeof stop === 'function') stop()
})

test('wait timeout re-hangs without short-period loop', async () => {
  const React = createMockReact()
  /** @type {Array<() => any>} */
  const effects = []
  React.useEffect = (fn) => {
    effects.push(fn)
  }
  let waitCalls = 0
  /** @type {(value: any) => void} */
  let settleFirst
  const firstWait = new Promise((resolve) => {
    settleFirst = resolve
  })
  const mockPost = async (path) => {
    if (String(path).includes('/debug/state')) {
      return { ok: true, session: null, pendingApprovals: [] }
    }
    if (String(path).includes('/debug/events/wait')) {
      waitCalls += 1
      if (waitCalls === 1) return firstWait
      return new Promise(() => {})
    }
    return { ok: true }
  }
  useDebugEvents(React, mockPost, { cwd: '/ws', sessionId: 'sess-timeout' })
  const stop = effects[0]?.()
  await new Promise((r) => setImmediate(r))
  assert.equal(waitCalls, 1, 'single hung wait before timeout')
  settleFirst({ ok: true, woke: false, closed: false, events: [], nextCursor: 0 })
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(waitCalls, 2, 'timeout re-enters exactly one new hang')
  if (typeof stop === 'function') stop()
})

test('woke discovers Agent-created debug session then continues waiting', async () => {
  const React = createMockReact()
  /** @type {Array<() => any>} */
  const effects = []
  React.useEffect = (fn) => {
    effects.push(fn)
  }
  let stateCalls = 0
  let waitCalls = 0
  let sawSession = false
  const mockPost = async (path) => {
    if (String(path).includes('/debug/state')) {
      stateCalls += 1
      if (waitCalls >= 1) {
        sawSession = true
        return { ok: true, session: { state: 'running', variables: [] }, pendingApprovals: [] }
      }
      return { ok: true, session: null, pendingApprovals: [] }
    }
    if (String(path).includes('/debug/events/wait')) {
      waitCalls += 1
      if (waitCalls === 1) return { ok: true, woke: true, events: [], nextCursor: 0 }
      return new Promise(() => {})
    }
    return { ok: true }
  }
  useDebugEvents(React, mockPost, { cwd: '/ws', sessionId: 'sess-woke' })
  const stop = effects[0]?.()
  await new Promise((r) => setTimeout(r, 40))
  assert.ok(sawSession, 'getState after woke must observe the new session')
  assert.ok(waitCalls >= 2, 'continues event wait after discovery')
  assert.ok(stateCalls >= 2)
  if (typeof stop === 'function') stop()
})

test('closed returns to discovery so a later Agent start is found', async () => {
  const React = createMockReact()
  /** @type {Array<() => any>} */
  const effects = []
  React.useEffect = (fn) => {
    effects.push(fn)
  }
  let waitCalls = 0
  const mockPost = async (path) => {
    if (String(path).includes('/debug/state')) {
      return { ok: true, session: { state: 'running', variables: [] } }
    }
    if (String(path).includes('/debug/events/wait')) {
      waitCalls += 1
      if (waitCalls === 1) return { ok: true, closed: true, events: [], nextCursor: 0 }
      return new Promise(() => {})
    }
    return { ok: true }
  }
  useDebugEvents(React, mockPost, { cwd: '/ws', sessionId: 'sess-closed' })
  const stop = effects[0]?.()
  await new Promise((r) => setTimeout(r, 40))
  assert.ok(waitCalls >= 2, 'closed must re-enter waitForOwnerSession discovery')
  if (typeof stop === 'function') stop()
})

test('identity change aborts the in-flight wait', async () => {
  const React = createMockReact()
  /** @type {Array<() => any>} */
  const effects = []
  React.useEffect = (fn) => {
    effects.push(fn)
  }
  let aborted = false
  const mockPost = async (path, _body, timeoutOrOpts) => {
    if (String(path).includes('/debug/state')) {
      return { ok: true, session: null, pendingApprovals: [] }
    }
    if (String(path).includes('/debug/events/wait')) {
      const signal = timeoutOrOpts && typeof timeoutOrOpts === 'object' ? timeoutOrOpts.signal : undefined
      return new Promise((_resolve, reject) => {
        if (signal?.aborted) {
          aborted = true
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          return
        }
        signal?.addEventListener?.(
          'abort',
          () => {
            aborted = true
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          },
          { once: true },
        )
      })
    }
    return { ok: true }
  }
  useDebugEvents(React, mockPost, { cwd: '/ws', sessionId: 'sess-a' })
  const stop = effects[0]?.()
  await new Promise((r) => setImmediate(r))
  if (typeof stop === 'function') stop()
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(aborted, true)
})

test('stage4: consecutive wait failures stop subscription (no reload storm)', async () => {
  const React = createMockReact()
  /** @type {Array<() => any>} */
  const effects = []
  React.useEffect = (fn) => {
    effects.push(fn)
  }
  let waitCalls = 0
  const mockPost = async (path) => {
    if (String(path).includes('/debug/state')) {
      return { ok: true, session: { state: 'running', variables: [] } }
    }
    if (String(path).includes('/debug/events/wait')) {
      waitCalls += 1
      return { ok: false, error: 'boom' }
    }
    return { ok: true }
  }
  const { DEBUG_WAIT_FAILURE_BUDGET } = await import(
    '../../src/ui/debug/runtime/use-debug-event-subscription.mjs'
  )
  useDebugEvents(React, mockPost, { cwd: '/ws', sessionId: 'sess-fail' })
  const stop = effects[0]?.()
  const realSetTimeout = globalThis.setTimeout
  /** @type {Array<() => void>} */
  const due = []
  globalThis.setTimeout = /** @type {any} */ (
    (fn, _ms) => {
      due.push(fn)
      return 0
    }
  )
  try {
    await new Promise((r) => setImmediate(r))
    for (let i = 0; i < DEBUG_WAIT_FAILURE_BUDGET + 3; i++) {
      while (due.length) due.shift()?.()
      await new Promise((r) => setImmediate(r))
    }
    assert.equal(waitCalls, DEBUG_WAIT_FAILURE_BUDGET, 'stops after failure budget')
  } finally {
    globalThis.setTimeout = realSetTimeout
    if (typeof stop === 'function') stop()
  }
})

test('single transient wait failure recovers after backoff', async () => {
  const React = createMockReact()
  /** @type {Array<() => any>} */
  const effects = []
  React.useEffect = (fn) => {
    effects.push(fn)
  }
  let waitCalls = 0
  const mockPost = async (path) => {
    if (String(path).includes('/debug/state')) {
      return { ok: true, session: { state: 'running', variables: [] } }
    }
    if (String(path).includes('/debug/events/wait')) {
      waitCalls += 1
      if (waitCalls === 1) return { ok: false, error: 'transient' }
      return new Promise(() => {})
    }
    return { ok: true }
  }
  useDebugEvents(React, mockPost, { cwd: '/ws', sessionId: 'sess-recover' })
  const stop = effects[0]?.()
  const realSetTimeout = globalThis.setTimeout
  /** @type {Array<() => void>} */
  const due = []
  globalThis.setTimeout = /** @type {any} */ (
    (fn, _ms) => {
      due.push(fn)
      return 0
    }
  )
  try {
    await new Promise((r) => setImmediate(r))
    while (due.length) due.shift()?.()
    await new Promise((r) => setImmediate(r))
    assert.ok(waitCalls >= 2, 'recovers and re-enters wait after one failure')
  } finally {
    globalThis.setTimeout = realSetTimeout
    if (typeof stop === 'function') stop()
  }
})

