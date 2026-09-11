import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { act, cleanup, render } from '@testing-library/react'
import { Window } from 'happy-dom'
import React from 'react'
import { createElement } from 'react'
import { createVizPointPicker } from '../../src/ui/monitor/visualization/components/viz-point-picker.mjs'

let win
beforeEach(() => {
  win = new Window({ url: 'http://localhost/' })
  globalThis.window = win
  globalThis.document = win.document
  globalThis.HTMLElement = win.HTMLElement
})
afterEach(() => cleanup())

function renderPicker(overrides = {}) {
  const Picker = createVizPointPicker(React, (k) => k)
  let editor = {
    type: 'line',
    pointIds: ['p1'],
    search: '',
    ...overrides.editor,
  }
  const setEditor = (fn) => {
    editor = typeof fn === 'function' ? fn(editor) : fn
  }
  const tree = render(
    createElement(Picker, {
      editor,
      setEditor,
      pointOptions: [
        { pointId: 'p1', name: '温度', path: 'test1 / 设备1 / 温度', function: 3, address: 0, deviceId: 'd1', connectionId: 'c1' },
        { pointId: 'p2', name: '压力', path: 'test1 / 设备1 / 压力', function: 4, address: 1, deviceId: 'd1', connectionId: 'c1' },
        { pointId: 'p3', name: '开度', path: 'test1 / 设备2 / 开度', function: 3, address: 0, deviceId: 'd2', connectionId: 'c1' },
      ],
      points: [],
      devices: [
        { id: 'd1', name: '设备1' },
        { id: 'd2', name: '设备2' },
      ],
      connections: [{ id: 'c1', name: 'test1' }],
      ...overrides,
    }),
  )
  return { tree, getEditor: () => editor }
}

test('按设备成组：有勾选的设备默认展开，其余折叠', () => {
  const { tree } = renderPicker()
  const groups = tree.container.querySelectorAll('.dvb-viz-picker-group')
  assert.equal(groups.length, 2)
  assert.equal(groups[0].querySelector('.dvb-viz-picker-dev-title').textContent, '设备1')
  assert.equal(groups[0].querySelector('.dvb-viz-picker-dev-head').getAttribute('aria-expanded'), 'true')
  assert.equal(groups[1].querySelector('.dvb-viz-picker-dev-head').getAttribute('aria-expanded'), 'false')
  assert.equal(groups[1].getAttribute('data-folded'), 'true')
  const chevron = groups[0].querySelector('.dvb-viz-picker-chevron svg')
  assert.ok(chevron, '设备标题用工作区同款 14px 实心三角')
  assert.equal(chevron.getAttribute('viewBox'), '0 0 14 14')
  assert.ok(groups[0].querySelector('.dvb-viz-picker-dev-body'), '展开组有点位列表')
  assert.equal(groups[1].querySelector('.dvb-viz-picker-dev-body'), null, '折叠组不渲染点位')
  assert.ok(tree.container.textContent.includes('温度'))
  assert.equal(tree.container.textContent.includes('开度'), false)
})

test('点击设备标题只折叠/展开该设备', async () => {
  const { tree } = renderPicker()
  const heads = tree.container.querySelectorAll('.dvb-viz-picker-dev-head')
  await act(async () => {
    heads[1].dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })
  const groups = tree.container.querySelectorAll('.dvb-viz-picker-group')
  assert.equal(groups[1].querySelector('.dvb-viz-picker-dev-head').getAttribute('aria-expanded'), 'true')
  assert.ok(tree.container.textContent.includes('开度'), '展开设备2后看到其点位')
  assert.ok(tree.container.textContent.includes('温度'), '设备1仍展开')
  await act(async () => {
    tree.container.querySelectorAll('.dvb-viz-picker-dev-head')[0].dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })
  assert.equal(tree.container.textContent.includes('温度'), false, '折叠设备1后隐藏其点位')
  assert.ok(tree.container.textContent.includes('开度'), '设备2不受影响')
})

test('搜索时所有匹配设备都展开', () => {
  const { tree } = renderPicker({ editor: { type: 'line', pointIds: ['p1'], search: '开度' } })
  const heads = tree.container.querySelectorAll('.dvb-viz-picker-dev-head')
  assert.equal(heads[0] && heads[0].getAttribute('aria-expanded'), 'true')
  assert.ok(tree.container.textContent.includes('开度'))
})
