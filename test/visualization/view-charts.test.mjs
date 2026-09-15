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

test('Task10/0.20.1: 柱状图柱长按比例 + 正负方向 + null 显示 —', async () => {
  const mb = JSON.parse(JSON.stringify(MB))
  mb.points.push({
    id: 'p4',
    connectionId: 'c1',
    deviceId: 'd1',
    name: '负值',
    function: 3,
    address: 3,
    monitorEnabled: true,
  })
  mb.points.push({
    id: 'p5',
    connectionId: 'c1',
    deviceId: 'd1',
    name: '坏值',
    function: 3,
    address: 4,
    monitorEnabled: true,
  })
  mb.values = [
    { key: 'p1', pointId: 'p1', value: 10, ok: true, at: Date.now() },
    { key: 'p2', pointId: 'p2', value: 50, ok: true, at: Date.now() },
    { key: 'p4', pointId: 'p4', value: -100, ok: true, at: Date.now() },
    { key: 'p5', pointId: 'p5', value: null, ok: false, error: '超时', at: Date.now() },
  ]
  mb.visualization = {
    schemaVersion: 1,
    components: [{ id: 'viz_bar', name: '柱', type: 'bar', pointIds: ['p1', 'p2', 'p4', 'p5'] }],
  }
  const { post } = makePost(mb)
  const Viz = createVisualizationPage(React, t, post, {})
  const tree = render(
    createElement(Viz, { ...alpha3PageProps({ sessionId: 's1', path: '/ws' }), scope: { cwd: '/ws' } }),
  )
  await waitFor(() => assert.ok(tree.container.textContent.includes('柱')), { timeout: 6000 })
  const fills = Array.from(tree.container.querySelectorAll('.dvb-viz-bar-fill'))
  assert.equal(fills.length, 3, '三个有效值柱')
  const widths = fills.map((f) => parseFloat(f.style.width))
  // 零基线居中：最大绝对值占半轨 50%
  assert.ok(Math.abs(Math.max(...widths) - 50) < 0.5, '最大绝对值(100) → 半轨 50%')
  assert.ok(widths[0] < widths[1], '10 < 50')
  const neg = fills.find((f) => f.getAttribute('data-sign') === 'neg')
  const pos = fills.find((f) => f.getAttribute('data-sign') === 'pos')
  assert.ok(neg && neg.className.includes('dvb-viz-bar-neg'), '负值方向 class')
  assert.ok(pos && pos.className.includes('dvb-viz-bar-pos'), '正值方向 class')
  assert.ok(tree.container.querySelector('.dvb-viz-bar-zero-line'), '零基线')
  // null 显示 —
  const missing = tree.container.querySelector('.dvb-viz-bar-missing')
  assert.ok(missing && missing.textContent === '—', '通信失败显示 —')
  assert.ok(tree.container.textContent.includes('10') && tree.container.textContent.includes('50'), '保留真实数值')
  tree.unmount()
})

test('Task10b/0.20.1: 柱状图小数比例不强制 maxAbs=1', async () => {
  const mb = JSON.parse(JSON.stringify(MB))
  mb.values = [
    { key: 'p1', pointId: 'p1', value: 0.2, ok: true, at: Date.now() },
    { key: 'p2', pointId: 'p2', value: 0.5, ok: true, at: Date.now() },
  ]
  mb.visualization = {
    schemaVersion: 1,
    components: [{ id: 'viz_bar_f', name: '小数柱', type: 'bar', pointIds: ['p1', 'p2'] }],
  }
  const { post } = makePost(mb)
  const Viz = createVisualizationPage(React, t, post, {})
  const tree = render(
    createElement(Viz, { ...alpha3PageProps({ sessionId: 's1', path: '/ws' }), scope: { cwd: '/ws' } }),
  )
  await waitFor(() => assert.ok(tree.container.textContent.includes('小数柱')), { timeout: 6000 })
  const fills = Array.from(tree.container.querySelectorAll('.dvb-viz-bar-fill'))
  assert.equal(fills.length, 2)
  const widths = fills.map((f) => parseFloat(f.style.width))
  assert.ok(Math.abs(Math.max(...widths) - 50) < 0.5, '0.5 → 半轨 50%')
  assert.ok(Math.abs(widths.find((w) => w < 50) - 20) < 0.5, '0.2 → 20%')
  tree.unmount()
})

test('Task1/0.20.1: 无图表运行时 → 曲线卡片显示渲染失败 + 重试/编辑入口（不静默吞掉）', async () => {
  const mb = JSON.parse(JSON.stringify(MB))
  mb.visualization = { schemaVersion: 1, components: [{ id: 'viz_line', name: '线', type: 'line', pointIds: ['p1'] }] }
  const { post } = makePost(mb)
  const Viz = createVisualizationPage(React, t, post, {})
  const tree = render(
    createElement(Viz, { ...alpha3PageProps({ sessionId: 's1', path: '/ws' }), scope: { cwd: '/ws' } }),
  )
  await waitFor(() => assert.ok(tree.container.textContent.includes('图表运行时不可用')), { timeout: 8000 })
  const btns = Array.from(tree.container.querySelectorAll('button')).map((b) => b.textContent)
  assert.ok(btns.includes('重试'), '重试入口')
  assert.ok(btns.includes('编辑'), '编辑入口')
  tree.unmount()
})
