import assert from 'node:assert/strict'
import { test } from 'node:test'
import { act, render, waitFor } from '@testing-library/react'
import React from 'react'
import { createElement } from 'react'
import { createVisualizationPage } from '../../bench-visualization-view.mjs'
import { alpha3PageProps } from '../fixtures/harness-alpha3-props.mjs'
import { MB, makePost, t } from '../helpers/visualization-view-fixtures.mjs'
import { pageWindow as win, useReactPageRuntime } from '../helpers/react-runtime.mjs'

useReactPageRuntime({ profile: 'page' })

test('未来 schema 进入只读模式：可查看、不可改、不发写请求', async () => {
  const mb = JSON.parse(JSON.stringify(MB))
  mb.points = mb.points.map((pt) => (pt.id === 'p2' ? { ...pt, function: 1 } : pt))
  mb.visualization = {
    schemaVersion: 9,
    minimumPluginVersion: '9.0.0',
    unsupported: true,
    errorCode: 'VIZ_SCHEMA_UNSUPPORTED',
    error: '需要插件 9.0.0 或更高，当前只读',
    columns: 12,
    components: [
      {
        id: 'viz_future',
        name: '未来版本组件',
        type: 'value',
        pointIds: ['p1'],
        layout: { x: 0, y: 0, w: 3, h: 3 },
      },
      {
        id: 'viz_sw',
        name: '未来开关',
        type: 'switch',
        pointIds: ['p2'],
        layout: { x: 3, y: 0, w: 3, h: 3 },
      },
    ],
  }
  const base = makePost(mb)
  const writes = []
  const post = async (path, body) => {
    if (/\/modbus\/write$/.test(path)) writes.push(body)
    return base.post(path, body)
  }
  const Viz = createVisualizationPage(React, t, post, {})
  const tree = render(
    createElement(Viz, { ...alpha3PageProps({ sessionId: 's1', path: '/ws' }), scope: { cwd: '/ws' } }),
  )
  await waitFor(() => assert.ok(tree.container.textContent.includes('未来版本组件')), { timeout: 6000 })
  assert.ok(tree.container.querySelector('.dvb-viz-readonly'), '只读横幅')
  assert.ok(tree.container.textContent.includes('可视化配置为只读'))
  assert.ok(
    tree.container.textContent.includes('不支持的可视化 schemaVersion 9，当前只读') ||
      tree.container.textContent.includes('需要插件 9.0.0 或更高，当前只读'),
    '显示只读原因',
  )
  assert.ok(tree.container.textContent.includes('但不能修改布局、组件配置或执行组件控制'))
  const newBtn = Array.from(tree.container.querySelectorAll('button')).find((b) => b.textContent === '新建组件')
  const editBtn = Array.from(tree.container.querySelectorAll('button')).find((b) => b.textContent === '编辑')
  const delBtn = Array.from(tree.container.querySelectorAll('button')).find((b) => b.textContent === '删除')
  assert.ok(newBtn && newBtn.disabled, '新建 disabled')
  assert.ok(editBtn && editBtn.disabled, '编辑 disabled')
  assert.ok(delBtn && delBtn.disabled, '删除 disabled')
  await act(async () => {
    editBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    newBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })
  assert.equal(tree.container.textContent.includes('编辑组件'), false, '点击 disabled 不打开编辑器')
  const agentBtn = Array.from(tree.container.querySelectorAll('button')).find((b) => b.textContent === '复制引用')
  assert.ok(agentBtn && !agentBtn.disabled, '复制引用仍可用')
  await act(async () => {
    agentBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })
  const switchBtn = tree.container.querySelector('.dvb-viz-switch-card [role=switch]')
  assert.ok(switchBtn && switchBtn.disabled, '控制开关 disabled')
  await act(async () => {
    switchBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })
  assert.equal(base.saved.length, 0, '不产生 visualization command')
  assert.equal(writes.length, 0, '不产生设备写入')
  assert.equal(base.state().visualization.schemaVersion, 9)
  tree.unmount()
})

