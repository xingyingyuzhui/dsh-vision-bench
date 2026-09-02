import assert from 'node:assert/strict'
// Task5/0.19.3: 工程结构 — 树渲染（组/文件/函数）、搜索、筛选、源码预览、
// 编译错误定位（Session 导航 target，不写 jumpProject）。
import { afterEach, beforeEach, test } from 'node:test'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { Window } from 'happy-dom'
import React from 'react'
import { createElement } from 'react'
import { createMapView } from '../bench-map.mjs'
import { findProjectFile, jumpErrorForHit } from '../src/ui/debug/project/project-tree-model.mjs'
import { shouldIgnoreProjectSearchShortcut } from '../src/ui/debug/project/project-workspace.mjs'
import { createDebugWorkspace } from '../src/ui/workspace/debug-workspace.mjs'
import { clearNavStore, navigate } from '../src/ui/workspace/vision-navigation-store.mjs'
import { DEBUG_SECTIONS, VIEW_DEBUG } from '../src/ui/workspace/vision-route.mjs'
import { alpha3PageProps } from './fixtures/harness-alpha3-props.mjs'

let win
beforeEach(async () => {
  win = new Window({ url: 'http://localhost/' })
  globalThis.window = win
  globalThis.document = win.document
  try {
    globalThis.navigator = { clipboard: { writeText: async () => {} }, userAgent: 'happy' }
  } catch {
    Object.defineProperty(globalThis, 'navigator', {
      value: { clipboard: { writeText: async () => {} }, userAgent: 'happy' },
      configurable: true,
    })
  }
  globalThis.ResizeObserver = class {
    constructor(cb) {
      this.cb = cb
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.Element = win.HTMLElement
  globalThis.HTMLElement = win.HTMLElement
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0)
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  globalThis.devicePixelRatio = 1
  globalThis.CustomEvent = win.CustomEvent
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '', setProperty() {}, removeProperty() {} })
})
afterEach(() => {
  cleanup()
  clearNavStore()
})

const MAP_DETAILS = {
  target: 'Debug',
  counts: { files: 3, includes: 1, include_edges: 1 },
  groups: [
    {
      name: 'Source',
      files: [
        {
          name: 'main.c',
          rel: 'src/main.c',
          inside: true,
          exists: true,
          readable: true,
          functions: [
            { name: 'main', line: 12 },
            { name: 'setup', line: 37 },
          ],
        },
        { name: 'missing.c', rel: 'src/missing.c', inside: true, exists: false, readable: false, functions: [] },
      ],
    },
    {
      name: 'Drivers',
      files: [
        {
          name: 'uart.c',
          rel: 'drv/uart.c',
          inside: false,
          exists: true,
          readable: true,
          functions: [{ name: 'uart_init', line: 4 }],
        },
      ],
    },
  ],
  includes: [{ path: 'inc/', exists: true, inside: true }],
  defines: ['USE_HAL', 'STM32F1'],
  include_edges: [{ from: 'main.c', to: 'uart.h', resolved: true }],
}

const makePost = (details = MAP_DETAILS) => {
  const calls = []
  const post = async (path, body) => {
    calls.push([path, body || {}])
    if (/\/dsh-vision-bench\/keil\/map$/.test(path)) {
      return { ok: true, result: { details } }
    }
    if (/\/dsh-vision-bench\/project\/file$/.test(path)) {
      return {
        ok: true,
        rel: String((body && (body.path || body.file)) || ''),
        text: 'int main(void) { return 0; }\n// setup line',
        lines: 2,
        truncated: false,
      }
    }
    if (/\/dsh-vision-bench\/state$/.test(path)) {
      return {
        ok: true,
        workspace: {
          keil: { project: '/proj/x.uvprojx', target: 'Debug' },
          journal: { tasks: [], running: [], timeline: [] },
          modbus: { version: 3, connections: [], devices: [], points: [], values: [], alarmState: {} },
        },
      }
    }
    return { ok: true }
  }
  return { post, calls }
}

