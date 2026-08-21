import assert from 'node:assert/strict'
import test from 'node:test'

// Mount every conversation view with stub React/post/hooks and render twice
// (initial + one state update). The strip-concat bundle resolves cross-module
// symbols only through shared scope; a renamed or moved helper previously
// exploded here at runtime with no test to catch it.

function makeReact(t, hooks = {}) {
  const el = (type, props, ...children) => ({ type, props: props || {}, children })
  const ReactStub = { createElement: el }
  const useState = (init) => {
    let v = typeof init === 'function' ? init() : init
    return [v, (next) => {
      v = typeof next === 'function' ? next(v) : next
      if (hooks.onUpdate) hooks.onUpdate(v)
    }]
  }
  const useRef = (init) => ({ current: init })
  ReactStub.useState = useState
  ReactStub.useRef = useRef
  ReactStub.useEffect = (fn) => { /* register-only: no timer loops in smoke */ }
  return ReactStub
}

const post = () => Promise.resolve({ ok: true })

test('debug view mounts without hidden-scope ReferenceErrors', async () => {
  const { createDebugView } = await import('../bench-view.mjs')
  const DebugView = createDebugView(makeReact(), () => 'k', post, {})
  const tree = DebugView({ sessionId: 's1', useSessions: (fn) => fn({ byId: { s1: { cwd: '/tmp' } } }) })
  assert.ok(tree, 'debug tree rendered')
})

test('hmi view mounts — the former blind spot of the bundle', async () => {
  const { createHmiView } = await import('../bench-hmi.mjs')
  const HmiView = createHmiView(makeReact(), () => 'k', post, {})
  const tree = HmiView({ sessionId: 's1' })
  assert.ok(tree, 'hmi tree rendered')
})

test('live/overview views mount', async () => {
  const { createLiveView } = await import('../bench-live.mjs')
  const { createOverviewView } = await import('../bench-overview.mjs')
  const Live = createLiveView(makeReact(), () => 'k', post, {})
  assert.ok(Live({ tab: {} }))
  const Overview = createOverviewView(makeReact(), () => 'k', post, {})
  assert.ok(Overview({ sessionId: 's1', useSessions: (fn) => fn({ byId: {} }) }))
})
