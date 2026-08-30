import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearActiveScope,
  getActiveScope,
  sessionCwd,
  setActiveScope,
  useSessionCwd,
} from '../src/ui/common/session-scope.mjs'

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

test('active scope token guards clear', async () => {
  const t1 = setActiveScope('', '/ws/one')
  assert.equal(getActiveScope().cwd, '/ws/one')
  const t2 = setActiveScope('', '/ws/two')
  assert.notEqual(t1, t2)
  assert.equal(clearActiveScope(t1), '/ws/two', 'stale token must not wipe newer scope')
  assert.equal(getActiveScope().cwd, '/ws/two')
  assert.equal(clearActiveScope(t2), '')
  assert.equal(getActiveScope().cwd, '')
})
