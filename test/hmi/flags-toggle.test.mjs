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

test('非编辑态也可切换监视/告警开关并立即持久化', async () => {
  const flagPosts = []
  const mb = {
    ...MB,
    points: [
      {
        id: 'p1',
        connectionId: 'c1',
        deviceId: 'd1',
        name: '温度',
        function: 3,
        address: 0,
        scale: 0.1,
        offset: 0,
        unit: '℃',
        monitorEnabled: false,
        alarmEnabled: true,
        alarmMin: 18,
        alarmMax: 30,
      },
    ],
  }
  const post = async (path, body) => {
    if (/\/state$/.test(path))
      return {
        ok: true,
        workspace: { modbus: mb, focus: null },
        journal: { tasks: [], running: [], timeline: [] },
        health: {},
        pendingWrites: [],
        connectionStates: [],
      }
    if (/\/serial\/ports$/.test(path)) return { ok: true, ports: ['COM3'] }
    if (/\/points\/flags$/.test(path)) {
      flagPosts.push(body)
      assert.ok(!body.points && !(body.modbus && body.modbus.points), '不得提交完整 points 数组')
      assert.equal(body.pointId, 'p1')
      const pt = mb.points[0]
      if (body.monitorEnabled !== undefined) {
        pt.monitorEnabled = body.monitorEnabled === true
        pt.trendEnabled = pt.monitorEnabled
      }
      if (body.alarmEnabled !== undefined) pt.alarmEnabled = body.alarmEnabled === true
      mb.configVersion = (mb.configVersion || 7) + 1
      return {
        ok: true,
        point: { ...pt },
        configVersion: mb.configVersion,
        workspace: { modbus: { ...mb, points: [{ ...pt }] } },
      }
    }
    if (/\/workspace$/.test(path)) return { ok: true, workspace: { modbus: mb } }
    return { ok: true }
  }
  const Hmi = createHmiView(React, t, post)
  const tree = render(createElement(Hmi, { ...alpha3PageProps({ sessionId: 's1', path: '/tmp/proj' }) }))
  await waitFor(() => assert.ok(tree.container.textContent.includes('C1')), { timeout: 8000 })
  await selectConn(tree)
  await waitFor(() => assert.ok(tree.container.textContent.includes('温度')), { timeout: 8000 })
  assert.equal(tree.container.querySelectorAll('.dvb-dev-edit-row').length, 0, '非设备编辑态')
  assert.equal(tree.container.querySelectorAll('tr[data-editing="true"]').length, 0, '非点位编辑态')
  const switches = Array.from(tree.container.querySelectorAll('button.dvb-switch'))
  assert.ok(switches.length >= 2, '监视/告警开关存在')
  const mon = switches.find((b) => (b.getAttribute('aria-label') || b.getAttribute('title') || '').includes('可视化'))
  const alm = switches.find((b) => (b.getAttribute('aria-label') || b.getAttribute('title') || '').includes('告警'))
  assert.ok(mon && alm, '找到监视与告警开关')
  assert.equal(mon.getAttribute('aria-pressed'), 'false')
  assert.equal(alm.getAttribute('aria-pressed'), 'true')
  await act(async () => {
    mon.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 80))
  })
  await waitFor(
    () => {
      const hit = flagPosts.find((s) => s.monitorEnabled === true && s.pointId === 'p1')
      assert.ok(hit, '监视开关走点位 flags 接口')
    },
    { timeout: 6000 },
  )
  await waitFor(() => assert.equal(mon.getAttribute('aria-pressed'), 'true'), { timeout: 6000 })
  await act(async () => {
    alm.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 80))
  })
  await waitFor(
    () => {
      const hit = flagPosts.find((s) => s.alarmEnabled === false && s.pointId === 'p1')
      assert.ok(hit, '告警开关走点位 flags 接口')
    },
    { timeout: 6000 },
  )
  tree.unmount()
})

