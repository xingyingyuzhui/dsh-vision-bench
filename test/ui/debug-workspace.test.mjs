import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createDebugWorkspace } from '../../src/ui/workspace/debug-workspace.mjs'
import { clearNavStore } from '../../src/ui/workspace/vision-navigation-store.mjs'
import { DEBUG_SECTIONS } from '../../src/ui/workspace/vision-route.mjs'

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

test('debug workspace only has workbench and project sections', () => {
  clearNavStore()
  const React = makeReact()
  const Page = createDebugWorkspace(
    React,
    (key) => key,
    async () => ({}),
  )
  const tree = Page({ sessionId: 's1', scope: { cwd: '/tmp' } })
  assert.equal(tree.props['data-workspace'], 'debug')
  assert.equal(tree.props['data-section'], DEBUG_SECTIONS.WORKBENCH)
  const tabs = tree.children[0]
  const ids = (tabs.children || []).map((btn) => btn.props['data-section'])
  assert.deepEqual(ids, [DEBUG_SECTIONS.WORKBENCH, DEBUG_SECTIONS.PROJECT])
  assert.equal(ids.includes('log'), false)
})

test('debug workspace tab click uses manual nav source', () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../src/ui/workspace/debug-workspace.mjs'),
    'utf8',
  )
  assert.match(src, /source: 'manual'/)
})
