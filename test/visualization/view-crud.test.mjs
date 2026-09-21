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

const dialogHost = () => document.body
const dialogText = () => dialogHost().textContent || ''

test('挂载无错误；默认不展开已监视点位列表（空状态只提示新建）', async () => {
  const { post } = makePost()
  const errors = []
  const onError = (e) => errors.push(e)
  window.addEventListener('error', onError)
  const Viz = createVisualizationPage(React, t, post, {})
  const tree = render(
    createElement(Viz, { ...alpha3PageProps({ sessionId: 's1', path: '/ws' }), scope: { cwd: '/ws' } }),
  )
  await waitFor(() => assert.ok(tree.container.textContent.includes('新建组件')), { timeout: 6000 })
  const text = tree.container.textContent
  assert.ok(!text.includes('温度 /'), '未展开监视点位列表')
  assert.ok(!tree.container.querySelector('.dvb-viz-picker-list'), '空状态不展开点位选择器')
  assert.ok(text.includes('新建组件'), '空状态提供新建组件')
  assert.ok(
    text.includes('从已监视点位') || text.includes('请先在上位机'),
    '空状态有引导文案（有监视点位时提示从点位创建，否则提示先开监视）',
  )
  tree.unmount()
  await new Promise((r) => setTimeout(r, 60))
  assert.equal(errors.length, 0, 'mount/unmount 无错误: ' + JSON.stringify(errors.map((e) => e.message)))
  window.removeEventListener('error', onError)
})

test('新建组件：编辑器勾选监视点位（限定路径）→ 保存后立即渲染', async () => {
  const { post, saved, state } = makePost()
  const Viz = createVisualizationPage(React, t, post, {})
  const tree = render(
    createElement(Viz, { ...alpha3PageProps({ sessionId: 's1', path: '/ws' }), scope: { cwd: '/ws' } }),
  )
  await waitFor(() => assert.ok(tree.container.textContent.includes('新建组件')), { timeout: 6000 })
  // 点击 新建组件
  const newBtn = Array.from(tree.container.querySelectorAll('button')).find((b) => b.textContent.includes('新建组件'))
  await act(async () => {
    newBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })
  await waitFor(() => assert.ok(dialogText().includes('组件名称')), { timeout: 6000 })
  // 只列出监视点位（p1/p2），p3 不出现；路径包含 连接/设备/点位
  const picker = dialogHost().querySelector('.dvb-viz-picker-list')
  assert.ok(picker, '点位选择器存在')
  const pickerText = picker.textContent
  assert.ok(pickerText.includes('温度') && pickerText.includes('压力'), '只列监视点位')
  assert.ok(!pickerText.includes('未监视'), '非监视点位不出现')
  assert.ok(
    pickerText.includes('C1') && pickerText.includes('设备1') && pickerText.includes('温度'),
    '限定路径 连接/设备/点位',
  )
  // 勾选 p1（checkbox click 触发 React onChange）
  const p1box = Array.from(picker.querySelectorAll('label'))
    .find((l) => l.textContent.includes('温度'))
    .querySelector('input')
  await act(async () => {
    p1box.checked = true
    p1box.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })
  await waitFor(() => assert.ok(dialogText().includes('已选 1 个点位')), { timeout: 6000 })
  // 保存
  const saveBtn = Array.from(dialogHost().querySelectorAll('button')).find(
    (b) => b.textContent === '创建组件' || b.textContent === '保存修改' || b.textContent === '保存',
  )
  assert.ok(saveBtn, '保存/创建按钮存在')
  await act(async () => {
    saveBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 60))
  })
  assert.ok(saved.length >= 1, '保存提交 visualization')
  const viz = state().visualization
  assert.equal(viz.components.length, 1)
  assert.equal(viz.components[0].type, 'line')
  assert.deepEqual(viz.components[0].pointIds, ['p1'])
  await waitFor(
    () => {
      const card = Array.from(tree.container.querySelectorAll('.dvb-viz-card')).find((c) =>
        c.textContent.includes('组件1'),
      )
      assert.ok(card, '保存后组件卡片立即渲染')
    },
    { timeout: 6000 },
  )
  tree.unmount()
})

test('编辑图标恢复组件草稿；类型与关联点位回显', async () => {
  const mb = JSON.parse(JSON.stringify(MB))
  mb.visualization = {
    schemaVersion: 1,
    components: [{ id: 'viz_x', name: '我的数值卡', type: 'value', pointIds: ['p1'] }],
  }
  const { post } = makePost(mb)
  const Viz = createVisualizationPage(React, t, post, {})
  const tree = render(
    createElement(Viz, { ...alpha3PageProps({ sessionId: 's1', path: '/ws' }), scope: { cwd: '/ws' } }),
  )
  await waitFor(() => assert.ok(tree.container.textContent.includes('我的数值卡')), { timeout: 6000 })
  const editBtn = Array.from(tree.container.querySelectorAll('button')).find((b) => b.textContent === '编辑')
  assert.ok(editBtn)
  await act(async () => {
    editBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })
  await waitFor(() => assert.ok(dialogHost().querySelector('.dvb-viz-modal-mask')), { timeout: 6000 })
  assert.ok(dialogText().includes('编辑组件'), '编辑弹窗标题')
  const nameInput = Array.from(dialogHost().querySelectorAll('input')).find((i) => i.value === '我的数值卡')
  assert.ok(nameInput, '组件名称回显')
  const typeSel = Array.from(dialogHost().querySelectorAll('select')).find((s) => s.value === 'value')
  assert.ok(typeSel, '组件类型回显 value')
  assert.ok(dialogText().includes('显示'), '数值卡配置含显示页签')
  assert.ok(dialogText().includes('实时预览'), '数值卡配置含预览')
  tree.unmount()
})

