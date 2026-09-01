import assert from 'node:assert/strict'
// 监视/告警开关：点位级 flags 接口的并发与乱序响应
import { afterEach, beforeEach, test } from 'node:test'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { Window } from 'happy-dom'
import React from 'react'
import { createElement } from 'react'
import { createHmiView } from '../bench-hmi.mjs'
import { createHmiPointActions } from '../src/ui/hmi/hmi-point-actions.mjs'
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
    constructor() {}
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
  globalThis.scrollTo = () => {}
})
afterEach(() => {
  cleanup()
})

const t = (k) =>
  ({
    addPoint: '添加点位',
    batchAdd: '批量添加',
    batchGenerate: '生成',
    colName: '名称',
    colFn: '功能码',
    colAddr: '地址',
    monitorOn: '监视',
    alarmOn: '告警',
    savePoint: '保存',
    csvCancel: '取消',
    csvImport: '导入 CSV',
    csvExport: '导出 CSV',
    readAll: '读取',
    devEdit: '编辑设备',
    ptEdit: '编辑点位',
    ptSave: '保存',
    noPoints: '暂无点位',
  })[k] || k

const baseMb = () => ({
  version: 3,
  configVersion: 10,
  connections: [
    {
      id: 'c1',
      name: 'C1',
      role: 'client',
      enabled: true,
      conn: { mode: 'rtu', port: 'COM3', baudrate: 9600, sim: true },
    },
  ],
  devices: [{ id: 'd1', connectionId: 'c1', name: '设备1', unitId: 1 }],
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
      alarmEnabled: false,
      alarmMin: 1,
      alarmMax: 9,
    },
    {
      id: 'p2',
      connectionId: 'c1',
      deviceId: 'd1',
      name: '压力',
      function: 3,
      address: 1,
      scale: 1,
      offset: 0,
      unit: '',
      monitorEnabled: false,
      alarmEnabled: false,
    },
  ],
  values: [],
  pollingByConnection: {},
  framesByConnection: {},
  activeConnectionId: 'c1',
  activeDeviceId: 'd1',
})

async function mount(post) {
  const Hmi = createHmiView(React, t, post)
  const tree = render(createElement(Hmi, { ...alpha3PageProps({ sessionId: 's1', path: '/tmp/proj' }) }))
  await waitFor(() => assert.ok(tree.container.textContent.includes('C1')), { timeout: 8000 })
  const connTab = Array.from(tree.container.querySelectorAll('.dvb-tab')).find((b) => b.textContent.includes('C1'))
  if (connTab)
    await act(async () => {
      connTab.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 30))
    })
  await waitFor(() => assert.ok(tree.container.textContent.includes('温度')), { timeout: 8000 })
  await waitFor(() => assert.ok(tree.container.querySelectorAll('button.dvb-switch').length >= 2), { timeout: 8000 })
  return tree
}

test('监视开启后立即关闭：乱序响应不得覆盖最新状态', async () => {
  const mb = baseMb()
  const deferred = []
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
      return new Promise((resolve) => {
        deferred.push({ body, resolve })
      })
    }
    return { ok: true }
  }
  const tree = await mount(post)
  const findMon = () =>
    Array.from(tree.container.querySelectorAll('button.dvb-switch')).find(
      (b) =>
        (b.getAttribute('aria-label') || '').includes('可视化') ||
        (b.getAttribute('title') || '').includes('可视化') ||
        (b.getAttribute('title') || '').includes('保存中'),
    )
  await act(async () => {
    findMon().click()
  })
  await waitFor(() => assert.equal(deferred.length, 1), { timeout: 4000 })
  await act(async () => {
    findMon().click()
  })
  await waitFor(() => assert.equal(deferred.length, 2), { timeout: 4000 })
  // 先完成旧请求（开启），再完成新请求（关闭）
  const first = deferred[0]
  const second = deferred[1]
  assert.equal(first.body.monitorEnabled, true)
  assert.equal(second.body.monitorEnabled, false)
  mb.points[0].monitorEnabled = true
  mb.points[0].trendEnabled = true
  mb.configVersion += 1
  await act(async () => {
    first.resolve({
      ok: true,
      point: { ...mb.points[0] },
      configVersion: mb.configVersion,
      workspace: { modbus: { ...mb, points: mb.points.map((p) => ({ ...p })) } },
    })
    await new Promise((r) => setTimeout(r, 40))
  })
  // 最新 seq 是关闭；旧响应不得把 UI 锁在开启
  mb.points[0].monitorEnabled = false
  mb.points[0].trendEnabled = false
  mb.configVersion += 1
  await act(async () => {
    second.resolve({
      ok: true,
      point: { ...mb.points[0] },
      configVersion: mb.configVersion,
      workspace: { modbus: { ...mb, points: mb.points.map((p) => ({ ...p })) } },
    })
    await new Promise((r) => setTimeout(r, 60))
  })
  await waitFor(
    () => {
      assert.equal(findMon().getAttribute('aria-pressed'), 'false')
    },
    { timeout: 6000 },
  )
  tree.unmount()
})

