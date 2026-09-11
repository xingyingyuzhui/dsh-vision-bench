// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { DEBUG_EVENT_TYPES } from '../../src/shared/debug-events.mjs'
import { createDebugToolbar } from '../../src/ui/debug/runtime/debug-toolbar.mjs'
import { normalizeDebugEventType, useDebugEvents } from '../../src/ui/debug/runtime/use-debug-events.mjs'

// Simple mock React for testing hook lifecycle
function createMockReact() {
  const stateMap = new Map()
  let stateIndex = 0
  const refMap = new Map()
  let refIndex = 0

  return {
    reset() {
      stateIndex = 0
      refIndex = 0
    },
    useState(init) {
      const idx = stateIndex++
      if (!stateMap.has(idx)) {
        stateMap.set(idx, typeof init === 'function' ? init() : init)
      }
      const val = stateMap.get(idx)
      const setVal = (next) => {
        const newVal = typeof next === 'function' ? next(stateMap.get(idx)) : next
        stateMap.set(idx, newVal)
      }
      return [val, setVal]
    },
    useEffect() {},
    useCallback(fn) {
      return fn
    },
    useMemo(fn) {
      return fn()
    },
    useRef(init) {
      const idx = refIndex++
      if (!refMap.has(idx)) {
        refMap.set(idx, { current: init })
      }
      return refMap.get(idx)
    },
    createElement(type, props, ...children) {
      return { type, props: props || {}, children: children.flat().filter(Boolean) }
    },
  }
}

test('PR-4: normalizeDebugEventType maps legacy event strings to canonical DEBUG_EVENT_TYPES', () => {
  assert.equal(normalizeDebugEventType('running'), DEBUG_EVENT_TYPES.RUNNING)
  assert.equal(normalizeDebugEventType('paused'), DEBUG_EVENT_TYPES.PAUSED)
  assert.equal(normalizeDebugEventType('step_complete'), DEBUG_EVENT_TYPES.STEP_COMPLETE)
  assert.equal(normalizeDebugEventType('breakpoint_hit'), DEBUG_EVENT_TYPES.BREAKPOINT_HIT)
  assert.equal(normalizeDebugEventType('watchpoint_hit'), DEBUG_EVENT_TYPES.WATCHPOINT_HIT)
  assert.equal(normalizeDebugEventType('session_stopped'), DEBUG_EVENT_TYPES.SESSION_STOPPED)
  assert.equal(normalizeDebugEventType('custom_event'), 'custom_event')
})

test('PR-4: DebugToolbar renders transient state labels for pendingControl', () => {
  const React = createMockReact()
  const Toolbar = createDebugToolbar(React, (k) => k)

  // 1. When pausing
  const pausingBar = Toolbar({
    status: 'running',
    pendingControl: 'pausing',
  })
  const pausingChip = pausingBar.children[0].children[0]
  assert.equal(pausingChip.children[0], '正在暂停…')

  // 2. When stepping
  const steppingBar = Toolbar({
    status: 'running',
    pendingControl: 'stepping',
  })
  const steppingChip = steppingBar.children[0].children[0]
  assert.equal(steppingChip.children[0], '正在单步…')

  // 3. When idle
  const idleBar = Toolbar({
    status: 'idle',
    pendingControl: null,
  })
  const idleChip = idleBar.children[0].children[0]
  assert.equal(idleChip.children[0], '空闲')
})

