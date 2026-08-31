import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createMonitorWorkspace } from '../../src/ui/workspace/monitor-workspace.mjs'
import { clearNavStore, navigate } from '../../src/ui/workspace/vision-navigation-store.mjs'
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

test('monitor workspace tab click uses manual nav source', () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../src/ui/workspace/monitor-workspace.mjs'),
    'utf8',
  )
  assert.match(src, /source: 'manual'/)
})
