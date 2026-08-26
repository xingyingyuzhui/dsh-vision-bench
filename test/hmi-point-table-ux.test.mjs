// TaskP1/0.20.0: 上位机点位表 UX — 行内编辑/行内写入/状态列/开关/草稿归属。
import { beforeEach, afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Window } from 'happy-dom'
import React from 'react'
import { createElement } from 'react'
import { render, cleanup, waitFor, act } from '@testing-library/react'
import { createHmiView } from '../bench-hmi.mjs'

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
  globalThis.scrollTo = () => {}
})
afterEach(() => { cleanup() })

const MB = {
  version: 3,
  configVersion: 7,
  connections: [
    { id: 'c1', name: 'C1', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3', baudrate: 9600, slave: 1, sim: true } },
  ],
  devices: [
    { id: 'd1', connectionId: 'c1', name: '设备1', unitId: 1 },
    { id: 'd2', connectionId: 'c1', name: '设备2', unitId: 2 },
  ],
  points: [
    { id: 'p1', connectionId: 'c1', deviceId: 'd1', name: '温度', function: 3, address: 0, scale: 0.1, offset: 0, unit: '℃', monitorEnabled: true, alarmEnabled: true, alarmMin: 18, alarmMax: 30 },
    { id: 'p2', connectionId: 'c1', deviceId: 'd2', name: '开关', function: 1, address: 0, scale: 1, offset: 0, unit: '', monitorEnabled: false, alarmEnabled: false },
    { id: 'p3', connectionId: 'c1', deviceId: 'd1', name: '压力', function: 3, address: 1, scale: 1, offset: 0, unit: 'kPa', monitorEnabled: true, alarmEnabled: false },
  ],
  values: [
    { key: 'p1', pointId: 'p1', raw: 235, value: 23.5, ok: true, at: Date.now() },
  ],
  alarmState: {},
  pollingByConnection: { c1: { enabled: false, intervalMs: 1000 } },
  framesByConnection: {},
}

const makePost = (mb = MB) => {
  const posts = []
  const post = async (path, body) => {
    posts.push([path, body || {}])
    if (/\/dsh-vision-bench\/state$/.test(path)) {
      return { ok: true, workspace: { modbus: mb, focus: null }, journal: { tasks: [], running: [], timeline: [] }, health: {}, pendingWrites: [], connectionStates: [{ connectionId: 'c1', status: 'connected' }] }
    }
    if (/\/dsh-vision-bench\/serial\/ports$/.test(path)) return { ok: true, ports: ['COM3'] }
    if (/\/dsh-vision-bench\/modbus\/write$/.test(path)) {
      return { ok: true, values: [{ key: body.pointId, pointId: body.pointId, raw: 300, value: 30, ok: true, at: Date.now() }], framesLog: [] }
    }
    return { ok: true }
  }
  return { post, posts }
}


async function selectConn(tree) {
  const connTab = Array.from(tree.container.querySelectorAll('.dvb-tab')).find((b) => b.textContent.includes('C1'))
  if (connTab) { await act(async () => { connTab.dispatchEvent(new win.MouseEvent('click', { bubbles: true })) }) }
  await new Promise((r) => setTimeout(r, 30))
}

const t = (k) => ({ addPoint: '添加点位', batchAdd: '批量添加', batchGenerate: '生成', batchPrefix: '前缀', batchStart: '起始', batchCount: '数量', ptName: '名称', ptNamePh: '名称', ptFc: '功能码', ptAddr: '地址', ptUnit: '单位', colName: '名称', colFn: '功能码', colAddr: '地址', monitorOn: '监视', alarmOn: '告警', ptAlarmMin: '下限', ptAlarmMax: '上限', savePoint: '保存', csvCancel: '取消', csvImport: '导入 CSV', csvExport: '导出 CSV', readAll: '读取', devEdit: '编辑', editing: '编辑', deleteSegment: '删除', noPoints: '暂无点位', writing: '写入中…', quickWrite: '写入' }[k] || k)

test('点位表不存在更新时间与独立写入/读取/编辑/删除文字列（源码契约）', async () => {
  const src = await readFile(new URL('../bench-hmi.mjs', import.meta.url), 'utf8')
  assert.ok(!/el\('th', null, t\('time'\)\)/.test(src), '无更新时间列')
  assert.ok(!/t\('quickWrite'\)/.test(src), '无写入文字按钮')
  assert.ok(!/t\('readSegment'\)/.test(src), '无读取文字按钮')
  assert.ok(!/t\('deleteSegment'\)/.test(src), '无删除文字按钮（编辑态图标）')
  // 目标列存在
  for (const col of ['状态', '当前值', '倍率', '偏移']) assert.ok(src.includes(col), col + ' 列')
})

test('设备编辑只让该设备进入行内编辑（其他设备不受影响）', async () => {
  const { post } = makePost()
  const Hmi = createHmiView(React, t, post)
  const tree = render(createElement(Hmi, { sessionId: 's1', useSessions: () => 's1' }))
  await waitFor(() => assert.ok(tree.container.textContent.includes('C1')), { timeout: 8000 })
  await selectConn(tree)
  await waitFor(() => assert.ok(tree.container.textContent.includes('设备1')), { timeout: 8000 })
  // 找到设备1卡片的编辑按钮并点击
  const cards = Array.from(tree.container.querySelectorAll('.dvb-dev-card'))
  assert.ok(cards.length >= 2, '两个设备卡片渲染')
  const editBtns = Array.from(cards[0].querySelectorAll('button')).filter((b) => b.textContent === '编辑')
  assert.ok(editBtns.length >= 1, '设备1有编辑按钮')
  await act(async () => { editBtns[0].dispatchEvent(new win.MouseEvent('click', { bubbles: true })) })
  await waitFor(() => assert.ok(cards[0].querySelectorAll('input').length > 0), { timeout: 6000 })
  // 设备2卡片的点行仍然文本展示（无 input 行内编辑）
  const d2Row = Array.from(cards[1].querySelectorAll('tr')).find((r) => r.textContent.includes('开关'))
  assert.ok(d2Row, '设备2=开关行存在')
  assert.equal(d2Row.querySelectorAll('input.dvb-input').length, 0, '设备2未进入编辑态')
  tree.unmount()
})

test('添加点位草稿插入当前设备表格内部并固定到该设备', async () => {
  const workspaceSaves = []
  const base = makePost()
  const post = (path, body) => {
    if (/\/workspace$/.test(path)) workspaceSaves.push(body)
    return base.post(path, body)
  }
  const Hmi = createHmiView(React, t, post)
  const tree = render(createElement(Hmi, { sessionId: 's1', useSessions: () => 's1' }))
  await waitFor(() => assert.ok(tree.container.textContent.includes('C1')), { timeout: 8000 })
  await selectConn(tree)
  await waitFor(() => assert.ok(tree.container.textContent.includes('设备2')), { timeout: 8000 })
  const cards = Array.from(tree.container.querySelectorAll('.dvb-dev-card'))
  const d2 = cards[1]
  const addBtn = Array.from(d2.querySelectorAll('button')).find((b) => b.textContent === '添加点位')
  assert.ok(addBtn, '设备2有添加点位按钮')
  await act(async () => { addBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true })) })
  await waitFor(() => assert.ok(d2.querySelector('.dvb-newpoint-row')), { timeout: 6000 })
  const draftRow = d2.querySelector('.dvb-newpoint-row')
  const saveBtn = Array.from(draftRow.querySelectorAll('button')).find((b) => b.textContent === '保存')
  assert.ok(saveBtn, '草稿行有保存按钮')
  await act(async () => { saveBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 50)) })
  const saved = workspaceSaves.find((s) => s.modbus && Array.isArray(s.modbus.points))
  assert.ok(saved, '持久化调用存在')
  const added = saved.modbus.points.find((p) => p.deviceId === 'd2' && p.name !== '开关')
  assert.ok(added, '新增点位归属设备2')
  assert.equal(added.connectionId, 'c1')
  tree.unmount()
})

