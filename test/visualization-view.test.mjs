// TaskP2/0.20.0: 可视化侧边栏 — 组件为中心、编辑器、保存即时渲染、degraded 修复入口。
import { beforeEach, afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import React from 'react'
import { createElement } from 'react'
import { render, cleanup, waitFor, act } from '@testing-library/react'
import { createVisualizationPage } from '../bench-visualization-view.mjs'

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

const MB = {
  version: 3,
  configVersion: 9,
  connections: [{ id: 'c1', name: 'C1', conn: { mode: 'rtu', port: 'COM3', slave: 1, sim: true } }],
  devices: [{ id: 'd1', connectionId: 'c1', name: '设备1', unitId: 1 }],
  points: [
    { id: 'p1', connectionId: 'c1', deviceId: 'd1', name: '温度', function: 3, address: 0, monitorEnabled: true, alarmEnabled: true },
    { id: 'p2', connectionId: 'c1', deviceId: 'd1', name: '压力', function: 3, address: 1, monitorEnabled: true, alarmEnabled: false },
    { id: 'p3', connectionId: 'c1', deviceId: 'd1', name: '未监视', function: 3, address: 2, monitorEnabled: false, alarmEnabled: false },
  ],
  values: [
    { key: 'p1', pointId: 'p1', value: 23.5, ok: true, at: Date.now() },
  ],
  trend: { p1: [[Date.now() - 1000, 23], [Date.now(), 23.5]] },
  alarmState: {},
  visualization: { schemaVersion: 1, components: [] },
}

const makePost = (mb = JSON.parse(JSON.stringify(MB))) => {
  const saved = []
  const post = async (path, body) => {
    if (/\/state$/.test(path)) return { ok: true, workspace: { modbus: mb, focus: null }, journal: { tasks: [], running: [], timeline: [] }, health: {}, pendingWrites: [] }
    if (/\/workspace$/.test(path)) {
      saved.push(body)
      if (body.modbus && body.modbus.visualization) mb = { ...mb, visualization: body.modbus.visualization }
      return { ok: true, workspace: { modbus: mb } }
    }
    return { ok: true }
  }
  return { post, saved, state: () => mb }
}

const t = (k) => ({ liveChart: '可视化', vizNew: '新建组件', vizEdit: '编辑组件', vizName: '组件名称', vizType: '组件类型', vizSearch: '搜索', savePoint: '保存', csvCancel: '取消' }[k] || k)

test('挂载无错误；默认不展开已监视点位列表（空状态只提示新建）', async () => {
  const { post } = makePost()
  const errors = []
  const onError = (e) => errors.push(e)
  window.addEventListener('error', onError)
  const Viz = createVisualizationPage(React, t, post, {})
  const tree = render(createElement(Viz, { sessionId: 's1', scope: { cwd: '/ws' }, useSessions: () => '' }))
  await waitFor(() => assert.ok(tree.container.textContent.includes('可视化')), { timeout: 6000 })
  const text = tree.container.textContent
  assert.ok(!text.includes('温度 /'), '未展开监视点位列表')
  assert.ok(!text.includes('监视点位'), '空状态不打印点位清单文案')
  assert.ok(text.includes('新建组件'), '空状态提供新建组件')
  tree.unmount()
  await new Promise((r) => setTimeout(r, 60))
  assert.equal(errors.length, 0, 'mount/unmount 无错误: ' + JSON.stringify(errors.map((e) => e.message)))
  window.removeEventListener('error', onError)
})

test('新建组件：编辑器勾选监视点位（限定路径）→ 保存后立即渲染', async () => {
  const { post, saved, state } = makePost()
  const Viz = createVisualizationPage(React, t, post, {})
  const tree = render(createElement(Viz, { sessionId: 's1', scope: { cwd: '/ws' }, useSessions: () => '' }))
  await waitFor(() => assert.ok(tree.container.textContent.includes('新建组件')), { timeout: 6000 })
  // 点击 新建组件
  const newBtn = Array.from(tree.container.querySelectorAll('button')).find((b) => b.textContent.includes('新建组件'))
  await act(async () => { newBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true })) })
  await waitFor(() => assert.ok(tree.container.textContent.includes('组件名称')), { timeout: 6000 })
  // 只列出监视点位（p1/p2），p3 不出现；路径包含 连接/设备/点位
  const picker = tree.container.querySelector('.dvb-viz-picker-list')
  assert.ok(picker, '点位选择器存在')
  const pickerText = picker.textContent
  assert.ok(pickerText.includes('温度') && pickerText.includes('压力'), '只列监视点位')
  assert.ok(!pickerText.includes('未监视'), '非监视点位不出现')
  assert.ok(pickerText.includes('C1') && pickerText.includes('设备1') && pickerText.includes('温度'), '限定路径 连接/设备/点位')
  // 勾选 p1（checkbox click 触发 React onChange）
  const p1box = Array.from(picker.querySelectorAll('label')).find((l) => l.textContent.includes('温度')).querySelector('input')
  await act(async () => {
    p1box.checked = true
    p1box.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })
  await waitFor(() => assert.ok(tree.container.textContent.includes('已选 1 个点位')), { timeout: 6000 })
  // 保存
  const saveBtn = Array.from(tree.container.querySelectorAll('button')).find((b) => b.textContent === '保存')
  await act(async () => { saveBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 60)) })
  assert.ok(saved.length >= 1, '保存提交 visualization')
  const viz = state().visualization
  assert.equal(viz.components.length, 1)
  assert.equal(viz.components[0].type, 'line')
  assert.deepEqual(viz.components[0].pointIds, ['p1'])
  await waitFor(() => {
    const card = Array.from(tree.container.querySelectorAll('.dvb-viz-card')).find((c) => c.textContent.includes('组件1'))
    assert.ok(card, '保存后组件卡片立即渲染')
  }, { timeout: 6000 })
  tree.unmount()
})