test('画布编辑模式切换：点击「编辑画布」解锁网格，点击「完成编辑」立即提交并恢复锁定', async () => {
  const mbWithComp = {
    ...MB,
    visualization: {
      schemaVersion: 2,
      components: [
        {
          id: 'c1',
          name: '温度曲线',
          type: 'line',
          pointIds: ['p1'],
          layout: { x: 0, y: 0, w: 6, h: 4 },
        },
      ],
    },
  }
  const { post } = makePost(mbWithComp)
  const Viz = createVisualizationPage(React, t, post, {})
  const tree = render(
    createElement(Viz, { ...alpha3PageProps({ sessionId: 's1', path: '/ws' }), scope: { cwd: '/ws' } }),
  )
  await waitFor(() => assert.ok(tree.container.textContent.includes('温度曲线')), { timeout: 6000 })

  const grid = tree.container.querySelector('.dvb-viz-grid')
  assert.ok(grid, '网格存在')
  assert.equal(grid.getAttribute('data-editing'), 'false', '初始为浏览模式（锁定）')

  const editCanvasBtn = Array.from(tree.container.querySelectorAll('button')).find((b) =>
    b.textContent.includes('编辑画布'),
  )
  assert.ok(editCanvasBtn, '存在编辑画布按钮')
  assert.equal(editCanvasBtn.textContent.trim(), '编辑画布', '无铅笔图标')

  // 点击「编辑画布」
  await act(async () => {
    editCanvasBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })

  await waitFor(() => assert.equal(grid.getAttribute('data-editing'), 'true'), { timeout: 4000 })
  assert.ok(tree.container.textContent.includes('画布编辑中'), '显示编辑中标识')

  const finishBtn = Array.from(tree.container.querySelectorAll('button')).find((b) =>
    b.textContent.includes('完成编辑'),
  )
  assert.ok(finishBtn, '切换为完成编辑按钮')
  assert.equal(finishBtn.textContent.trim(), '完成编辑', '无钩图标')

  // 点击「完成编辑」
  await act(async () => {
    finishBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })

  await waitFor(() => assert.equal(grid.getAttribute('data-editing'), 'false'), { timeout: 4000 })
  assert.ok(tree.container.textContent.includes('编辑画布'), '按钮恢复为编辑画布')
  assert.equal(tree.container.textContent.includes('画布布局已保存'), false, '不显示画布布局已保存提示')

  tree.unmount()
})

test('组件编辑：页签下只保留一条分隔线（去掉首个分组标题的顶边）', async () => {
  const { VISUALIZATION_CSS } = await import('../../src/ui/styles/visualization.mjs')
  const css = VISUALIZATION_CSS.join('')
  assert.match(css, /\.dvb-viz-tabs-bar\{[^}]*border-bottom:1px solid var\(--dvb-bdr\)/)
  assert.match(css, /\.dvb-viz-group-title\{[^}]*border-top:1px solid var\(--dvb-bdr\)/)
  assert.match(css, /\.dvb-viz-group-title:first-child\{border-top:0\}/)
})

test('组件编辑弹窗锁在视口内，不把整页撑出滚动', async () => {
  const { VISUALIZATION_CSS } = await import('../../src/ui/styles/visualization.mjs')
  const css = VISUALIZATION_CSS.join('')
  assert.match(css, /\.dvb-viz-modal-mask\{[^}]*overflow:hidden/)
  assert.match(css, /\.dvb-viz-modal\{[^}]*height:calc\(100vh - 32px\)/)
  assert.match(css, /\.dvb-viz-modal\{[^}]*max-height:calc\(100vh - 32px\)/)
  assert.match(css, /\.dvb-viz-modal\{[^}]*min-height:0/)
  assert.match(css, /\.dvb-viz-drawer-body\{[^}]*overflow:auto/)
  assert.doesNotMatch(css, /dvb-viz-picker-list\)\{border:1px/)
  assert.match(css, /body:has\(\.dvb-viz-modal-mask\)\{overflow:hidden\}/)
  assert.match(css, /\.dvb-viz-drawer-body\{[^}]*overscroll-behavior:contain/)
  assert.match(
    css,
    /\.dvb-viz,\.dvb-viz-modal-mask,\.dvb-viz-modal\{--dvb-bdr:var\(--dsw-alias-border-l2,rgba\(128,128,128,\.25\)\)\}/,
    'portaled editor inherits card borders without a .dvb-viz ancestor',
  )
})
