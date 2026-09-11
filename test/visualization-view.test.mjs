import assert from 'node:assert/strict'
// TaskP2/0.20.0: 可视化侧边栏 — 组件为中心、编辑器、保存即时渲染、degraded 修复入口。
import { afterEach, beforeEach, test } from 'node:test'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { Window } from 'happy-dom'
import React from 'react'
import { createElement } from 'react'
import { createVisualizationPage } from '../bench-visualization-view.mjs'
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
})

const MB = {
  version: 3,
  configVersion: 9,
  connections: [{ id: 'c1', name: 'C1', conn: { mode: 'rtu', port: 'COM3', slave: 1, sim: true } }],
  devices: [{ id: 'd1', connectionId: 'c1', name: '设备1', unitId: 1 }],
  points: [
    {
      id: 'p1',
      connectionId: 'c1',
      deviceId: 'd1',
      name: '温度',
      function: 3,
      address: 0,
      monitorEnabled: true,
      alarmEnabled: true,
    },
    {
      id: 'p2',
      connectionId: 'c1',
      deviceId: 'd1',
      name: '压力',
      function: 3,
      address: 1,
      monitorEnabled: true,
      alarmEnabled: false,
    },
    {
      id: 'p3',
      connectionId: 'c1',
      deviceId: 'd1',
      name: '未监视',
      function: 3,
      address: 2,
      monitorEnabled: false,
      alarmEnabled: false,
    },
  ],
  values: [{ key: 'p1', pointId: 'p1', value: 23.5, ok: true, at: Date.now() }],
  trend: {
    p1: [
      [Date.now() - 1000, 23],
      [Date.now(), 23.5],
    ],
  },
  alarmState: {},
  visualization: { schemaVersion: 1, components: [] },
}

const makePost = (mb = JSON.parse(JSON.stringify(MB))) => {
  const saved = []
  const post = async (path, body) => {
    if (/\/state$/.test(path))
      return {
        ok: true,
        workspace: { modbus: mb, focus: null },
        journal: { tasks: [], running: [], timeline: [] },
        health: {},
        pendingWrites: [],
      }
    if (/\/command$/.test(path) && body.action === 'visualization') {
      saved.push(body)
      const payload = body.payload || {}
      const current = mb.visualization || { schemaVersion: 1, components: [] }
      let components = current.components.slice()
      if (payload.op === 'add') components.push(payload.component)
      if (payload.op === 'update') {
        components = components.map((component) =>
          component.id === payload.visualizationId
            ? { ...component, ...payload.component, id: component.id }
            : component,
        )
      }
      if (payload.op === 'remove')
        components = components.filter((component) => component.id !== payload.visualizationId)
      if (payload.op === 'layout' && Array.isArray(payload.items)) {
        const byId = new Map(payload.items.map((item) => [item.id, item]))
        components = components.map((component) =>
          byId.has(component.id)
            ? {
                ...component,
                layout: {
                  x: byId.get(component.id).x,
                  y: byId.get(component.id).y,
                  w: byId.get(component.id).w,
                  h: byId.get(component.id).h,
                },
              }
            : component,
        )
      }
      mb = { ...mb, configVersion: (mb.configVersion || 1) + 1, visualization: { schemaVersion: 1, components } }
      return { ok: true, workspace: { modbus: mb } }
    }
    return { ok: true }
  }
  return { post, saved, state: () => mb }
}

const t = (k) =>
  ({
    liveChart: '可视化',
    vizNew: '新建组件',
    vizEdit: '编辑组件',
    vizName: '组件名称',
    vizType: '组件类型',
    vizSearch: '搜索',
    vizCreate: '创建组件',
    vizSave: '保存修改',
    savePoint: '保存',
    csvCancel: '取消',
    vizReadOnlyTitle: '可视化配置为只读',
    vizReadOnlyHint: '当前可以查看组件和实时数据，但不能修改布局、组件配置或执行组件控制。请升级插件后再编辑。',
    vizReadOnlyAction: '当前配置由更高版本插件创建，无法修改',
  })[k] || k

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
  await waitFor(() => assert.ok(tree.container.textContent.includes('组件名称')), { timeout: 6000 })
  // 只列出监视点位（p1/p2），p3 不出现；路径包含 连接/设备/点位
  const picker = tree.container.querySelector('.dvb-viz-picker-list')
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
  await waitFor(() => assert.ok(tree.container.textContent.includes('已选 1 个点位')), { timeout: 6000 })
  // 保存
  const saveBtn = Array.from(tree.container.querySelectorAll('button')).find(
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
  await waitFor(() => assert.ok(tree.container.textContent.includes('编辑组件')), { timeout: 6000 })
  const nameInput = Array.from(tree.container.querySelectorAll('input')).find((i) => i.value === '我的数值卡')
  assert.ok(nameInput, '组件名称回显')
  const typeSel = Array.from(tree.container.querySelectorAll('select')).find((s) => s.value === 'value')
  assert.ok(typeSel, '组件类型回显 value')
  assert.ok(tree.container.textContent.includes('显示'), '数值卡配置含显示页签')
  assert.ok(tree.container.textContent.includes('实时预览'), '数值卡配置含预览')
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
  await waitFor(() => assert.ok(tree.container.textContent.includes('编辑组件')), { timeout: 6000 })
  tree.unmount()
})
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
  await waitFor(() => assert.ok(tree.container.textContent.includes('编辑组件')), { timeout: 6000 })
  // 保存（名称空不变更时，norm 后同值）→ 索引替换
  const saveBtn = Array.from(tree.container.querySelectorAll('button')).find(
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
  const { VISUALIZATION_CSS } = await import('../src/ui/styles/visualization.mjs')
  const css = VISUALIZATION_CSS.join('')
  assert.match(css, /\.dvb-viz-tabs-bar\{[^}]*border-bottom:1px solid var\(--dvb-bdr\)/)
  assert.match(css, /\.dvb-viz-group-title\{[^}]*border-top:1px solid var\(--dvb-bdr\)/)
  assert.match(css, /\.dvb-viz-group-title:first-child\{border-top:0\}/)
})

test('组件编辑弹窗锁在视口内，不把整页撑出滚动', async () => {
  const { VISUALIZATION_CSS } = await import('../src/ui/styles/visualization.mjs')
  const css = VISUALIZATION_CSS.join('')
  assert.match(css, /\.dvb-viz-modal-mask\{[^}]*overflow:hidden/)
  assert.match(css, /\.dvb-viz-modal\{[^}]*height:calc\(100vh - 32px\)/)
  assert.match(css, /\.dvb-viz-modal\{[^}]*max-height:calc\(100vh - 32px\)/)
  assert.match(css, /\.dvb-viz-modal\{[^}]*min-height:0/)
  assert.match(css, /\.dvb-viz-drawer-body\{[^}]*overflow:auto/)
  assert.doesNotMatch(css, /dvb-viz-picker-list\)\{border:1px/)
  assert.match(css, /body:has\(\.dvb-viz-modal-mask\)\{overflow:hidden\}/)
  assert.match(css, /\.dvb-viz-drawer-body\{[^}]*overscroll-behavior:contain/)
})

