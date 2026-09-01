import assert from 'node:assert/strict'
import test from 'node:test'
import { clearActiveScope, setActiveScope } from '../src/ui/common/session-scope.mjs'
import {
  MANUAL_NAV_LEASE_MS,
  clearNavStore,
  getNav,
  isManualNavLeaseActive,
  navigate,
  setNavNow,
} from '../src/ui/workspace/vision-navigation-store.mjs'
import { wrapVisionPage } from '../src/ui/workspace/vision-page-boundary.mjs'
import { MONITOR_SECTIONS, VIEW_DEBUG, VIEW_HMI, VIEW_MONITOR } from '../src/ui/workspace/vision-route.mjs'
import {
  acceptQueuedVisionRequest,
  applyConsumedViewRequest,
  clearAllVisionRequests,
  consumeViewRequest,
  decodeFocusToken,
  encodeFocusToken,
  enqueueVisionRequest,
  peekVisionRequest,
  requestOpenView,
  takeVisionRequest,
} from '../src/ui/workspace/vision-view-request.mjs'
import { alpha3PageProps } from './fixtures/harness-alpha3-props.mjs'

function fakeReact() {
  const refs = []
  let cursor = 0
  return {
    rewind() {
      cursor = 0
    },
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useRef: (init) => {
      const i = cursor++
      if (!refs[i]) refs[i] = { current: init }
      return refs[i]
    },
    useEffect: (fn) => fn(),
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  }
}

test('encode/decode round-trips section target routeKey source', () => {
  const token = encodeFocusToken({
    section: MONITOR_SECTIONS.FRAMES,
    target: { connectionId: 'c1', frameId: 'f1' },
    routeKey: 's1|/ws|frames',
    source: 'manual',
  })
  assert.match(token, /^dvb1:/)
  const decoded = decodeFocusToken(token)
  assert.equal(decoded.ok, true)
  assert.equal(decoded.value.section, MONITOR_SECTIONS.FRAMES)
  assert.equal(decoded.value.target.frameId, 'f1')
  assert.equal(decoded.value.routeKey, 's1|/ws|frames')
  assert.equal(decoded.value.source, 'manual')
})

test('malformed tokens are ignored', () => {
  assert.equal(decodeFocusToken('').ok, false)
  assert.equal(decodeFocusToken('nope').ok, false)
  assert.equal(decodeFocusToken('dvb1:%7Bnot-json').ok, false)
  assert.equal(decodeFocusToken('dvb1:' + encodeURIComponent('[]')).ok, false)
})

test('same-page section jump uses nav store without openView', () => {
  clearNavStore()
  clearAllVisionRequests()
  const token = setActiveScope('', { sessionId: 's1', cwd: '/ws', viewId: VIEW_MONITOR })
  const opened = []
  const props = {
    ...alpha3PageProps({ sessionId: 's1', path: '/ws' }),
    openView(view, focus) {
      opened.push({ view, focus })
    },
  }
  const result = requestOpenView(props, VIEW_MONITOR, {
    section: MONITOR_SECTIONS.FRAMES,
    source: 'manual',
  })
  assert.equal(result.mode, 'same-view')
  assert.equal(getNav('s1', '/ws').section, MONITOR_SECTIONS.FRAMES)
  assert.equal(opened.length, 0)
  clearActiveScope(token)
  clearNavStore()
})

test('HMI to monitor and debug to HMI call openView with a dvb1 token', () => {
  clearNavStore()
  clearAllVisionRequests()
  const opened = []
  const hmiToken = setActiveScope('', { sessionId: 's1', cwd: '/ws', viewId: VIEW_HMI })
  const hmiProps = {
    ...alpha3PageProps({ sessionId: 's1', path: '/ws' }),
    openView(view, focus) {
      opened.push({ view, focus })
    },
  }
  const toMonitor = requestOpenView(hmiProps, VIEW_MONITOR, {
    section: MONITOR_SECTIONS.ALARMS,
    target: { alarmId: 'a1' },
    source: 'manual',
  })
  assert.equal(toMonitor.mode, 'open-view')
  assert.equal(opened[0].view, VIEW_MONITOR)
  assert.equal(decodeFocusToken(opened[0].focus).value.section, MONITOR_SECTIONS.ALARMS)
  clearActiveScope(hmiToken)

  const debugToken = setActiveScope('', { sessionId: 's1', cwd: '/ws', viewId: VIEW_DEBUG })
  const debugProps = {
    ...alpha3PageProps({ sessionId: 's1', path: '/ws' }),
    openView(view, focus) {
      opened.push({ view, focus })
    },
  }
  const toHmi = requestOpenView(debugProps, VIEW_HMI, {
    target: { connectionId: 'c1', pointId: 'p1' },
    source: 'manual',
  })
  assert.equal(toHmi.mode, 'open-view')
  assert.equal(opened[1].view, VIEW_HMI)
  assert.equal(decodeFocusToken(opened[1].focus).value.target.pointId, 'p1')
  clearActiveScope(debugToken)
  clearNavStore()
})