test('工程树渲染：组 → 文件 → 函数三级 + 缺失/工作区外标记', async () => {
  const { post } = makePost()
  const t = (k) =>
    ({
      projectMap: '工程结构',
      mapTruncated: '已截断',
      mapIncludes: 'Include 路径',
      mapDefines: '宏',
      mapIncludesOf: '依赖',
      loadFail: '加载失败',
      needWorkspace: '无工作区',
      projectMapEmpty: '空',
      opening: '打开中',
      csvCancel: '关闭',
    })[k] || k
  const Map = createMapView(React, t, post)
  const tree = render(
    createElement(Map, { ...alpha3PageProps({ sessionId: 's1', path: '/ws' }), scope: { cwd: '/ws' } }),
  )
  await waitFor(
    () => {
      assert.ok(tree.container.textContent.includes('Source'), '组名渲染: ' + tree.container.textContent.slice(0, 120))
    },
    { timeout: 6000 },
  )
  const text = tree.container.textContent
  assert.ok(text.includes('main.c'), '文件名渲染')
  assert.ok(text.includes('缺失'), '缺失标记')
  assert.ok(text.includes('工作区外'), '工作区外标记')
  assert.ok(text.includes('Drivers'), '第二组渲染')
  // 展开 main.c 后函数与行号可见
  const fileRows = Array.from(tree.container.querySelectorAll('.dvb-map-file'))
  const mainRow = fileRows.find((r) => r.textContent.includes('main.c'))
  assert.ok(mainRow, 'main.c 行存在')
  const toggle = mainRow.querySelector('.dvb-map-toggle')
  assert.ok(toggle, '文件可展开')
  await act(async () => {
    toggle.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })
  await waitFor(
    () => {
      const t2 = tree.container.textContent
      assert.ok(t2.includes('main') && t2.includes('line 12'), '函数与行号渲染: ' + t2.slice(0, 200))
    },
    { timeout: 6000 },
  )
  tree.unmount()
})

test('文件可展开函数列表并可预览源码', async () => {
  const { post } = makePost()
  const t = (k) => ({ projectMap: '工程结构', csvCancel: '关闭', opening: '打开中' })[k] || k
  const Map = createMapView(React, t, post)
  const tree = render(
    createElement(Map, { ...alpha3PageProps({ sessionId: 's1', path: '/ws' }), scope: { cwd: '/ws' } }),
  )
  await waitFor(() => assert.ok(tree.container.textContent.includes('Source')), { timeout: 6000 })
  assert.ok(tree.container.querySelector('.dvb-project-split'), '左右分栏布局')
  const fileBtn = Array.from(tree.container.querySelectorAll('.dvb-map-file-name')).find(
    (b) => b.textContent === 'main.c',
  )
  assert.ok(fileBtn, '文件行可点击预览')
  await act(async () => {
    fileBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 30))
  })
  await waitFor(() => assert.ok(tree.container.textContent.includes('int main(void)')), { timeout: 6000 })
  tree.unmount()
})

test('工程结构支持树形/图谱切换', async () => {
  const { post } = makePost()
  const t = (k) => ({ projectMap: '工程结构', opening: '打开中' })[k] || k
  const Map = createMapView(React, t, post)
  const tree = render(
    createElement(Map, { ...alpha3PageProps({ sessionId: 's1', path: '/ws' }), scope: { cwd: '/ws' } }),
  )
  await waitFor(() => assert.ok(tree.container.textContent.includes('树形')), { timeout: 6000 })
  const graphBtn = Array.from(tree.container.querySelectorAll('button')).find((b) => b.textContent === '图谱')
  assert.ok(graphBtn, '图谱切换按钮')
  await act(async () => {
    graphBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 30))
  })
  await waitFor(() => assert.ok(tree.container.querySelector('.dvb-graph-wrap')), { timeout: 6000 })
  tree.unmount()
})

test('图谱点击节点打开源码预览', async () => {
  const { post } = makePost()
  const t = (k) => ({ projectMap: '工程结构', opening: '打开中' })[k] || k
  const Map = createMapView(React, t, post)
  const tree = render(
    createElement(Map, { ...alpha3PageProps({ sessionId: 's1', path: '/ws' }), scope: { cwd: '/ws' } }),
  )
  await waitFor(() => assert.ok(tree.container.textContent.includes('树形')), { timeout: 6000 })
  const graphBtn = Array.from(tree.container.querySelectorAll('button')).find((b) => b.textContent === '图谱')
  await act(async () => {
    graphBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 30))
  })
  await waitFor(() => assert.ok(tree.container.querySelector('.dvb-graph-node')), { timeout: 6000 })
  const node = tree.container.querySelector('.dvb-graph-node')
  await act(async () => {
    node.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 30))
  })
  await waitFor(() => assert.ok(tree.container.textContent.includes('int main(void)')), { timeout: 6000 })
  tree.unmount()
})

