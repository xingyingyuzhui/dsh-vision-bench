import assert from 'node:assert/strict'
import test from 'node:test'
import { act, render, waitFor } from '@testing-library/react'
import React from 'react'
import { createElement } from 'react'
import { createHmiView } from '../../bench-hmi.mjs'
import { alpha3PageProps } from '../fixtures/harness-alpha3-props.mjs'
import { MB, selectConn, t } from '../helpers/hmi-page-fixtures.mjs'
import { pageWindow as win, useReactPageRuntime } from '../helpers/react-runtime.mjs'

useReactPageRuntime({ profile: 'page' })

test('当前值行内写入：点击值单元格只在该行打开编辑器，写请求固定 connectionId/deviceId/pointId', async () => {
  const writes = []
  const mb = { ...MB, values: [{ key: 'p1', pointId: 'p1', raw: 235, value: 23.5, ok: true, at: Date.now() }] }
  const post = async (path, body) => {
    if (/\/dsh-vision-bench\/state$/.test(path))
      return {
        ok: true,
        workspace: { modbus: mb, focus: null },
        journal: { tasks: [], running: [], timeline: [] },
        health: {},
        pendingWrites: [],
        connectionStates: [{ connectionId: 'c1', status: 'connected' }],
      }
    if (/\/serial\/ports$/.test(path)) return { ok: true, ports: ['COM3'] }
    if (/\/dsh-vision-bench\/modbus\/write$/.test(path)) {
      writes.push(body)
      return {
        ok: true,
        values: [{ key: body.pointId, pointId: body.pointId, raw: 240, value: 24, ok: true, at: Date.now() }],
        framesLog: [],
      }
    }
    if (/\/dsh-vision-bench\/workspace$/.test(path)) {
      // 持久化点列表
      if (body.modbus && body.modbus.points) mb.points = body.modbus.points
      if (body.modbus && body.modbus.values) mb.values = body.modbus.values
      return { ok: true, workspace: { modbus: mb } }
    }
    return { ok: true }
  }
  const Hmi = createHmiView(React, t, post)
  const tree = render(createElement(Hmi, { ...alpha3PageProps({ sessionId: 's1', path: '/tmp/proj' }) }))
  await waitFor(() => assert.ok(tree.container.textContent.includes('C1')), { timeout: 8000 })
  await selectConn(tree)
  await waitFor(() => assert.ok(tree.container.textContent.includes('23.5')), { timeout: 8000 })
  const valueCell = Array.from(tree.container.querySelectorAll('.dvb-cell-writable')).find(
    (c) => c.textContent === '23.5',
  )
  assert.ok(valueCell, '可写点位值单元格可点击')
  await act(async () => {
    valueCell.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })
  await waitFor(() => assert.ok(tree.container.querySelector('.dvb-inline-write')), { timeout: 6000 })
  // FC03 编辑器默认携带工程值（23.5）；直接 确定 → encodeValue(23.5/scale0.1)=235
  const okBtn = Array.from(tree.container.querySelectorAll('.dvb-inline-write button')).find(
    (b) => b.textContent === '确定',
  )
  assert.ok(okBtn, 'FC03 行内编辑器有确定按钮')
  await act(async () => {
    okBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 60))
  })
  assert.equal(writes.length, 1)
  assert.equal(writes[0].connectionId, 'c1', '写请求固定 connectionId')
  assert.equal(writes[0].deviceId, 'd1', '写请求固定 deviceId')
  assert.equal(writes[0].pointId, 'p1', '写请求固定 pointId')
  assert.deepEqual(writes[0].values, [235], '默认工程值 23.5 / scale0.1 → raw 235')
  tree.unmount()
})

test('FC01 开关行内写入：确认写入固定到设备2（p2）', async () => {
  const writes = []
  const mb = { ...MB }
  const post = async (path, body) => {
    if (/\/dsh-vision-bench\/state$/.test(path))
      return {
        ok: true,
        workspace: { modbus: mb, focus: null },
        journal: { tasks: [], running: [], timeline: [] },
        health: {},
        pendingWrites: [],
        connectionStates: [{ connectionId: 'c1', status: 'connected' }],
      }
    if (/\/serial\/ports$/.test(path)) return { ok: true, ports: ['COM3'] }
    if (/\/dsh-vision-bench\/modbus\/write$/.test(path)) {
      writes.push(body)
      return {
        ok: true,
        values: [{ key: body.pointId, pointId: body.pointId, raw: 1, value: 1, ok: true, at: Date.now() }],
        framesLog: [],
      }
    }
    return { ok: true }
  }
  const Hmi = createHmiView(React, t, post)
  const tree = render(createElement(Hmi, { ...alpha3PageProps({ sessionId: 's1', path: '/tmp/proj' }) }))
  await waitFor(() => assert.ok(tree.container.textContent.includes('C1')), { timeout: 8000 })
  await selectConn(tree)
  await waitFor(() => assert.ok(tree.container.textContent.includes('开关')), { timeout: 8000 })
  const coilCell = Array.from(tree.container.querySelectorAll('.dvb-cell-writable')).find(
    (c) => c.closest('tr') && c.closest('tr').textContent.includes('开关'),
  )
  assert.ok(coilCell, 'FC01 点位值单元格可点击')
  await act(async () => {
    coilCell.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })
  await waitFor(() => assert.ok(tree.container.querySelector('.dvb-inline-write')), { timeout: 6000 })
  const onBtn = Array.from(tree.container.querySelectorAll('.dvb-inline-write button')).find(
    (b) => b.textContent === '开',
  )
  assert.ok(onBtn, 'FC01 有开按钮')
  await act(async () => {
    onBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })
  const confirmBtn = Array.from(tree.container.querySelectorAll('.dvb-inline-write button')).find(
    (b) => b.textContent === '确认',
  )
  await act(async () => {
    confirmBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 60))
  })
  assert.equal(writes.length, 1)
  assert.equal(writes[0].connectionId, 'c1')
  assert.equal(writes[0].deviceId, 'd2', '开/关写入固定到设备2')
  assert.equal(writes[0].pointId, 'p2')
  assert.deepEqual(writes[0].values, [1])
  tree.unmount()
})

test('只读点位当前值不可点击（FC02/FC04/FC211）', async () => {
  const mb = {
    ...MB,
    points: [
      {
        id: 'pr',
        connectionId: 'c1',
        deviceId: 'd1',
        name: '输入',
        function: 4,
        address: 2,
        monitorEnabled: true,
        alarmEnabled: false,
      },
    ],
  }
  const post = async (path) => {
    if (/\/state$/.test(path))
      return {
        ok: true,
        workspace: { modbus: mb, focus: null },
        journal: { tasks: [], running: [], timeline: [] },
        health: {},
        pendingWrites: [],
        connectionStates: [],
      }
    return { ok: true }
  }
  const Hmi = createHmiView(React, t, post)
  const tree = render(createElement(Hmi, { ...alpha3PageProps({ sessionId: 's1', path: '/tmp/proj' }) }))
  await waitFor(() => assert.ok(tree.container.textContent.includes('C1')), { timeout: 8000 })
  await selectConn(tree)
  await waitFor(() => assert.ok(tree.container.textContent.includes('输入')), { timeout: 8000 })
  const cells = tree.container.querySelectorAll('.dvb-cell-writable')
  assert.equal(cells.length, 0, '只读点位无写入点击')
  const cellsRO = tree.container.querySelectorAll('.dvb-cell-readonly')
  assert.ok(cellsRO.length >= 1, '只读样式存在')
  tree.unmount()
})