test('监视与告警快速连续切换互不覆盖', async () => {
  const mb = baseMb()
  const posts = []
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
      posts.push(body)
      const pt = mb.points.find((p) => p.id === body.pointId)
      if (body.monitorEnabled !== undefined) {
        pt.monitorEnabled = body.monitorEnabled === true
        pt.trendEnabled = pt.monitorEnabled
      }
      if (body.alarmEnabled !== undefined) pt.alarmEnabled = body.alarmEnabled === true
      mb.configVersion += 1
      await new Promise((r) => setTimeout(r, 20))
      return {
        ok: true,
        point: { ...pt },
        configVersion: mb.configVersion,
        workspace: { modbus: { ...mb, points: mb.points.map((p) => ({ ...p })) } },
      }
    }
    return { ok: true }
  }
  const tree = await mount(post)
  const switches = Array.from(tree.container.querySelectorAll('button.dvb-switch'))
  const mon = switches.find((b) => (b.getAttribute('aria-label') || '').includes('可视化'))
  const alm = switches.find((b) => (b.getAttribute('aria-label') || '').includes('告警'))
  await act(async () => {
    mon.click()
    alm.click()
    await new Promise((r) => setTimeout(r, 120))
  })
  await waitFor(
    () => {
      assert.ok(posts.some((p) => p.monitorEnabled === true))
      assert.ok(posts.some((p) => p.alarmEnabled === true))
      assert.equal(mon.getAttribute('aria-pressed'), 'true')
      assert.equal(alm.getAttribute('aria-pressed'), 'true')
    },
    { timeout: 6000 },
  )
  tree.unmount()
})