test('编辑图标恢复组件草稿；类型与关联点位回显', async () => {
  const mb = JSON.parse(JSON.stringify(MB))
  mb.visualization = { schemaVersion: 1, components: [{ id: 'viz_x', name: '我的数值卡', type: 'value', pointIds: ['p1'] }] }
  const { post } = makePost(mb)
  const Viz = createVisualizationPage(React, t, post, {})
  const tree = render(createElement(Viz, { sessionId: 's1', scope: { cwd: '/ws' }, useSessions: () => '' }))
  await waitFor(() => assert.ok(tree.container.textContent.includes('我的数值卡')), { timeout: 6000 })
  const editBtn = Array.from(tree.container.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') || '').includes('编辑组件'))
  assert.ok(editBtn)
  await act(async () => { editBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true })) })
  await waitFor(() => assert.ok(tree.container.textContent.includes('编辑组件')), { timeout: 6000 })
  const nameInput = Array.from(tree.container.querySelectorAll('input')).find((i) => i.value === '我的数值卡')
  assert.ok(nameInput, '组件名称回显')
  const typeSel = Array.from(tree.container.querySelectorAll('select')).find((s) => s.value === 'value')
  assert.ok(typeSel, '组件类型回显 value')
  tree.unmount()
})

test('degraded 组件显示修复入口；关闭监视/删除点位不删除组件', async () => {
  const mb = JSON.parse(JSON.stringify(MB))
  mb.points = mb.points.filter((p) => p.id !== 'p1') // 删除 p1
  mb.visualization = { schemaVersion: 1, components: [{ id: 'viz_y', name: '断源', type: 'line', pointIds: ['p1'] }] }
  const { post } = makePost(mb)
  const Viz = createVisualizationPage(React, t, post, {})
  const tree = render(createElement(Viz, { sessionId: 's1', scope: { cwd: '/ws' }, useSessions: () => '' }))
  await waitFor(() => assert.ok(tree.container.textContent.includes('断源')), { timeout: 6000 })
  const card = Array.from(tree.container.querySelectorAll('.dvb-viz-card')).find((c) => c.textContent.includes('断源'))
  assert.ok(card.querySelector('.dvb-viz-degraded') || card.className.includes('dvb-viz-degraded'), 'degraded 样式')
  assert.ok(card.textContent.includes('修复'), '修复入口存在')
  const fixBtn = Array.from(card.querySelectorAll('button')).find((b) => b.textContent === '修复')
  await act(async () => { fixBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true })) })
  await waitFor(() => assert.ok(tree.container.textContent.includes('编辑组件')), { timeout: 6000 })
  tree.unmount()
})