import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createMonitorWorkspace } from '../../src/ui/workspace/monitor-workspace.mjs'
import { clearNavStore } from '../../src/ui/workspace/vision-navigation-store.mjs'
import { MONITOR_SECTIONS } from '../../src/ui/workspace/vision-route.mjs'

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

test('monitor workspace tab click uses manual nav source', () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../src/ui/workspace/monitor-workspace.mjs'),
    'utf8',
  )
  assert.match(src, /source: 'manual'/)
})
