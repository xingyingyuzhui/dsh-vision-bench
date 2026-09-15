import assert from 'node:assert/strict'
import test from 'node:test'
import { act, render, waitFor } from '@testing-library/react'
import React from 'react'
import { createElement } from 'react'
import { createHmiView } from '../../bench-hmi.mjs'
import { alpha3PageProps } from '../fixtures/harness-alpha3-props.mjs'
import { makePost, selectConn, t } from '../helpers/hmi-page-fixtures.mjs'
import { pageWindow as win, useReactPageRuntime } from '../helpers/react-runtime.mjs'

useReactPageRuntime({ profile: 'page' })

test('点位表表头包含 Excel 式列宽拖拽手柄，支持左右拖拽与双击恢复默认', async () => {
  const { post } = makePost()
  const Hmi = createHmiView(React, t, post)
  const tree = render(createElement(Hmi, { ...alpha3PageProps({ sessionId: 's1', path: '/tmp/proj' }) }))
  await waitFor(() => assert.ok(tree.container.textContent.includes('C1')), { timeout: 8000 })
  await selectConn(tree)
  await waitFor(() => assert.ok(tree.container.textContent.includes('设备1')), { timeout: 8000 })

  const resizers = Array.from(tree.container.querySelectorAll('.dvb-point-table thead .dvb-col-resizer'))
  assert.ok(resizers.length >= 11, '所有数据列均具备列宽拖拽手柄')

  const nameResizer = resizers.find((r) => r.getAttribute('data-col') === 'name')
  assert.ok(nameResizer, '名称列拖拽手柄存在')

  const nameTh = nameResizer.closest('th')
  assert.ok(nameTh, '名称列表头存在')
  const initialWidth = parseInt(nameTh.style.width, 10) || 140

  // 模拟拖拽名称列：pointerdown -> pointermove (+50px) -> pointerup
  await act(async () => {
    nameResizer.dispatchEvent(new win.PointerEvent('pointerdown', { clientX: 100, button: 0, bubbles: true }))
    win.document.dispatchEvent(new win.PointerEvent('pointermove', { clientX: 150, bubbles: true }))
    win.document.dispatchEvent(new win.PointerEvent('pointerup', { clientX: 150, bubbles: true }))
  })

  // 验证拖拽后宽度增加
  const newWidth = parseInt(nameTh.style.width, 10)
  assert.ok(newWidth >= initialWidth + 40, '拖拽后列宽变宽: ' + newWidth)

  // 验证双击恢复默认
  await act(async () => {
    nameResizer.dispatchEvent(new win.MouseEvent('dblclick', { bubbles: true }))
  })
  const resetWidth = parseInt(nameTh.style.width, 10)
  assert.equal(resetWidth, 140, '双击后列宽恢复为默认 140px')

  // 关键测试：拖拽右侧列（如“当前值”），左侧的“名称”和“功能码”列宽必须完全锁定、分毫不动！
  const valueResizer = resizers.find((r) => r.getAttribute('data-col') === 'value')
  const fnTh = tree.container.querySelector('.dvb-point-table thead .dvb-col-fn')
  const nameWidthBefore = parseInt(nameTh.style.width, 10)
  const fnWidthBefore = parseInt(fnTh.style.width, 10)

  await act(async () => {
    valueResizer.dispatchEvent(new win.PointerEvent('pointerdown', { clientX: 200, button: 0, bubbles: true }))
    win.document.dispatchEvent(new win.PointerEvent('pointermove', { clientX: 260, bubbles: true }))
    win.document.dispatchEvent(new win.PointerEvent('pointerup', { clientX: 260, bubbles: true }))
  })

  assert.equal(parseInt(nameTh.style.width, 10), nameWidthBefore, '拖拽右侧列时，左侧名称列宽保持不变')
  assert.equal(parseInt(fnTh.style.width, 10), fnWidthBefore, '拖拽右侧列时，左侧功能码列宽保持不变')

  tree.unmount()
})

test('不同连接/不同设备下的点位表列宽完全独立隔离，调整一个设备不影响其他设备', async () => {
  const { post } = makePost()
  const Hmi = createHmiView(React, t, post)
  const tree = render(createElement(Hmi, { ...alpha3PageProps({ sessionId: 's1', path: '/tmp/proj' }) }))
  await waitFor(() => assert.ok(tree.container.textContent.includes('C1')), { timeout: 8000 })
  await selectConn(tree)
  await waitFor(
    () => assert.ok(tree.container.textContent.includes('设备1') && tree.container.textContent.includes('设备2')),
    { timeout: 8000 },
  )

  const devCards = Array.from(tree.container.querySelectorAll('.dvb-dev-card'))
  assert.equal(devCards.length, 2, '同时渲染设备1和设备2卡片')

  // 获取设备1与设备2的表格及名称列表头
  const dev1Table = devCards[0].querySelector('.dvb-point-table')
  const dev2Table = devCards[1].querySelector('.dvb-point-table')
  assert.ok(dev1Table && dev2Table, '设备1和设备2均拥有点位表格')

  const dev1NameTh = dev1Table.querySelector('thead .dvb-col-name')
  const dev2NameTh = dev2Table.querySelector('thead .dvb-col-name')
  assert.ok(dev1NameTh && dev2NameTh)

  // 初始列宽均为默认 140px
  assert.equal(parseInt(dev1NameTh.style.width, 10), 140)
  assert.equal(parseInt(dev2NameTh.style.width, 10), 140)

  // 拖拽设备1的名称列 +80px
  const dev1NameResizer = dev1NameTh.querySelector('.dvb-col-resizer')
  assert.ok(dev1NameResizer)
  await act(async () => {
    dev1NameResizer.dispatchEvent(new win.PointerEvent('pointerdown', { clientX: 100, button: 0, bubbles: true }))
    win.document.dispatchEvent(new win.PointerEvent('pointermove', { clientX: 180, bubbles: true }))
    win.document.dispatchEvent(new win.PointerEvent('pointerup', { clientX: 180, bubbles: true }))
  })

  // 核心断言：设备1的名称列宽变宽为 220px，而设备2的名称列宽必须严格保持 140px，互不干扰！
  assert.equal(parseInt(dev1NameTh.style.width, 10), 220, '设备1名称列宽被成功调整为 220px')
  assert.equal(parseInt(dev2NameTh.style.width, 10), 140, '设备2名称列宽严格保持独立，未发生任何改变！')

  // 设备1的总表格宽度也相应扩展，而设备2的总表格宽度保持不变
  const dev1TableWidth = parseInt(dev1Table.style.width, 10)
  const dev2TableWidth = parseInt(dev2Table.style.width, 10)
  assert.ok(dev1TableWidth > dev2TableWidth, '设备1表格总宽扩大，设备2表格总宽保持原样')

  tree.unmount()
})