function flagHarness(opts = {}) {
  const pack = {
    version: 3,
    configVersion: 10,
    connections: [{ id: 'c1', name: 'C1', conn: { mode: 'tcp', host: '127.0.0.1', sim: true } }],
    devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
    points: [
      {
        id: 'p1',
        connectionId: 'c1',
        deviceId: 'd1',
        name: '温度',
        function: 3,
        address: 0,
        monitorEnabled: false,
        alarmEnabled: false,
        trendEnabled: false,
        alarmMin: 1,
        alarmMax: 9,
      },
    ],
    values: [],
    pollingByConnection: {},
    framesByConnection: {},
    activeConnectionId: 'c1',
    activeDeviceId: 'd1',
  }
  let workspace = { modbus: structuredClone(pack) }
  const workspaceRef = { current: workspace }
  const flagPatches = []
  const errors = []
  const ctx = {
    t: (key) => key,
    post: opts.post,
    cwd: '/tmp/ws',
    commandClient: {
      refresh:
        opts.refresh ||
        (async () => {
          throw new Error('no refresh')
        }),
    },
    setError(msg) {
      errors.push(msg || '')
    },
    setWorkspace(updater) {
      const prev = workspace
      workspace = typeof updater === 'function' ? updater(workspace) : updater
      const before = prev.modbus.points.find((p) => p.id === 'p1')
      const after = workspace.modbus.points.find((p) => p.id === 'p1')
      if (before && after) {
        const patch = {}
        for (const key of ['monitorEnabled', 'trendEnabled', 'alarmEnabled']) {
          if (before[key] !== after[key]) patch[key] = after[key]
        }
        if (Object.keys(patch).length) flagPatches.push(patch)
      }
    },
    workspaceRef,
    flagInflight: { current: 0 },
    setEditingDeviceId() {},
    setEditingPointsDeviceId() {},
    deviceDraft: null,
    setDeviceDraft() {},
    pointDraftsById: {},
    setPointDraftsById() {},
    newPointDraft: null,
    setNewPointDraft() {},
    setInlineWrite() {},
    batch: {},
    setBatch() {},
    csvText: '',
    setCsvText() {},
    csvTarget: {},
    setCsvTarget() {},
    setCsvNote() {},
    setFlagSavingByPoint() {},
    flagRequestSeq: { current: {} },
  }
  const core = {
    normalizePack() {
      return workspaceRef.current.modbus
    },
    persist() {},
    activeConnIdOf() {
      return 'c1'
    },
  }
  return {
    actions: createHmiPointActions(ctx, core),
    flagPatches,
    errors,
    get error() {
      return errors[errors.length - 1] || ''
    },
    get point() {
      return workspace.modbus.points[0]
    },
    workspaceRef,
  }
}

test('监视失败不得把已成功的告警回滚掉', async () => {
  let resolveMon
  let resolveAlm
  const post = async (_path, body) => {
    if (body.monitorEnabled !== undefined) {
      return new Promise((resolve) => {
        resolveMon = resolve
      })
    }
    if (body.alarmEnabled !== undefined) {
      return new Promise((resolve) => {
        resolveAlm = resolve
      })
    }
    return { ok: true }
  }
  const h = flagHarness({ post })
  const mon = h.actions.persistPointFlags('p1', { monitorEnabled: true })
  const alm = h.actions.persistPointFlags('p1', { alarmEnabled: true })
  await new Promise((r) => setTimeout(r, 10))
  resolveAlm({
    ok: true,
    point: { id: 'p1', monitorEnabled: true, alarmEnabled: true, trendEnabled: true },
  })
  await alm
  resolveMon({ ok: false, error: 'monitor failed' })
  await mon
  assert.equal(h.point.monitorEnabled, false)
  assert.equal(h.point.alarmEnabled, true)
  const rollback = [...h.flagPatches].reverse().find((p) => p.monitorEnabled === false)
  assert.ok(rollback, '监视失败应回滚监视')
  assert.equal(Object.prototype.hasOwnProperty.call(rollback, 'alarmEnabled'), false)
})

