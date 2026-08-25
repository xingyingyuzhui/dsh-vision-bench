// Task1/0.18.4: pure focus-routing decisions — active cwd gate, badgeOnly and
// foreground gates, routeKey dedup incl. cwd, and kind→tab mapping.
import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldRouteFocus } from '../bench-shared.mjs'

const focus = (over = {}) => ({
  request: {
    connectionId: 'c1',
    deviceId: 'd1',
    ...over.request,
  },
  badgeOnly: false,
  ...over,
})

test('active=A, A foreground frame → opens frames once', () => {
  const f = focus({ request: { frameId: 'f1', connectionId: 'c1' } })
  const d1 = shouldRouteFocus({ activeCwd: '/w/a', changedCwd: '/w/a', focus: f, previousRouteKey: '' })
  assert.equal(d1.route, true)
  assert.equal(d1.tab, 'frames')
  assert.ok(d1.routeKey.includes('/w/a'))
  // identical target polled again → no re-route
  const d2 = shouldRouteFocus({ activeCwd: '/w/a', changedCwd: '/w/a', focus: f, previousRouteKey: d1.routeKey })
  assert.equal(d2.route, false)
  assert.equal(d2.routeKey, d1.routeKey)
})

test('active=A, a B foreground alarm → no route', () => {
  const f = focus({ request: { alarmId: 'a1', connectionId: 'c2' } })
  const d = shouldRouteFocus({ activeCwd: '/w/a', changedCwd: '/w/b', focus: f, previousRouteKey: '' })
  assert.equal(d.route, false)
  assert.equal(d.tab, '')
})

test('active=A, A badgeOnly → no route', () => {
  const f = focus({ badgeOnly: true, request: { frameId: 'f1', connectionId: 'c1' } })
  const d = shouldRouteFocus({ activeCwd: '/w/a', changedCwd: '/w/a', focus: f, previousRouteKey: '' })
  assert.equal(d.route, false)
})

test('active=A, A same focus repeated 10× → routes exactly once', () => {
  const f = focus({ request: { trendKey: 'c1:d1:p1' } })
  let prev = ''
  let routed = 0
  for (let i = 0; i < 10; i++) {
    const d = shouldRouteFocus({ activeCwd: '/w/a', changedCwd: '/w/a', focus: f, previousRouteKey: prev })
    if (d.route) routed++
    prev = d.routeKey || prev
  }
  assert.equal(routed, 1)
  // kind trend maps to trend tab on the single route
  const first = shouldRouteFocus({ activeCwd: '/w/a', changedCwd: '/w/a', focus: f, previousRouteKey: '' })
  assert.equal(first.tab, 'trend')
})

test('active switches A→B: A events ignored, B events take effect', () => {
  const fA = focus({ request: { frameId: 'fA', connectionId: 'c1' } })
  const fB = focus({ request: { alarmId: 'aB', connectionId: 'c2' } })
  const dA = shouldRouteFocus({ activeCwd: '/w/a', changedCwd: '/w/a', focus: fA, previousRouteKey: '' })
  assert.equal(dA.tab, 'frames')
  // now active = B; A's stale frame focus must NOT switch the sidebar
  const dA2 = shouldRouteFocus({ activeCwd: '/w/b', changedCwd: '/w/a', focus: fA, previousRouteKey: dA.routeKey })
  assert.equal(dA2.route, false)
  // B's alarm focus routes once
  const dB = shouldRouteFocus({ activeCwd: '/w/b', changedCwd: '/w/b', focus: fB, previousRouteKey: '' })
  assert.equal(dB.route, true)
  assert.equal(dB.tab, 'alarm')
})

test('A and B sharing the same pointId never cross-judge', () => {
  const f = focus({ request: { pointId: 'p1', connectionId: 'c1', deviceId: 'd1' } })
  const dA = shouldRouteFocus({ activeCwd: '/w/a', changedCwd: '/w/a', focus: f, previousRouteKey: '' })
  const keyA = dA.routeKey
  const dB = shouldRouteFocus({ activeCwd: '/w/b', changedCwd: '/w/b', focus: f, previousRouteKey: '' })
  assert.notEqual(dB.routeKey, keyA, 'routeKey must include cwd')
  assert.equal(dB.tab, 'table')
})

test('kind mapping: point/connection/device→table, trend→trend, alarm→alarm, frame→frames', () => {
  assert.equal(shouldRouteFocus({ activeCwd: '/w/a', changedCwd: '/w/a', focus: focus({ request: { pointId: 'p' } }), previousRouteKey: '' }).tab, 'table')
  assert.equal(shouldRouteFocus({ activeCwd: '/w/a', changedCwd: '/w/a', focus: focus({ request: { connectionId: 'c' } }), previousRouteKey: '' }).tab, 'table')
  assert.equal(shouldRouteFocus({ activeCwd: '/w/a', changedCwd: '/w/a', focus: focus({ request: { trendKey: 'c:d:p' } }), previousRouteKey: '' }).tab, 'trend')
  assert.equal(shouldRouteFocus({ activeCwd: '/w/a', changedCwd: '/w/a', focus: focus({ request: { alarmId: 'a' } }), previousRouteKey: '' }).tab, 'alarm')
  assert.equal(shouldRouteFocus({ activeCwd: '/w/a', changedCwd: '/w/a', focus: focus({ request: { frameId: 'f' } }), previousRouteKey: '' }).tab, 'frames')
})

test('no activeCwd / no request / foreground=false never route', () => {
  assert.equal(shouldRouteFocus({ activeCwd: '', changedCwd: '/w/a', focus: focus({}), previousRouteKey: '' }).route, false)
  assert.equal(shouldRouteFocus({ activeCwd: '/w/a', changedCwd: '/w/a', focus: {}, previousRouteKey: '' }).route, false)
  assert.equal(shouldRouteFocus({ activeCwd: '/w/a', changedCwd: '/w/a', focus: focus({ foreground: false }), previousRouteKey: '' }).route, false)
})