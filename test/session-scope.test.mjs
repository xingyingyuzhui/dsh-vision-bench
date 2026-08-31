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

test('sessionCwd prefers props.scope.cwd', async () => {
  assert.equal(sessionCwd({ scope: { cwd: '/ws/a' }, sessionId: 's1', useSessions: () => '/ws/other' }), '/ws/a')
})

test('sessionCwd falls back to useSessions by sessionId then current', async () => {
  const byId = {
    s1: { cwd: '/ws/s1' },
    s2: { cwd: '/ws/s2' },
  }
  assert.equal(
    sessionCwd({
      sessionId: 's1',
      useSessions: (sel) => sel({ byId, current: 's2' }),
    }),
    '/ws/s1',
  )
  assert.equal(
    sessionCwd({
      useSessions: (sel) => sel({ byId, current: 's2' }),
    }),
    '/ws/s2',
  )
  assert.equal(sessionCwd({}), '')
})

test('useSessionCwd reads by sessionId only', async () => {
  const byId = { s9: { cwd: '/ws/9' } }
  assert.equal(
    useSessionCwd(null, {
      sessionId: 's9',
      useSessions: (sel) => sel({ byId, current: 's9' }),
    }),
    '/ws/9',
  )
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
    createElement: (type, props) => ({ type, props }),
    useRef: (init) => ({ current: init }),
    useEffect: (fn) => fn(),
  }
  const Page = function Inner(props) {
    return props
  }
  const Wrapped = wrapVisionPage(React, Page, 'monitor')
  Wrapped({ sessionId: 'sA', scope: { cwd: '/ws' } })
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