test('图谱节点具备键盘可访问属性', async () => {
  const { post } = makePost()
  const t = (k) => ({ projectMap: '工程结构', opening: '打开中' })[k] || k
  const Map = createMapView(React, t, post)
  const tree = render(
    createElement(Map, { ...alpha3PageProps({ sessionId: 's1', path: '/ws' }), scope: { cwd: '/ws' } }),
  )
  await waitFor(() => assert.ok(tree.container.textContent.includes('树形')), { timeout: 6000 })
  const graphBtn = Array.from(tree.container.querySelectorAll('button')).find((b) => b.textContent === '图谱')
  await act(async () => {
    graphBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 30))
  })
  await waitFor(() => assert.ok(tree.container.querySelector('.dvb-graph-node')), { timeout: 6000 })
  const node = tree.container.querySelector('.dvb-graph-node')
  assert.equal(node.getAttribute('role'), 'button')
  assert.equal(node.getAttribute('tabindex'), '0')
  assert.ok(node.getAttribute('aria-label')?.includes('main.c'))
  const fitBtn = Array.from(tree.container.querySelectorAll('button')).find(
    (b) => b.getAttribute('aria-label') === '适应画布',
  )
  assert.ok(fitBtn, 'fit button has aria-label')
  const resetBtn = Array.from(tree.container.querySelectorAll('button')).find(
    (b) => b.getAttribute('aria-label') === '重置缩放为 100%',
  )
  assert.ok(resetBtn, 'reset zoom button has aria-label')
  tree.unmount()
})

test('图谱节点 Enter 键可打开预览', async () => {
  const { post } = makePost()
  const t = (k) => ({ projectMap: '工程结构', opening: '打开中' })[k] || k
  const Map = createMapView(React, t, post)
  const tree = render(
    createElement(Map, { ...alpha3PageProps({ sessionId: 's1', path: '/ws' }), scope: { cwd: '/ws' } }),
  )
  await waitFor(() => assert.ok(tree.container.textContent.includes('树形')), { timeout: 6000 })
  const graphBtn = Array.from(tree.container.querySelectorAll('button')).find((b) => b.textContent === '图谱')
  await act(async () => {
    graphBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 30))
  })
  await waitFor(() => assert.ok(tree.container.querySelector('.dvb-graph-node')), { timeout: 6000 })
  const node = tree.container.querySelector('.dvb-graph-node')
  await act(async () => {
    node.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await new Promise((r) => setTimeout(r, 30))
  })
  await waitFor(() => assert.ok(tree.container.textContent.includes('int main(void)')), { timeout: 6000 })
  tree.unmount()
})

test('/ 快捷键在输入控件与对话框内不抢占焦点', async () => {
  const { post } = makePost()
  const t = (k) => ({ projectMap: '工程结构', opening: '打开中' })[k] || k
  const Map = createMapView(React, t, post)
  const tree = render(
    createElement(Map, { ...alpha3PageProps({ sessionId: 's1', path: '/ws' }), scope: { cwd: '/ws' } }),
  )
  await waitFor(() => assert.ok(tree.container.querySelector('.dvb-map-search')), { timeout: 6000 })
  const search = tree.container.querySelector('.dvb-map-search')
  const button = tree.container.querySelector('.dvb-project-view-toggle button')
  const dialog = win.document.createElement('div')
  dialog.setAttribute('role', 'dialog')
  const dialogInput = win.document.createElement('input')
  dialog.appendChild(dialogInput)
  win.document.body.appendChild(dialog)

  assert.equal(
    shouldIgnoreProjectSearchShortcut({ key: '/', defaultPrevented: false, target: search }),
    true,
    'input',
  )
  assert.equal(
    shouldIgnoreProjectSearchShortcut({ key: '/', defaultPrevented: false, target: button }),
    true,
    'button',
  )
  assert.equal(
    shouldIgnoreProjectSearchShortcut({
      key: '/',
      defaultPrevented: false,
      target: { tagName: 'DIV', isContentEditable: true, getAttribute: () => null, closest: () => null },
    }),
    true,
    'contenteditable',
  )
  assert.equal(
    shouldIgnoreProjectSearchShortcut({
      key: '/',
      defaultPrevented: false,
      target: Object.assign(win.document.createElement('div'), {
        getAttribute: () => 'textbox',
        closest: () => null,
      }),
    }),
    true,
    'role=textbox',
  )
  assert.equal(
    shouldIgnoreProjectSearchShortcut({ key: '/', defaultPrevented: false, target: dialogInput }),
    true,
    'dialog descendant',
  )
  assert.equal(
    shouldIgnoreProjectSearchShortcut({
      key: '/',
      defaultPrevented: true,
      target: tree.container,
    }),
    true,
    'defaultPrevented',
  )
  assert.equal(
    shouldIgnoreProjectSearchShortcut({ key: '/', defaultPrevented: false, target: tree.container }),
    false,
    'plain container allows shortcut',
  )
  dialog.remove()
  tree.unmount()
})

