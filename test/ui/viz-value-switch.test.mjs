import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { render } from '@testing-library/react'
import { Window } from 'happy-dom'
import { formatVizValue, renderValueWidget, valueStatus } from '../../src/ui/monitor/visualization/renderers/value-renderer.mjs'
import { renderSwitchWidget } from '../../src/ui/monitor/visualization/renderers/switch-renderer.mjs'

const win = new Window({ url: 'http://localhost/' })
globalThis.window = win
globalThis.document = win.document
globalThis.HTMLElement = win.HTMLElement

const el = createElement

test('formatVizValue 应用小数位与前后缀', () => {
  assert.equal(formatVizValue(26.84, { valueDecimals: 1 }), '26.8')
  assert.equal(formatVizValue(12, { valuePrefix: '~', valueSuffix: 'x' }), '~12x')
  assert.equal(formatVizValue(null, {}), null)
})

test('valueStatus 按上下限判定告警', () => {
  assert.equal(valueStatus(10, true, {}), 'ok')
  assert.equal(valueStatus(90, true, { statusHi: 80 }), 'alarm')
  assert.equal(valueStatus(1, true, { statusLo: 5 }), 'alarm')
  assert.equal(valueStatus(1, false, {}), 'offline')
})

test('数值卡 widget 渲染标题、单位与状态', () => {
  const tree = render(renderValueWidget(el, {
    settings: { yUnit: '℃', showStatus: true, showUpdatedAt: true, valueDecimals: 1 },
    name: '设备温度',
    value: 26.8,
    ok: true,
    at: Date.UTC(2026, 0, 1, 6, 5, 12),
  }))
  const text = tree.container.textContent
  assert.ok(text.includes('设备温度'))
  assert.ok(text.includes('26.8'))
  assert.ok(text.includes('℃'))
  assert.ok(text.includes('正常'))
})

test('控制开关 widget 默认滑动开关并可切换文案', () => {
  const tree = render(renderSwitchWidget(el, {
    settings: { onLabel: '已开启', offLabel: '已关闭', switchStyle: 'toggle' },
    name: '风机开关',
    on: true,
  }))
  const text = tree.container.textContent
  assert.ok(text.includes('风机开关'))
  assert.ok(text.includes('已开启'))
  const sw = tree.container.querySelector('[role=switch]')
  assert.ok(sw)
  assert.equal(sw.getAttribute('aria-checked'), 'true')
})