test('viewRequest for another view is not consumed', () => {
  const result = consumeViewRequest({ view: VIEW_MONITOR, focus: encodeFocusToken({ section: 'frames' }) }, VIEW_HMI)
  assert.equal(result.consume, false)
  assert.equal(result.complete, false)
  assert.equal(result.reason, 'other-view')
})

test('malformed viewRequest still completes exactly once at the owner view', () => {
  const result = consumeViewRequest({ view: VIEW_HMI, focus: 'not-a-token' }, VIEW_HMI)
  assert.equal(result.consume, false)
  assert.equal(result.complete, true)
  assert.equal(result.reason, 'prefix')
})

test('wrapVisionPage completes a matching viewRequest exactly once', () => {
  clearNavStore()
  clearAllVisionRequests()
  const React = fakeReact()
  const Page = function Inner(props) {
    return props
  }
  let completes = 0
  const token = encodeFocusToken({
    section: MONITOR_SECTIONS.FRAMES,
    target: { frameId: 'f9' },
    routeKey: 'rk-1',
    source: 'agent',
  })
  const props = {
    ...alpha3PageProps({ sessionId: 's1', path: '/ws' }),
    viewRequest: { view: VIEW_MONITOR, focus: token },
    completeViewRequest() {
      completes += 1
    },
  }
  const Wrapped = wrapVisionPage(React, Page, 'monitor')
  Wrapped(props)
  React.rewind()
  Wrapped(props)
  assert.equal(completes, 1)
  assert.equal(getNav('s1', '/ws').section, MONITOR_SECTIONS.FRAMES)
  clearNavStore()
  clearAllVisionRequests()
})

test('user lease blocks Agent steal and only records a badge queue', () => {
  clearNavStore()
  clearAllVisionRequests()
  let now = 5_000_000
  setNavNow(() => now)
  const token = setActiveScope('', { sessionId: 's1', cwd: '/ws', viewId: VIEW_HMI })
  navigate('s1', '/ws', { viewId: VIEW_HMI, section: '' }, { source: 'manual' })
  assert.equal(isManualNavLeaseActive('s1', '/ws'), true)
  const opened = []
  const props = {
    ...alpha3PageProps({ sessionId: 's1', path: '/ws' }),
    openView(view, focus) {
      opened.push({ view, focus })
    },
  }
  const blocked = requestOpenView(props, VIEW_MONITOR, {
    section: MONITOR_SECTIONS.FRAMES,
    routeKey: 'agent-frames',
    source: 'agent',
  })
  assert.equal(blocked.mode, 'badge')
  assert.equal(opened.length, 0)
  assert.equal(getNav('s1', '/ws').viewId, VIEW_HMI)
  assert.equal(peekVisionRequest('s1').viewId, VIEW_MONITOR)
  now += MANUAL_NAV_LEASE_MS + 1
  const accepted = acceptQueuedVisionRequest(props)
  assert.equal(accepted.applied, true)
  assert.equal(opened[0].view, VIEW_MONITOR)
  clearActiveScope(token)
  setNavNow(null)
  clearNavStore()
  clearAllVisionRequests()
})

test('background session only records a badge and does not leak into the foreground queue', () => {
  clearAllVisionRequests()
  enqueueVisionRequest('sA', { viewId: VIEW_MONITOR, section: MONITOR_SECTIONS.ALARMS, routeKey: 'a' })
  enqueueVisionRequest('sB', { viewId: VIEW_HMI, section: '', routeKey: 'b' })
  assert.equal(peekVisionRequest('sA').viewId, VIEW_MONITOR)
  assert.equal(peekVisionRequest('sB').viewId, VIEW_HMI)
  assert.equal(takeVisionRequest('sA', VIEW_HMI), null)
  assert.equal(peekVisionRequest('sA').viewId, VIEW_MONITOR)
  takeVisionRequest('sB', VIEW_HMI)
  assert.equal(peekVisionRequest('sB'), null)
  assert.equal(peekVisionRequest('sA').section, MONITOR_SECTIONS.ALARMS)
  clearAllVisionRequests()
})

test('session switch does not apply the previous session request', () => {
  clearNavStore()
  clearAllVisionRequests()
  enqueueVisionRequest('sOld', {
    viewId: VIEW_MONITOR,
    section: MONITOR_SECTIONS.FRAMES,
    routeKey: 'old',
  })
  const applied = applyConsumedViewRequest('sNew', '/ws', VIEW_MONITOR, {
    section: MONITOR_SECTIONS.ALARMS,
    source: 'agent',
  })
  assert.equal(applied.applied, true)
  assert.equal(peekVisionRequest('sOld').section, MONITOR_SECTIONS.FRAMES)
  assert.equal(peekVisionRequest('sNew'), null)
  clearNavStore()
  clearAllVisionRequests()
})

test('same routeKey is deduped per session', () => {
  clearAllVisionRequests()
  const first = enqueueVisionRequest('s1', { viewId: VIEW_HMI, routeKey: 'rk', section: '' })
  const second = enqueueVisionRequest('s1', { viewId: VIEW_MONITOR, routeKey: 'rk', section: 'frames' })
  assert.equal(first.deduped, false)
  assert.equal(second.deduped, true)
  assert.equal(peekVisionRequest('s1').viewId, VIEW_HMI)
  clearAllVisionRequests()
})
