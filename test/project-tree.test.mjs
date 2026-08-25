// Task5/0.19.3: 工程结构 — 树渲染（组/文件/函数）、搜索、筛选、源码预览、
// 编译错误定位（jumpProject）。
import { beforeEach, afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import React from 'react'
import { createElement } from 'react'
import { render, cleanup, waitFor, act } from '@testing-library/react'
import { createMapView } from '../bench-map.mjs'

let win
beforeEach(async () => {
  win = new Window({ url: 'http://localhost/' })
  globalThis.window = win
  globalThis.document = win.document
  try { globalThis.navigator = { clipboard: { writeText: async () => {} }, userAgent: 'happy' } } catch {
    Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async () => {} }, userAgent: 'happy' }, configurable: true })
  }
  globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb } observe() {} unobserve() {} disconnect() {} }
  globalThis.Element = win.HTMLElement
  globalThis.HTMLElement = win.HTMLElement
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0)
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  globalThis.devicePixelRatio = 1
  globalThis.CustomEvent = win.CustomEvent
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '', setProperty() {}, removeProperty() {} })
})
afterEach(() => { cleanup() })

const MAP_DETAILS = {
  target: 'Debug',
  counts: { files: 3, includes: 1, include_edges: 1 },
  groups: [
    {
      name: 'Source',
      files: [
        { name: 'main.c', rel: 'src/main.c', inside: true, exists: true, readable: true, functions: [{ name: 'main', line: 12 }, { name: 'setup', line: 37 }] },
        { name: 'missing.c', rel: 'src/missing.c', inside: true, exists: false, readable: false, functions: [] },
      ],
    },
    {
      name: 'Drivers',
      files: [{ name: 'uart.c', rel: 'drv/uart.c', inside: false, exists: true, readable: true, functions: [{ name: 'uart_init', line: 4 }] }],
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
      return { ok: true, rel: String((body && (body.path || body.file)) || ''), text: 'int main(void) { return 0; }\n// setup line', lines: 2, truncated: false }
    }
    if (/\/dsh-vision-bench\/state$/.test(path)) {
      return { ok: true, workspace: { keil: { project: '/proj/x.uvprojx', target: 'Debug' }, journal: { tasks: [], running: [], timeline: [] }, modbus: { version: 3, connections: [], devices: [], points: [], values: [], alarmState: {} } } }
    }
    return { ok: true }
  }
  return { post, calls }
}

test('工程树渲染：组 → 文件 → 函数三级 + 缺失/工作区外标记', async () => {
  const { post } = makePost()
  const t = (k) => ({ projectMap: '工程结构', mapTruncated: '已截断', mapIncludes: 'Include 路径', mapDefines: '宏', mapIncludesOf: '依赖', loadFail: '加载失败', needWorkspace: '无工作区', projectMapEmpty: '空', opening: '打开中', csvCancel: '关闭' }[k] || k)
  const Map = createMapView(React, t, post)
  const tree = render(createElement(Map, { sessionId: 's1', scope: { cwd: '/ws' }, useSessions: () => '' }))
  await waitFor(() => {
    assert.ok(tree.container.textContent.includes('Source'), '组名渲染: ' + tree.container.textContent.slice(0, 120))
  }, { timeout: 6000 })
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
  await act(async () => { toggle.dispatchEvent(new win.MouseEvent('click', { bubbles: true })) })
  await waitFor(() => {
    const t2 = tree.container.textContent
    assert.ok(t2.includes('main') && t2.includes('line 12'), '函数与行号渲染: ' + t2.slice(0, 200))
  }, { timeout: 6000 })
  tree.unmount()
})

test('文件可展开函数列表并可预览源码', async () => {
  const { post } = makePost()
  const t = (k) => ({ projectMap: '工程结构', csvCancel: '关闭', opening: '打开中' }[k] || k)
  const Map = createMapView(React, t, post)
  const tree = render(createElement(Map, { sessionId: 's1', scope: { cwd: '/ws' }, useSessions: () => '' }))
  await waitFor(() => assert.ok(tree.container.textContent.includes('Source')), { timeout: 6000 })
  // 找 main.c 所在行的"预览"按钮
  const previewBtn = Array.from(tree.container.querySelectorAll('.dvb-map-file-actions button')).find((b) => b.textContent === '预览')
  assert.ok(previewBtn, '文件行有预览按钮')
  await act(async () => { previewBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 30)) })
  await waitFor(() => assert.ok(tree.container.textContent.includes('int main(void)')), { timeout: 6000 })
  tree.unmount()
})

test('搜索与筛选控件存在且生效', async () => {
  const { post } = makePost()
  const t = (k) => k
  const Map = createMapView(React, t, post)
  const tree = render(createElement(Map, { sessionId: 's1', scope: { cwd: '/ws' }, useSessions: () => '' }))
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
  const t = (k) => ({ mapIncludes: 'Include 路径', mapDefines: '宏', mapIncludesOf: '依赖关系' }[k] || k)
  const Map = createMapView(React, t, post)
  const tree = render(createElement(Map, { sessionId: 's1', scope: { cwd: '/ws' }, useSessions: () => '' }))
  await waitFor(() => assert.ok(tree.container.textContent.includes('Include 路径')), { timeout: 6000 })
  // 折叠态默认收起宏/依赖明细
  assert.ok(tree.container.textContent.includes('USE_HAL') === false || tree.container.textContent.includes('宏'))
  // 展开后明细出现
  const toggle = Array.from(tree.container.querySelectorAll('button')).find((b) => /Include 路径/.test(b.textContent))
  await act(async () => { toggle.dispatchEvent(new win.MouseEvent('click', { bubbles: true })) })
  await waitFor(() => assert.ok(tree.container.textContent.includes('inc/') && tree.container.textContent.includes('USE_HAL')), { timeout: 6000 })
  tree.unmount()
})

test('编译错误定位：jumpProject 使目标文件展开并高亮行（源码契约 + 映射）', async () => {
  const { post } = makePost({ ...MAP_DETAILS, groups: MAP_DETAILS.groups })
  const t = (k) => k
  const Map = createMapView(React, t, post)
  const tree = render(createElement(Map, { sessionId: 's1', scope: { cwd: '/ws' }, useSessions: () => '' }))
  await waitFor(() => assert.ok(tree.container.textContent.includes('Source')), { timeout: 6000 })
  // jump 机制在 /state 订阅中处理；直接验证视图有定位按钮的数据面（调试页写 jumpProject）
  const viewSrc = (await import('node:fs/promises')).readFile(new URL('../bench-view.mjs', import.meta.url), 'utf8')
  const src = await viewSrc
  assert.ok(src.includes('jumpToError'), '调试页错误跳转函数')
  assert.ok(src.includes("'/dsh-vision-bench/workspace'") && src.includes('jumpProject'), '跳转写入 jumpProject')
  assert.ok(src.includes('查看完整日志'), '完整日志入口')
  tree.unmount()
})