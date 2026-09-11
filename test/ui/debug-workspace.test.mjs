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

test('debug workspace has workbench, project, and runtime sections', () => {
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
  assert.deepEqual(ids, [DEBUG_SECTIONS.WORKBENCH, DEBUG_SECTIONS.PROJECT, DEBUG_SECTIONS.RUNTIME])
  assert.equal(ids.includes('log'), false)
})

test('debug workspace tab click uses manual nav source', () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../src/ui/workspace/debug-workspace.mjs'),
    'utf8',
  )
  assert.match(src, /source: 'manual'/)
})

test('inactive debug section is unmounted, not hidden', () => {
  clearNavStore()
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../src/ui/workspace/debug-workspace.mjs'),
    'utf8',
  )
  assert.match(src, /section === DEBUG_SECTIONS.WORKBENCH/)
  assert.doesNotMatch(src, /hidden:/)
  const React = makeReact()
  const Page = createDebugWorkspace(
    React,
    (key) => key,
    async () => ({}),
  )
  const tree = Page({ sessionId: 's1', scope: { cwd: '/tmp' } })
  const body = tree.children[1]
  assert.equal((body.children || []).length, 1)
})

test('debug workspace tab button uses dvb-tab and is-on class for selected section', () => {
  clearNavStore()
  const React = makeReact()
  const Page = createDebugWorkspace(
    React,
    (key) => key,
    async () => ({}),
  )
  const tree = Page({ sessionId: 's1', scope: { cwd: '/tmp' } })
  const tabs = tree.children[0]
  const activeBtn = tabs.children.find((btn) => btn.props['data-section'] === DEBUG_SECTIONS.WORKBENCH)
  assert.ok(activeBtn)
  assert.match(activeBtn.props.className, /dvb-tab/)
  assert.match(activeBtn.props.className, /is-on/)
  const inactiveBtn = tabs.children.find((btn) => btn.props['data-section'] === DEBUG_SECTIONS.PROJECT)
  assert.ok(inactiveBtn)
  assert.match(inactiveBtn.props.className, /dvb-tab/)
  assert.doesNotMatch(inactiveBtn.props.className, /is-on/)
})

test('workspace tab bar supports keyboard navigation (ArrowRight, ArrowLeft, Home, End)', async () => {
  clearNavStore()
  const React = makeReact()
  const Page = createDebugWorkspace(
    React,
    (key) => key,
    async () => ({}),
  )
  const tree = Page({ sessionId: 's1', scope: { cwd: '/tmp' } })
  const tabs = tree.children[0]
  assert.equal(typeof tabs.props.onKeyDown, 'function')
  let selected = ''
  const { renderWorkspaceTabs } = await import('../../src/ui/workspace/workspace-tabs.mjs')
  const customTabs = renderWorkspaceTabs(React.createElement, {
    sections: ['workbench', 'project', 'runtime'],
    active: 'workbench',
    onSelect: (id) => {
      selected = id
    },
  })
  let prevented = false
  const fakeEvent = (key) => ({
    key,
    preventDefault: () => {
      prevented = true
    },
  })

  customTabs.props.onKeyDown(fakeEvent('ArrowRight'))
  assert.equal(selected, 'project')
  assert.equal(prevented, true)

  customTabs.props.onKeyDown(fakeEvent('End'))
  assert.equal(selected, 'runtime')

  customTabs.props.onKeyDown(fakeEvent('Home'))
  assert.equal(selected, 'workbench')
})

test('WORKSPACE_CSS aligns layout and tab bar with HMI standards', async () => {
  const { WORKSPACE_CSS } = await import('../../src/ui/styles/workspace.mjs')
  const css = WORKSPACE_CSS.join('\n')
  assert.match(css, /\.dvb-workspace\{[^}]*padding:8px calc\(var\(--dsh-composer-side-clearance, 16px\) \+ 16px\) 8px/)
  assert.match(css, /\.dvb-ws-tabs\{[^}]*border-bottom:1px solid var\(--dsw-alias-border-l2/)
  assert.match(css, /body\[data-dsh-vision-bench\] \.dvb-ws-body>\.dvb-page\{padding:0/)
  assert.match(css, /body\[data-dsh-vision-bench\] \.dvb-ws-body>\.dvb-live/)
})
