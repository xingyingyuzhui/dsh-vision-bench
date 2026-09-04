import assert from 'node:assert/strict'
import test from 'node:test'
import { clearNavStore, getNav, navigate, subscribeNav } from '../../src/ui/workspace/vision-navigation-store.mjs'
import {
  DEBUG_SECTIONS,
  MONITOR_SECTIONS,
  VIEW_DEBUG,
  VIEW_HMI,
  VIEW_MONITOR,
  routeForKind,
  shouldRouteFocus,
} from '../../src/ui/workspace/vision-route.mjs'

test('workspace ids and debug IA A: workbench + project + runtime', () => {
  assert.equal(VIEW_DEBUG, 'vision-bench-debug')
  assert.equal(VIEW_HMI, 'vision-bench-hmi')
  assert.equal(VIEW_MONITOR, 'vision-bench-monitor')
  assert.deepEqual(DEBUG_SECTIONS, { WORKBENCH: 'workbench', PROJECT: 'project', RUNTIME: 'runtime' })
  assert.equal(Object.keys(DEBUG_SECTIONS).includes('LOG'), false)
  assert.deepEqual(Object.values(MONITOR_SECTIONS).sort(), ['alarms', 'frames', 'journal', 'visualization'].sort())
})

test('kind maps onto native view + section', () => {
  assert.deepEqual(routeForKind('visualization'), {
    viewId: VIEW_MONITOR,
    section: MONITOR_SECTIONS.VISUALIZATION,
    tab: 'trend',
  })
  assert.deepEqual(routeForKind('frame'), {
    viewId: VIEW_MONITOR,
    section: MONITOR_SECTIONS.FRAMES,
    tab: 'frames',
  })
  assert.deepEqual(routeForKind('alarm'), {
    viewId: VIEW_MONITOR,
    section: MONITOR_SECTIONS.ALARMS,
    tab: 'alarm',
  })
  assert.deepEqual(routeForKind('journal'), {
    viewId: VIEW_MONITOR,
    section: MONITOR_SECTIONS.JOURNAL,
    tab: 'journal',
  })
  assert.deepEqual(routeForKind('file'), {
    viewId: VIEW_DEBUG,
    section: DEBUG_SECTIONS.PROJECT,
    tab: 'project',
  })
  assert.deepEqual(routeForKind('point'), { viewId: VIEW_HMI, section: '', tab: 'table' })
})

test('shouldRouteFocus returns viewId/section and still exposes tab alias', () => {
  const d = shouldRouteFocus({
    activeCwd: '/w',
    changedCwd: '/w',
    focus: { request: { frameId: 'f1', connectionId: 'c1' }, badgeOnly: false },
    previousRouteKey: '',
  })
  assert.equal(d.route, true)
  assert.equal(d.viewId, VIEW_MONITOR)
  assert.equal(d.section, MONITOR_SECTIONS.FRAMES)
  assert.equal(d.tab, 'frames')
  assert.equal(d.target.frameId, 'f1')
})

test('nav store is keyed by exact sessionId\\0cwd with no empty-session fallback', () => {
  clearNavStore()
  const seen = []
  const stop = subscribeNav('s1', '/w', (nav) => seen.push(nav))
  navigate('s1', '/w', { viewId: VIEW_MONITOR, section: MONITOR_SECTIONS.ALARMS }, { source: 'manual' })
  assert.equal(getNav('s1', '/w').section, MONITOR_SECTIONS.ALARMS)
  assert.equal(getNav('', '/w'), null)
  assert.equal(seen.length, 1)
  stop()
  clearNavStore()
})

test('background Session Focus does not steal the current page', () => {
  const d = shouldRouteFocus({
    activeCwd: '/w',
    activeSessionId: 'sB',
    changedCwd: '/w',
    focus: { sessionId: 'sA', request: { frameId: 'f1', connectionId: 'c1' }, badgeOnly: false },
    previousRouteKey: '',
  })
  assert.equal(d.route, false)
})

test('matching Session Focus for frames lands on monitor serial frames', () => {
  const d = shouldRouteFocus({
    activeCwd: '/w',
    activeSessionId: 's1',
    changedCwd: '/w',
    focus: { sessionId: 's1', request: { frameId: 'f1', connectionId: 'c1' }, badgeOnly: false },
    previousRouteKey: '',
  })
  assert.equal(d.route, true)
  assert.equal(d.viewId, VIEW_MONITOR)
  assert.equal(d.section, MONITOR_SECTIONS.FRAMES)
})