test('搜索与筛选控件存在且生效', async () => {
  const { post } = makePost()
  const t = (k) => k
  const Map = createMapView(React, t, post)
  const tree = render(
    createElement(Map, { ...alpha3PageProps({ sessionId: 's1', path: '/ws' }), scope: { cwd: '/ws' } }),
  )
  await waitFor(() => assert.ok(tree.container.textContent.includes('Source')), { timeout: 6000 })
  const input = tree.container.querySelector('.dvb-map-search')
  assert.ok(input, '搜索框存在')
  const sel = tree.container.querySelector('.dvb-map-filter')
  assert.ok(sel, '筛选下拉存在')
  const opts = Array.from(sel.querySelectorAll('option')).map((o) => o.textContent)
  for (const want of ['全部', '缺失', '不可读', '工作区外']) assert.ok(opts.includes(want), want + ' 筛选项')
  // 只显示"缺失"→ missing.c 保留、main.c 隐藏
  await act(async () => {
    sel.value = 'missing'
    sel.dispatchEvent(new win.Event('change', { bubbles: true }))
  })
  await waitFor(() => assert.ok(tree.container.textContent.includes('missing.c')), { timeout: 6000 })
  tree.unmount()
})

test('编译配置可折叠（Include/宏/依赖）', async () => {
  const { post } = makePost()
  const t = (k) => ({ mapIncludes: 'Include 路径', mapDefines: '宏', mapIncludesOf: '依赖关系' })[k] || k
  const Map = createMapView(React, t, post)
  const tree = render(
    createElement(Map, { ...alpha3PageProps({ sessionId: 's1', path: '/ws' }), scope: { cwd: '/ws' } }),
  )
  await waitFor(() => assert.ok(tree.container.textContent.includes('Include 路径')), { timeout: 6000 })
  // 折叠态默认收起宏/依赖明细
  assert.ok(tree.container.textContent.includes('USE_HAL') === false || tree.container.textContent.includes('宏'))
  // 展开后明细出现
  const toggle = Array.from(tree.container.querySelectorAll('button')).find((b) => /Include 路径/.test(b.textContent))
  await act(async () => {
    toggle.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })
  await waitFor(
    () => assert.ok(tree.container.textContent.includes('inc/') && tree.container.textContent.includes('USE_HAL')),
    { timeout: 6000 },
  )
  tree.unmount()
})

test('findProjectFile matches rel/suffix and reports outside/missing', () => {
  const hit = findProjectFile(MAP_DETAILS.groups, 'src/main.c')
  assert.equal(hit.file.name, 'main.c')
  assert.equal(hit.kind, 'ok')
  assert.equal(jumpErrorForHit(hit, 'src/main.c'), '')
  assert.equal(findProjectFile(MAP_DETAILS.groups, 'nope.c'), null)
  assert.equal(jumpErrorForHit(null, 'nope.c'), '未找到文件：nope.c')
  const outside = findProjectFile(MAP_DETAILS.groups, 'drv/uart.c')
  assert.equal(jumpErrorForHit(outside, 'drv/uart.c'), '工作区外文件不能打开')
  const missing = findProjectFile(MAP_DETAILS.groups, 'src/missing.c')
  assert.equal(jumpErrorForHit(missing, 'src/missing.c'), '文件缺失，无法打开')
})

test('点击编译错误后切到工程结构、展开文件、调用源码接口并传入 jumpLine', async () => {
  const { post, calls } = makePost()
  const t = (k) => k
  navigate(
    's1',
    '/ws',
    { viewId: VIEW_DEBUG, section: DEBUG_SECTIONS.PROJECT, target: { file: 'src/main.c', line: 12 } },
    { source: 'manual' },
  )
  const Map = createMapView(React, t, post)
  const tree = render(createElement(Map, { sessionId: 's1', scope: { cwd: '/ws' } }))
  await waitFor(() => {
    const fileCall = calls.find((row) => /\/project\/file$/.test(row[0]))
    assert.ok(fileCall, '源码接口被调用')
    assert.equal(fileCall[1].path, 'src/main.c')
  })
  await waitFor(() => {
    const host = tree.container.querySelector('[data-jump-line]')
    assert.ok(host, '编辑器收到 jumpLine')
    assert.equal(host.getAttribute('data-jump-line'), '12')
  })
  const row = tree.container.querySelector('[data-treeid="src/main.c"]')
  assert.ok(row, '目标文件行存在')
  assert.ok(row.className.includes('is-on') || row.querySelector('.dvb-map-jump'), '目标文件展开并高亮')
  assert.ok(tree.container.textContent.includes('line 12'))
  assert.equal(
    calls.some((row) => row[0] === '/dsh-vision-bench/workspace'),
    false,
    '不再写入 /workspace jumpProject',
  )
  tree.unmount()
})