test('编辑点位态与新增草稿态开关可点；点轨道也可触发', async () => {
  const mb = {
    ...MB,
    points: [
      {
        id: 'p1',
        connectionId: 'c1',
        deviceId: 'd1',
        name: '温度',
        function: 3,
        address: 0,
        scale: 0.1,
        offset: 0,
        unit: '℃',
        monitorEnabled: false,
        alarmEnabled: false,
        alarmMin: 1,
        alarmMax: 9,
      },
    ],
  }
  const flagPosts = []
  const post = async (path, body) => {
    if (/\/state$/.test(path))
      return {
        ok: true,
        workspace: { modbus: mb, focus: null },
        journal: { tasks: [], running: [], timeline: [] },
        health: {},
        pendingWrites: [],
        connectionStates: [],
      }
    if (/\/serial\/ports$/.test(path)) return { ok: true, ports: ['COM3'] }
    if (/\/points\/flags$/.test(path)) {
      flagPosts.push(body)
      const pt = mb.points[0]
      if (body.monitorEnabled !== undefined) {
        pt.monitorEnabled = body.monitorEnabled === true
        pt.trendEnabled = pt.monitorEnabled
      }
      if (body.alarmEnabled !== undefined) pt.alarmEnabled = body.alarmEnabled === true
      mb.configVersion = (mb.configVersion || 7) + 1
      return { ok: true, point: { ...pt }, configVersion: mb.configVersion, workspace: { modbus: { ...mb } } }
    }
    return { ok: true }
  }
  const Hmi = createHmiView(React, t, post)
  const tree = render(createElement(Hmi, { ...alpha3PageProps({ sessionId: 's1', path: '/tmp/proj' }) }))
  await waitFor(() => assert.ok(tree.container.textContent.includes('C1')), { timeout: 8000 })
  await selectConn(tree)
  await waitFor(() => assert.ok(tree.container.textContent.includes('温度')), { timeout: 8000 })
  // 进入编辑点位
  const editPt = Array.from(tree.container.querySelectorAll('button')).find((b) => b.textContent === '编辑点位')
  assert.ok(editPt)
  await act(async () => {
    editPt.click()
    await new Promise((r) => setTimeout(r, 40))
  })
  await waitFor(() => assert.ok(tree.container.querySelector('tr[data-editing="true"]')), { timeout: 6000 })
  let mon = Array.from(tree.container.querySelectorAll('button.dvb-switch')).find((b) =>
    (b.getAttribute('aria-label') || '').includes('可视化'),
  )
  assert.ok(mon)
  const track = mon.querySelector('.dvb-switch-track')
  assert.ok(track)
  await act(async () => {
    track.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 80))
  })
  await waitFor(() => assert.ok(flagPosts.some((s) => s.monitorEnabled === true)), { timeout: 6000 })
  // 新增草稿
  const addBtn = Array.from(tree.container.querySelectorAll('button')).find((b) => b.textContent === '添加点位')
  await act(async () => {
    addBtn.click()
    await new Promise((r) => setTimeout(r, 40))
  })
  await waitFor(() => assert.ok(tree.container.querySelector('.dvb-newpoint-row')), { timeout: 6000 })
  const draftSwitches = Array.from(tree.container.querySelectorAll('.dvb-newpoint-row button.dvb-switch'))
  assert.ok(draftSwitches.length >= 2)
  const before = draftSwitches[0].getAttribute('aria-pressed')
  await act(async () => {
    draftSwitches[0].dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 40))
  })
  const after = Array.from(tree.container.querySelectorAll('.dvb-newpoint-row button.dvb-switch'))[0].getAttribute(
    'aria-pressed',
  )
  assert.notEqual(before, after, '草稿开关可本地切换')
  tree.unmount()
})

test('flags 保存失败会回滚且不影响另一开关', async () => {
  const mb = {
    ...MB,
    points: [
      {
        id: 'p1',
        connectionId: 'c1',
        deviceId: 'd1',
        name: '温度',
        function: 3,
        address: 0,
        scale: 1,
        offset: 0,
        unit: '',
        monitorEnabled: false,
        alarmEnabled: true,
        alarmMin: 1,
        alarmMax: 9,
      },
    ],
  }
  let failMon = true
  const post = async (path, body) => {
    if (/\/state$/.test(path))
      return {
        ok: true,
        workspace: { modbus: mb, focus: null },
        journal: { tasks: [], running: [], timeline: [] },
        health: {},
        pendingWrites: [],
        connectionStates: [],
      }
    if (/\/serial\/ports$/.test(path)) return { ok: true, ports: ['COM3'] }
    if (/\/points\/flags$/.test(path)) {
      if (body.monitorEnabled !== undefined && failMon) return { ok: false, error: 'boom' }
      const pt = mb.points[0]
      if (body.alarmEnabled !== undefined) pt.alarmEnabled = body.alarmEnabled === true
      mb.configVersion = (mb.configVersion || 7) + 1
      return { ok: true, point: { ...pt }, configVersion: mb.configVersion, workspace: { modbus: { ...mb } } }
    }
    return { ok: true }
  }
  const Hmi = createHmiView(React, t, post)
  const tree = render(createElement(Hmi, { ...alpha3PageProps({ sessionId: 's1', path: '/tmp/proj' }) }))
  await waitFor(() => assert.ok(tree.container.textContent.includes('C1')), { timeout: 8000 })
  await selectConn(tree)
  await waitFor(() => assert.ok(tree.container.textContent.includes('温度')), { timeout: 8000 })
  const mon = Array.from(tree.container.querySelectorAll('button.dvb-switch')).find((b) =>
    (b.getAttribute('aria-label') || '').includes('可视化'),
  )
  const alm = Array.from(tree.container.querySelectorAll('button.dvb-switch')).find((b) =>
    (b.getAttribute('aria-label') || '').includes('告警'),
  )
  await act(async () => {
    mon.click()
    await new Promise((r) => setTimeout(r, 100))
  })
  await waitFor(
    () => {
      assert.equal(mon.getAttribute('aria-pressed'), 'false', '监视失败回滚')
      assert.ok(tree.container.textContent.includes('监视状态保存失败'), '显示错误')
    },
    { timeout: 6000 },
  )
  assert.equal(alm.getAttribute('aria-pressed'), 'true', '告警不受影响')
  failMon = false
  await act(async () => {
    alm.click()
    await new Promise((r) => setTimeout(r, 100))
  })
  await waitFor(() => assert.equal(alm.getAttribute('aria-pressed'), 'false'), { timeout: 6000 })
  tree.unmount()
})