test('当前值行内写入：点击值单元格只在该行打开编辑器，写请求固定 connectionId/deviceId/pointId', async () => {
  const writes = []
  const mb = { ...MB, values: [{ key: 'p1', pointId: 'p1', raw: 235, value: 23.5, ok: true, at: Date.now() }] }
  const post = async (path, body) => {
    if (/\/dsh-vision-bench\/state$/.test(path)) return { ok: true, workspace: { modbus: mb, focus: null }, journal: { tasks: [], running: [], timeline: [] }, health: {}, pendingWrites: [], connectionStates: [{ connectionId: 'c1', status: 'connected' }] }
    if (/\/serial\/ports$/.test(path)) return { ok: true, ports: ['COM3'] }
    if (/\/dsh-vision-bench\/modbus\/write$/.test(path)) {
      writes.push(body)
      return { ok: true, values: [{ key: body.pointId, pointId: body.pointId, raw: 240, value: 24, ok: true, at: Date.now() }], framesLog: [] }
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
  const tree = render(createElement(Hmi, { sessionId: 's1', useSessions: () => 's1' }))
  await waitFor(() => assert.ok(tree.container.textContent.includes('C1')), { timeout: 8000 })
  await selectConn(tree)
  await waitFor(() => assert.ok(tree.container.textContent.includes('23.5')), { timeout: 8000 })
  const valueCell = Array.from(tree.container.querySelectorAll('.dvb-cell-writable')).find((c) => c.textContent === '23.5')
  assert.ok(valueCell, '可写点位值单元格可点击')
  await act(async () => { valueCell.dispatchEvent(new win.MouseEvent('click', { bubbles: true })) })
  await waitFor(() => assert.ok(tree.container.querySelector('.dvb-inline-write')), { timeout: 6000 })
  // FC03 编辑器默认携带工程值（23.5）；直接 确定 → encodeValue(23.5/scale0.1)=235
  const okBtn = Array.from(tree.container.querySelectorAll('.dvb-inline-write button')).find((b) => b.textContent === '确定')
  assert.ok(okBtn, 'FC03 行内编辑器有确定按钮')
  await act(async () => { okBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 60)) })
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
    if (/\/dsh-vision-bench\/state$/.test(path)) return { ok: true, workspace: { modbus: mb, focus: null }, journal: { tasks: [], running: [], timeline: [] }, health: {}, pendingWrites: [], connectionStates: [{ connectionId: 'c1', status: 'connected' }] }
    if (/\/serial\/ports$/.test(path)) return { ok: true, ports: ['COM3'] }
    if (/\/dsh-vision-bench\/modbus\/write$/.test(path)) { writes.push(body); return { ok: true, values: [{ key: body.pointId, pointId: body.pointId, raw: 1, value: 1, ok: true, at: Date.now() }], framesLog: [] } }
    return { ok: true }
  }
  const Hmi = createHmiView(React, t, post)
  const tree = render(createElement(Hmi, { sessionId: 's1', useSessions: () => 's1' }))
  await waitFor(() => assert.ok(tree.container.textContent.includes('C1')), { timeout: 8000 })
  await selectConn(tree)
  await waitFor(() => assert.ok(tree.container.textContent.includes('开关')), { timeout: 8000 })
  const coilCell = Array.from(tree.container.querySelectorAll('.dvb-cell-writable')).find((c) => c.closest('tr') && c.closest('tr').textContent.includes('开关'))
  assert.ok(coilCell, 'FC01 点位值单元格可点击')
  await act(async () => { coilCell.dispatchEvent(new win.MouseEvent('click', { bubbles: true })) })
  await waitFor(() => assert.ok(tree.container.querySelector('.dvb-inline-write')), { timeout: 6000 })
  const onBtn = Array.from(tree.container.querySelectorAll('.dvb-inline-write button')).find((b) => b.textContent === '开')
  assert.ok(onBtn, 'FC01 有开按钮')
  await act(async () => { onBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true })) })
  const confirmBtn = Array.from(tree.container.querySelectorAll('.dvb-inline-write button')).find((b) => b.textContent === '确认')
  await act(async () => { confirmBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 60)) })
  assert.equal(writes.length, 1)
  assert.equal(writes[0].connectionId, 'c1')
  assert.equal(writes[0].deviceId, 'd2', '开/关写入固定到设备2')
  assert.equal(writes[0].pointId, 'p2')
  assert.deepEqual(writes[0].values, [1])
  tree.unmount()
})

test('只读点位当前值不可点击（FC02/FC04/FC211）', async () => {
  const mb = { ...MB, points: [ { id: 'pr', connectionId: 'c1', deviceId: 'd1', name: '输入', function: 4, address: 2, monitorEnabled: true, alarmEnabled: false } ] }
  const post = async (path) => {
    if (/\/state$/.test(path)) return { ok: true, workspace: { modbus: mb, focus: null }, journal: { tasks: [], running: [], timeline: [] }, health: {}, pendingWrites: [], connectionStates: [] }
    return { ok: true }
  }
  const Hmi = createHmiView(React, t, post)
  const tree = render(createElement(Hmi, { sessionId: 's1', useSessions: () => 's1' }))
  await waitFor(() => assert.ok(tree.container.textContent.includes('C1')), { timeout: 8000 })
  await selectConn(tree)
  await waitFor(() => assert.ok(tree.container.textContent.includes('输入')), { timeout: 8000 })
  const cells = tree.container.querySelectorAll('.dvb-cell-writable')
  assert.equal(cells.length, 0, '只读点位无写入点击')
  const cellsRO = tree.container.querySelectorAll('.dvb-cell-readonly')
  assert.ok(cellsRO.length >= 1, '只读样式存在')
  tree.unmount()
})