test('degraded 组件显示修复入口；关闭监视/删除点位不删除组件', async () => {
  const mb = JSON.parse(JSON.stringify(MB))
  mb.points = mb.points.filter((p) => p.id !== 'p1') // 删除 p1
  mb.visualization = { schemaVersion: 1, components: [{ id: 'viz_y', name: '断源', type: 'line', pointIds: ['p1'] }] }
  const { post } = makePost(mb)
  const Viz = createVisualizationPage(React, t, post, {})
  const tree = render(
    createElement(Viz, { ...alpha3PageProps({ sessionId: 's1', path: '/ws' }), scope: { cwd: '/ws' } }),
  )
  await waitFor(() => assert.ok(tree.container.textContent.includes('断源')), { timeout: 6000 })
  const card = Array.from(tree.container.querySelectorAll('.dvb-viz-card')).find((c) => c.textContent.includes('断源'))
  assert.ok(card.querySelector('.dvb-viz-degraded') || card.className.includes('dvb-viz-degraded'), 'degraded 样式')
  assert.ok(card.textContent.includes('修复'), '修复入口存在')
  const fixBtn = Array.from(card.querySelectorAll('button')).find((b) => b.textContent === '修复')
  await act(async () => {
    fixBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })
  await waitFor(() => assert.ok(dialogHost().querySelector('.dvb-viz-modal-mask')), { timeout: 6000 })
  assert.ok(dialogText().includes('编辑组件'), '修复入口打开编辑弹窗')
  tree.unmount()
})

test('Task8/0.20.1: 编辑保留 ID/order/windowMs/confirmWrite 且排列不变（索引替换）', async () => {
  const mb = JSON.parse(JSON.stringify(MB))
  mb.visualization = {
    schemaVersion: 1,
    components: [
      {
        id: 'viz_x',
        name: '第一',
        type: 'line',
        pointIds: ['p1'],
        order: 2,
        settings: { windowMs: 120000, confirmWrite: false },
      },
      {
        id: 'viz_y',
        name: '第二',
        type: 'value',
        pointIds: ['p2'],
        order: 5,
        settings: { windowMs: 60000, confirmWrite: true },
      },
    ],
  }
  const base = makePost(mb)
  const saved = base.saved
  const post = async (path, body) => {
    return base.post(path, body)
  }
  const Viz = createVisualizationPage(React, t, post, {})
  const tree = render(
    createElement(Viz, { ...alpha3PageProps({ sessionId: 's1', path: '/ws' }), scope: { cwd: '/ws' } }),
  )
  await waitFor(() => assert.ok(tree.container.textContent.includes('第一')), { timeout: 6000 })
  const cards = Array.from(tree.container.querySelectorAll('.dvb-viz-card'))
  assert.equal(cards.length, 2, '两个组件')
  const editFirst = Array.from(cards[0].querySelectorAll('button')).find((b) => b.textContent === '编辑')
  await act(async () => {
    editFirst.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })
  await waitFor(() => assert.ok(dialogHost().querySelector('.dvb-viz-modal-mask')), { timeout: 6000 })
  // 保存（名称空不变更时，norm 后同值）→ 索引替换
  const saveBtn = Array.from(dialogHost().querySelectorAll('button')).find(
    (b) => b.textContent === '保存修改' || b.textContent === '创建组件' || b.textContent === '保存',
  )
  assert.ok(saveBtn, '保存修改按钮存在')
  await act(async () => {
    saveBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 60))
  })
  const commandPayload = saved.length && saved[saved.length - 1].payload
  assert.ok(commandPayload, '保存提交')
  assert.equal(commandPayload.op, 'update')
  const vizPayload = base.state().visualization
  assert.equal(vizPayload.components.length, 2, '仍两个组件')
  assert.deepEqual(
    vizPayload.components.map((c) => c.id),
    ['viz_x', 'viz_y'],
    '排列不变',
  )
  const c0 = vizPayload.components[0]
  assert.equal(c0.id, 'viz_x', 'ID 不变')
  assert.equal(c0.order, 2, 'order 不变')
  assert.deepEqual(c0.settings, { windowMs: 120000, confirmWrite: false }, 'windowMs/confirmWrite 不变')
  tree.unmount()
})