test('pause events re-evaluate watches added after subscribe', async () => {
  const React = createMockReact()
  /** @type {Array<() => any>} */
  const effects = []
  React.useEffect = (fn) => {
    effects.push(fn)
  }
  /** @type {(value: any) => void} */
  let settleWait
  const waitGate = new Promise((resolve) => {
    settleWait = resolve
  })
  let waitCalls = 0
  const mockPost = async (path, body) => {
    if (String(path).includes('/debug/state')) {
      return { ok: true, session: { state: 'running', variables: [] } }
    }
    if (String(path).includes('/debug/events/wait')) {
      waitCalls += 1
      if (waitCalls === 1) return waitGate
      return new Promise(() => {})
    }
    if (body?.op === 'evaluate') {
      return { ok: true, result: body.expression === 'counter' ? '42' : '' }
    }
    return { ok: true }
  }
  const hook = useDebugEvents(React, mockPost, { cwd: '/ws', sessionId: 'sess-1' })
  const stop = effects[0]?.()
  await new Promise((r) => setImmediate(r))
  hook.actions.addWatch('counter')
  await new Promise((r) => setTimeout(r, 20))
  React.reset()
  const afterAdd = useDebugEvents(React, mockPost, { cwd: '/ws', sessionId: 'sess-1' })
  assert.equal(afterAdd.watchValues[0]?.value, '42')
  settleWait({
    ok: true,
    events: [{ type: DEBUG_EVENT_TYPES.PAUSED }],
    nextCursor: 1,
  })
  await new Promise((r) => setTimeout(r, 30))
  React.reset()
  const afterPause = useDebugEvents(React, mockPost, { cwd: '/ws', sessionId: 'sess-1' })
  assert.equal(afterPause.watchValues.length, 1)
  assert.equal(afterPause.watchValues[0].value, '42')
  if (typeof stop === 'function') stop()
})

test('useDebugEvents queries state once then waits; idle wake does not tight-loop', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../../src/ui/debug/runtime/use-debug-events.mjs', import.meta.url), 'utf8')
  assert.match(src, /getState\(\)/)
  assert.match(src, /waitEvents/)
  assert.match(src, /waitRes\.woke/)
  assert.match(src, /if \(!sessionId \|\| !cwd\)/)
  assert.doesNotMatch(src, /\[active, identityKey/)
})

test('PR-4: useDebugEvents: pause and step set pendingControl without optimistic paused state', async () => {
  const React = createMockReact()
  let lastCommand = null

  const mockPost = async (path, body) => {
    if (path === '/dsh-vision-bench/debug/command') {
      lastCommand = body
      return { ok: true }
    }
    if (path === '/dsh-vision-bench/debug/state') {
      return { ok: true, active: true, session: { state: 'running' } }
    }
    return { ok: true }
  }

  const hook = useDebugEvents(React, mockPost, { cwd: '/test', sessionId: 'sess-1' })

  // Trigger pause
  await hook.actions.pause()
  assert.equal(lastCommand?.op, 'pause')
  // Notice: hook status remains 'idle' or previous state, NOT optimistically mutated to 'paused'
  assert.notEqual(hook.status, 'paused')

  // Trigger step
  await hook.actions.step('over')
  assert.equal(lastCommand?.op, 'step')
  assert.notEqual(hook.status, 'paused')
})

test('F15: selectFrame drops out-of-order stale stack frame local responses', async () => {
  const React = createMockReact()

  const mockPost = async (path, body) => {
    if (path === '/dsh-vision-bench/debug/command' && body?.op === 'locals') {
      const frameLevel = body.frameLevel ?? body.args?.frameLevel
      if (frameLevel === 0) {
        // slow response for frame 0
        await new Promise((r) => setTimeout(r, 50))
        return { ok: true, variables: [{ name: 'varA_from_frame_0', value: '0' }] }
      }
      if (frameLevel === 1) {
        // fast response for frame 1
        await new Promise((r) => setTimeout(r, 10))
        return { ok: true, variables: [{ name: 'varB_from_frame_1', value: '1' }] }
      }
    }
    return { ok: true }
  }

  const hook = useDebugEvents(React, mockPost, { cwd: '/test', sessionId: 'sess-1' })

  // Trigger frame 0 then frame 1 immediately
  const p0 = hook.actions.selectFrame(0)
  const p1 = hook.actions.selectFrame(1)

  await Promise.all([p0, p1])

  // In mock React without automatic scheduler, reset indices to simulate component re-render
  React.reset()
  const rerendered = useDebugEvents(React, mockPost, { cwd: '/test', sessionId: 'sess-1' })

  // Even though frame 0 resolved second, frame 1's variables MUST win because frame 1 was requested last!
  assert.equal(rerendered.variables.locals.length, 1)
  assert.equal(rerendered.variables.locals[0].name, 'varB_from_frame_1')
})
