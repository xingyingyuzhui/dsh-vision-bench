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

test('sidebar pages mount: 操作记录/曲线/告警 (监视已删除，采集由 Host 服务运行)', async () => {
  const { createLogPage, createTrendPage, createAlarmPage } = await import('../bench-live.mjs')
  const postMock = async () => ({ ok: true })
  const Log = createLogPage(makeReact(), () => 'k', postMock, {})
  assert.ok(Log({ tab: {}, scope: { cwd: '/ws' } }))
  const Trend = createTrendPage(makeReact(), () => 'k', postMock, {})
  assert.ok(Trend({ tab: {}, scope: { cwd: '/ws' } }))
  const Alarm = createAlarmPage(makeReact(), () => 'k', postMock, {})
  assert.ok(Alarm({ tab: {}, scope: { cwd: '/ws' } }))
  const lib = await import('../bench-live.mjs')
  assert.equal(typeof lib.createLiveView, 'undefined', '监视视图已移除')
  assert.equal(typeof lib.openModbusTab, 'undefined', '监视 Tab 入口已移除')
})