test('告警失败不得把已成功的监视回滚掉', async () => {
  let resolveMon
  let resolveAlm
  const post = async (_path, body) => {
    if (body.monitorEnabled !== undefined) {
      return new Promise((resolve) => {
        resolveMon = resolve
      })
    }
    if (body.alarmEnabled !== undefined) {
      return new Promise((resolve) => {
        resolveAlm = resolve
      })
    }
    return { ok: true }
  }
  const h = flagHarness({ post })
  const mon = h.actions.persistPointFlags('p1', { monitorEnabled: true })
  const alm = h.actions.persistPointFlags('p1', { alarmEnabled: true })
  await new Promise((r) => setTimeout(r, 10))
  resolveMon({
    ok: true,
    point: { id: 'p1', monitorEnabled: true, alarmEnabled: false, trendEnabled: true },
  })
  await mon
  resolveAlm({ ok: false, error: 'alarm failed' })
  await alm
  assert.equal(h.point.monitorEnabled, true)
  assert.equal(h.point.trendEnabled, true)
  assert.equal(h.point.alarmEnabled, false)
  const rollback = [...h.flagPatches].reverse().find((p) => p.alarmEnabled === false)
  assert.ok(rollback, '告警失败应回滚告警')
  assert.equal(Object.prototype.hasOwnProperty.call(rollback, 'monitorEnabled'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(rollback, 'trendEnabled'), false)
})

test('网络异常后刷新点位以 Host 返回为准', async () => {
  const hostPoint = {
    id: 'p1',
    connectionId: 'c1',
    deviceId: 'd1',
    monitorEnabled: true,
    alarmEnabled: true,
    trendEnabled: true,
  }
  const h = flagHarness({
    post: async () => {
      throw new Error('offline')
    },
    refresh: async () => ({
      ok: true,
      workspace: {
        modbus: {
          version: 3,
          points: [hostPoint],
        },
      },
    }),
  })
  await h.actions.persistPointFlags('p1', { monitorEnabled: true })
  assert.equal(h.workspaceRef.current.modbus.points[0].monitorEnabled, true)
  assert.equal(h.workspaceRef.current.modbus.points[0].alarmEnabled, true)
})

test('保存失败且刷新失败时只回滚对应字段并显示错误', async () => {
  let resolveMon
  let resolveAlm
  const post = async (_path, body) => {
    if (body.monitorEnabled !== undefined) {
      return new Promise((resolve) => {
        resolveMon = resolve
      })
    }
    if (body.alarmEnabled !== undefined) {
      return new Promise((resolve) => {
        resolveAlm = resolve
      })
    }
    return { ok: true }
  }
  const h = flagHarness({
    post,
    refresh: async () => {
      throw new Error('refresh failed')
    },
  })
  const mon = h.actions.persistPointFlags('p1', { monitorEnabled: true })
  const alm = h.actions.persistPointFlags('p1', { alarmEnabled: true })
  await new Promise((r) => setTimeout(r, 10))
  resolveAlm({
    ok: true,
    point: { id: 'p1', monitorEnabled: true, alarmEnabled: true, trendEnabled: true },
    workspace: {
      modbus: {
        configVersion: 11,
        points: [{ id: 'p1', monitorEnabled: true, alarmEnabled: true, trendEnabled: true, alarmMin: 1, alarmMax: 9 }],
      },
    },
  })
  await alm
  resolveMon({ ok: false, error: 'monitor failed' })
  await mon
  assert.equal(h.point.monitorEnabled, false)
  assert.equal(h.point.trendEnabled, false)
  assert.equal(h.point.alarmEnabled, true)
  assert.match(h.error, /监视状态保存失败/)
})

test('CONFIG_DRIFT 刷新后携带新版本重试，监视和告警都保留', async () => {
  let calls = 0
  const hostPoint = {
    id: 'p1',
    connectionId: 'c1',
    deviceId: 'd1',
    name: '温度',
    monitorEnabled: true,
    alarmEnabled: true,
    trendEnabled: true,
    alarmMin: 1,
    alarmMax: 9,
  }
  const h = flagHarness({
    post: async (_path, body) => {
      calls += 1
      if (calls === 1) {
        assert.equal(body.monitorEnabled, true)
        assert.equal(body.expectedConfigVersion, 10)
        return { ok: false, errorCode: 'CONFIG_DRIFT', error: '点位配置已更新，请刷新后重试' }
      }
      assert.equal(body.expectedConfigVersion, 11)
      assert.equal(body.monitorEnabled, true)
      return {
        ok: true,
        point: hostPoint,
        configVersion: 12,
        workspace: { modbus: { version: 3, configVersion: 12, points: [hostPoint] } },
      }
    },
    refresh: async () => ({
      ok: true,
      workspace: {
        modbus: {
          version: 3,
          configVersion: 11,
          points: [{ ...hostPoint, monitorEnabled: false, trendEnabled: false, alarmEnabled: true }],
        },
      },
    }),
  })
  await h.actions.persistPointFlags('p1', { monitorEnabled: true })
  assert.equal(calls, 2)
  assert.equal(h.point.monitorEnabled, true)
  assert.equal(h.point.trendEnabled, true)
  assert.equal(h.point.alarmEnabled, true)
})
