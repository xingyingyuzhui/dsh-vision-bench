import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearActiveScope,
  getActiveScope,
  pageSessionId,
  sessionCwd,
  setActiveScope,
  useSessionCwd,
} from '../src/ui/common/session-scope.mjs'
import { clearNavStore, getNav } from '../src/ui/workspace/vision-navigation-store.mjs'
import { viewIdForPage, wrapVisionPage } from '../src/ui/workspace/vision-page-boundary.mjs'
import { VIEW_MONITOR } from '../src/ui/workspace/vision-route.mjs'
import { alpha3PageProps, alpha3Workspace } from './fixtures/harness-alpha3-props.mjs'

test('sessionCwd prefers useWorkspaces over deprecated scope.cwd', async () => {
  const props = {
    ...alpha3PageProps({ sessionId: 's1', path: '/ws/alpha' }),
    scope: { cwd: '/legacy' },
  }
  assert.equal(sessionCwd(props), '/ws/alpha')
})

test('sessionCwd keeps scope.cwd as short-term fallback', async () => {
  assert.equal(sessionCwd({ sessionId: 's1', scope: { cwd: '/ws/a' } }), '/ws/a')
  assert.equal(sessionCwd({}), '')
})

test('useSessionCwd reads the same workspace path as sessionCwd', async () => {
  const props = alpha3PageProps({ sessionId: 's9', path: '/ws/9' })
  assert.equal(useSessionCwd(null, props), '/ws/9')
})

test('pageSessionId reads props.sessionId then scope.sessionId', async () => {
  assert.equal(pageSessionId({ sessionId: 's1', scope: { sessionId: 's2' } }), 's1')
  assert.equal(pageSessionId({ scope: { sessionId: 's2' } }), 's2')
  assert.equal(pageSessionId({}), '')
})

test('active scope token guards clear and keeps sessionId/viewId', async () => {
  const t1 = setActiveScope('', { sessionId: 's1', cwd: '/ws/one', viewId: 'vision-bench-hmi' })
  assert.equal(getActiveScope().cwd, '/ws/one')
  assert.equal(getActiveScope().sessionId, 's1')
  assert.equal(getActiveScope().viewId, 'vision-bench-hmi')
  const t2 = setActiveScope('', { sessionId: 's2', cwd: '/ws/two', viewId: 'vision-bench-monitor' })
  assert.notEqual(t1, t2)
  assert.equal(clearActiveScope(t1), '/ws/two', 'stale token must not wipe newer scope')
  assert.equal(getActiveScope().cwd, '/ws/two')
  assert.equal(getActiveScope().sessionId, 's2')
  assert.equal(clearActiveScope(t2), '')
  assert.equal(getActiveScope().cwd, '')
  assert.equal(getActiveScope().sessionId, '')
  assert.equal(getActiveScope().viewId, '')
})

test('wrapVisionPage writes real sessionId and viewId into the active scope', () => {
  clearNavStore()
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useRef: (init) => ({ current: init }),
    useEffect: (fn) => fn(),
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  }
  const Page = function Inner(props) {
    return props
  }
  const Wrapped = wrapVisionPage(React, Page, 'monitor')
  Wrapped({ ...alpha3PageProps({ sessionId: 'sA', path: '/ws' }), scope: { cwd: '/ws' } })
  const active = getActiveScope()
  assert.equal(active.sessionId, 'sA')
  assert.equal(active.cwd, '/ws')
  assert.equal(active.viewId, VIEW_MONITOR)
  assert.equal(viewIdForPage('monitor'), VIEW_MONITOR)
  assert.equal(getNav('sA', '/ws').viewId, VIEW_MONITOR)
  assert.equal(getNav('sB', '/ws'), null)
  clearNavStore()
  clearActiveScope(active.token)
})

test('wrapVisionPage waits when the session has no workspace', () => {
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useRef: (init) => ({ current: init }),
    useEffect: (fn) => fn(),
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  }
  const Page = function Inner() {
    return { type: 'page' }
  }
  const copy = {
    workspaceWaiting: 'Waiting for workspace',
    workspaceWaitingHint: 'This session is not in a workspace yet. State loads after it joins one.',
  }
  const Wrapped = wrapVisionPage(React, Page, 'hmi', (key) => copy[key] || key)
  const tree = Wrapped(
    alpha3PageProps({
      sessionId: 's-empty',
      items: [alpha3Workspace({ sessionId: 'other', path: '/ws/x' })],
    }),
  )
  assert.equal(tree.props['data-workspace-waiting'], 'true')
  assert.notEqual(tree.type, Page)
  assert.equal(tree.children[0].children[0], copy.workspaceWaiting)
})
