import assert from 'node:assert/strict'
import test from 'node:test'
import { createMonitorWorkspace } from '../../src/ui/workspace/monitor-workspace.mjs'
import { clearNavStore, getNav, isManualNavLeaseActive, navigate } from '../../src/ui/workspace/vision-navigation-store.mjs'
import { MONITOR_SECTIONS, VIEW_MONITOR } from '../../src/ui/workspace/vision-route.mjs'

function makeReact() {
  const el = (type, props, ...children) => ({ type, props: props || {}, children })
  return {
    createElement: el,
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
    useRef: (init) => ({ current: init }),
    useEffect: () => {},
    useLayoutEffect: () => {},
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
  }
}

test('monitor workspace renders section tabs and defaults to visualization', () => {
  clearNavStore()
  const React = makeReact()
  const Page = createMonitorWorkspace(
    React,
    (key) => key,
    async () => ({}),
    {
      openHmi() {},
      openFrames() {},
    },
  )
  const tree = Page({ sessionId: 's1', scope: { cwd: '/tmp' } })
  assert.equal(tree.props['data-workspace'], 'monitor')
  assert.equal(tree.props['data-section'], MONITOR_SECTIONS.VISUALIZATION)
  const tabs = tree.children[0]
  const ids = (tabs.children || []).map((btn) => btn.props['data-section'])
  assert.deepEqual(ids, [
    MONITOR_SECTIONS.VISUALIZATION,
    MONITOR_SECTIONS.ALARMS,
    MONITOR_SECTIONS.FRAMES,
    MONITOR_SECTIONS.JOURNAL,
  ])
})

test('Session B first open defaults to visualization and does not inherit Session A', () => {
  clearNavStore()
  navigate('sA', '/tmp', { viewId: VIEW_MONITOR, section: MONITOR_SECTIONS.ALARMS }, { source: 'manual' })
  const React = makeReact()
  const Page = createMonitorWorkspace(
    React,
    (key) => key,
    async () => ({}),
    {
      openHmi() {},
      openFrames() {},
    },
  )
  const treeB = Page({ sessionId: 'sB', scope: { cwd: '/tmp' } })
  assert.equal(treeB.props['data-section'], MONITOR_SECTIONS.VISUALIZATION)
  const treeA = Page({ sessionId: 'sA', scope: { cwd: '/tmp' } })
  assert.equal(treeA.props['data-section'], MONITOR_SECTIONS.ALARMS)
  clearNavStore()
})

test('monitor tab labels resolve at render time, not factory time', () => {
  clearNavStore()
  let lang = 'en'
  const t = (key) => {
    if (key === 'liveChart') return lang === 'zh' ? '可视化' : 'Charts'
    if (key === 'liveAlarm') return lang === 'zh' ? '告警' : 'Alarms'
    if (key === 'framesTab') return lang === 'zh' ? '串口报文' : 'Serial Frames'
    if (key === 'liveLog') return lang === 'zh' ? '操作记录' : 'Operation Log'
    return key
  }
  const React = makeReact()
  const Page = createMonitorWorkspace(React, t, async () => ({}), {
    openHmi() {},
    openFrames() {},
  })
  lang = 'zh'
  const tree = Page({ sessionId: 's1', scope: { cwd: '/tmp' } })
  const tabs = tree.children[0]
  const labels = (tabs.children || []).map((btn) => btn.children[0])
  assert.deepEqual(labels, ['可视化', '告警', '串口报文', '操作记录'])
  clearNavStore()
})

test('visualization pane stays mounted when another monitor section is active', () => {
  clearNavStore()
  navigate('s1', '/tmp', { viewId: VIEW_MONITOR, section: MONITOR_SECTIONS.ALARMS }, { source: 'manual' })
  const React = makeReact()
  const Page = createMonitorWorkspace(
    React,
    (key) => key,
    async () => ({}),
    {
      openHmi() {},
      openFrames() {},
    },
  )
  const tree = Page({ sessionId: 's1', scope: { cwd: '/tmp' } })
  assert.equal(tree.props['data-section'], MONITOR_SECTIONS.ALARMS)
  const body = tree.children[1]
  const kids = (body.children || []).filter(Boolean)
  const vizPane = kids.find((n) => n.props?.['data-section'] === MONITOR_SECTIONS.VISUALIZATION)
  assert.ok(vizPane, 'visualization pane stays in the tree')
  assert.equal(vizPane.props.className, 'dvb-ws-pane')
  assert.equal(vizPane.props['data-active'], 'false')
  assert.equal(vizPane.props['aria-hidden'], 'true')
  assert.equal(vizPane.props.inert, true)
  assert.ok(kids.length >= 2, 'alarms page still mounts beside the hidden viz pane')
  clearNavStore()
})

test('active visualization pane is shown without the HTML hidden attribute', () => {
  clearNavStore()
  const React = makeReact()
  const Page = createMonitorWorkspace(
    React,
    (key) => key,
    async () => ({}),
    {
      openHmi() {},
      openFrames() {},
    },
  )
  const tree = Page({ sessionId: 's1', scope: { cwd: '/tmp' } })
  const body = tree.children[1]
  const kids = (body.children || []).filter(Boolean)
  assert.equal(kids.length, 1)
  const vizPane = kids[0]
  assert.equal(vizPane.props['data-section'], MONITOR_SECTIONS.VISUALIZATION)
  assert.equal(vizPane.props['data-active'], 'true')
  assert.equal(vizPane.props['aria-hidden'], 'false')
  assert.equal(vizPane.props.hidden, undefined)
  clearNavStore()
})

test('monitor workspace tab click uses manual nav source', () => {
  clearNavStore()
  const React = makeReact()
  const Page = createMonitorWorkspace(
    React,
    (key) => key,
    async () => ({}),
    {
      openHmi() {},
      openFrames() {},
    },
  )
  const tree = Page({ sessionId: 's1', scope: { cwd: '/tmp' } })
  const tabs = tree.children[0]
  const framesBtn = tabs.children.find((btn) => btn.props['data-section'] === MONITOR_SECTIONS.FRAMES)
  assert.ok(framesBtn?.props?.onClick)
  framesBtn.props.onClick()
  assert.equal(isManualNavLeaseActive('s1', '/tmp'), true)
  assert.equal(getNav('s1', '/tmp').section, MONITOR_SECTIONS.FRAMES)
  clearNavStore()
})
