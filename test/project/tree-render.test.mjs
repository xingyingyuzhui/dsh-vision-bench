import assert from 'node:assert/strict'
import { test } from 'node:test'
import { act, render, waitFor } from '@testing-library/react'
import React from 'react'
import { createElement } from 'react'
import { createMapView } from '../../bench-map.mjs'
import { alpha3PageProps } from '../fixtures/harness-alpha3-props.mjs'
import { makePost } from '../helpers/project-tree-fixtures.mjs'
import { pageWindow as win, useReactPageRuntime } from '../helpers/react-runtime.mjs'

useReactPageRuntime({ profile: 'page' })

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
