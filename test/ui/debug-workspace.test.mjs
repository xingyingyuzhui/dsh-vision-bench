import assert from 'node:assert/strict'
import test from 'node:test'
import { createDebugWorkspace } from '../../src/ui/workspace/debug-workspace.mjs'
import { clearNavStore, getNav, isManualNavLeaseActive } from '../../src/ui/workspace/vision-navigation-store.mjs'
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

test('debug tab labels resolve at render time, not factory time', () => {
  clearNavStore()
  let lang = 'en'
  const t = (key) => {
    if (key === 'sectionWorkbench') return lang === 'zh' ? '工作台' : 'Workbench'
    if (key === 'projectMap') return lang === 'zh' ? '工程结构' : 'Project map'
    if (key === 'sectionRuntime') return lang === 'zh' ? '运行调试' : 'Runtime Debug'
    return key
  }
  const React = makeReact()
  const Page = createDebugWorkspace(React, t, async () => ({}))
  lang = 'zh'
  const tree = Page({ sessionId: 's1', scope: { cwd: '/tmp' } })
  const tabs = tree.children[0]
  const labels = (tabs.children || []).map((btn) => btn.children[0])
  assert.deepEqual(labels, ['工作台', '工程结构', '运行调试'])
  clearNavStore()
})

test('debug workspace tab click uses manual nav source', () => {
  clearNavStore()
  const React = makeReact()
  const Page = createDebugWorkspace(
    React,
    (key) => key,
    async () => ({}),
  )
  const tree = Page({ sessionId: 's1', scope: { cwd: '/tmp' } })
  const tabs = tree.children[0]
  const projectBtn = tabs.children.find((btn) => btn.props['data-section'] === DEBUG_SECTIONS.PROJECT)
  assert.ok(projectBtn?.props?.onClick)
  projectBtn.props.onClick()
  assert.equal(isManualNavLeaseActive('s1', '/tmp'), true)
  assert.equal(getNav('s1', '/tmp').section, DEBUG_SECTIONS.PROJECT)
  clearNavStore()
})

test('inactive debug section is unmounted, not hidden', () => {
  clearNavStore()
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

test('WORKSPACE_CSS exports layout class tokens used by the workspace shell', async () => {
  const { WORKSPACE_CSS } = await import('../../src/ui/styles/workspace.mjs')
  assert.ok(Array.isArray(WORKSPACE_CSS) && WORKSPACE_CSS.length > 0)
  const css = WORKSPACE_CSS.join('\n')
  for (const token of [
    '.dvb-workspace',
    '.dvb-ws-tabs',
    '.dvb-ws-body',
    '.dvb-ws-pane',
    'visibility:hidden',
    '--dsw-alias-border-l2',
  ]) {
    assert.ok(css.includes(token), `missing token ${token}`)
  }
  assert.doesNotMatch(css, /\.dvb-ws-pane\[data-active="false"\]\{[^}]*display:\s*none/)
})