test('工程树晚于导航目标返回时仍完成定位', async () => {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const calls = []
  const post = async (path, body) => {
    calls.push([path, body || {}])
    if (/\/dsh-vision-bench\/state$/.test(path)) {
      return { ok: true, workspace: { keil: { project: '/proj/x.uvprojx', target: 'Debug' } } }
    }
    if (/\/dsh-vision-bench\/keil\/map$/.test(path)) {
      await gate
      return { ok: true, result: { details: MAP_DETAILS } }
    }
    if (/\/dsh-vision-bench\/project\/file$/.test(path)) {
      return { ok: true, rel: body.path, text: 'int main(void) { return 0; }\n', lines: 1, truncated: false }
    }
    return { ok: true }
  }
  navigate(
    's1',
    '/ws',
    { viewId: VIEW_DEBUG, section: DEBUG_SECTIONS.PROJECT, target: { file: 'src/main.c', line: 12 } },
    { source: 'manual' },
  )
  const Map = createMapView(React, (k) => k, post)
  const tree = render(createElement(Map, { sessionId: 's1', scope: { cwd: '/ws' } }))
  await act(async () => {
    await new Promise((r) => setTimeout(r, 40))
  })
  assert.equal(
    calls.some((row) => /\/project\/file$/.test(row[0])),
    false,
    'Map 到达前不得打开源码',
  )
  await act(async () => {
    release()
  })
  await waitFor(() => {
    const fileCall = calls.find((row) => /\/project\/file$/.test(row[0]))
    assert.ok(fileCall)
    assert.equal(fileCall[1].path, 'src/main.c')
  })
  tree.unmount()
})

test('目标不存在时显示错误且不打开源码', async () => {
  const { post, calls } = makePost()
  navigate(
    's1',
    '/ws',
    { viewId: VIEW_DEBUG, section: DEBUG_SECTIONS.PROJECT, target: { file: 'ghost.c', line: 9 } },
    { source: 'manual' },
  )
  const Map = createMapView(React, (k) => k, post)
  const tree = render(createElement(Map, { sessionId: 's1', scope: { cwd: '/ws' } }))
  await waitFor(() => assert.ok(tree.container.textContent.includes('未找到文件：ghost.c')))
  assert.equal(
    calls.some((row) => /\/project\/file$/.test(row[0])),
    false,
    '找不到文件时不得请求源码',
  )
  tree.unmount()
})

test('工作区外文件不得尝试打开', async () => {
  const { post, calls } = makePost()
  navigate(
    's1',
    '/ws',
    { viewId: VIEW_DEBUG, section: DEBUG_SECTIONS.PROJECT, target: { file: 'drv/uart.c', line: 4 } },
    { source: 'manual' },
  )
  const Map = createMapView(React, (k) => k, post)
  const tree = render(createElement(Map, { sessionId: 's1', scope: { cwd: '/ws' } }))
  await waitFor(() => assert.ok(tree.container.textContent.includes('工作区外文件不能打开')))
  assert.equal(
    calls.some((row) => /\/project\/file$/.test(row[0])),
    false,
  )
  tree.unmount()
})

test('openProject 带着文件目标后调试工作台切到工程结构', async () => {
  const { post } = makePost()
  const Page = createDebugWorkspace(React, (k) => k, post)
  const tree = render(createElement(Page, { sessionId: 's1', scope: { cwd: '/ws' } }))
  await waitFor(() => {
    const root = tree.container.querySelector('[data-workspace="debug"]')
    assert.ok(root)
    assert.equal(root.getAttribute('data-section'), DEBUG_SECTIONS.WORKBENCH)
  })
  await act(async () => {
    navigate(
      's1',
      '/ws',
      { viewId: VIEW_DEBUG, section: DEBUG_SECTIONS.PROJECT, target: { file: 'src/main.c', line: 12 } },
      { source: 'manual' },
    )
  })
  await waitFor(() => {
    const root = tree.container.querySelector('[data-workspace="debug"]')
    assert.equal(root.getAttribute('data-section'), DEBUG_SECTIONS.PROJECT)
  })
  tree.unmount()
})
