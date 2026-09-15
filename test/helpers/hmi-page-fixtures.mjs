// @ts-check
/**
 * Shared fixtures for HMI page / connection / flags tests (P2-3).
 * Keeps makePost / mount / harness helpers in one place so split suites stay ≤350 lines.
 */
import assert from 'node:assert/strict'
import { act, render, waitFor } from '@testing-library/react'
import React from 'react'
import { createElement } from 'react'
import { createHmiView } from '../../bench-hmi.mjs'
import { createHmiLiveActions } from '../../src/ui/hmi/hmi-live-actions.mjs'
import { createHmiPointActions } from '../../src/ui/hmi/hmi-point-actions.mjs'
import { alpha3PageProps } from '../fixtures/harness-alpha3-props.mjs'
import { pageWindow as win } from './react-runtime.mjs'
import { connection, createBench } from './workspace-factory.mjs'

/** Default Modbus pack used by point-table UX suites. */
export const MB = {
  version: 3,
  configVersion: 7,
  connections: [
    {
      id: 'c1',
      name: 'C1',
      role: 'client',
      enabled: true,
      conn: { mode: 'rtu', port: 'COM3', baudrate: 9600, slave: 1, sim: true },
    },
  ],
  devices: [
    { id: 'd1', connectionId: 'c1', name: '设备1', unitId: 1 },
    { id: 'd2', connectionId: 'c1', name: '设备2', unitId: 2 },
  ],
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
      monitorEnabled: true,
      alarmEnabled: true,
      alarmMin: 18,
      alarmMax: 30,
    },
    {
      id: 'p2',
      connectionId: 'c1',
      deviceId: 'd2',
      name: '开关',
      function: 1,
      address: 0,
      scale: 1,
      offset: 0,
      unit: '',
      monitorEnabled: false,
      alarmEnabled: false,
    },
    {
      id: 'p3',
      connectionId: 'c1',
      deviceId: 'd1',
      name: '压力',
      function: 3,
      address: 1,
      scale: 1,
      offset: 0,
      unit: 'kPa',
      monitorEnabled: true,
      alarmEnabled: false,
    },
  ],
  values: [{ key: 'p1', pointId: 'p1', raw: 235, value: 23.5, ok: true, at: Date.now() }],
  alarmState: {},
  pollingByConnection: { c1: { enabled: false, intervalMs: 1000 } },
  framesByConnection: {},
}

/** Flags-race Modbus pack (single device, two points). */
export function baseMb() {
  return {
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
  }
}

/** i18n stub covering point-table + flags suites. */
export const t = (k) =>
  ({
    addPoint: '添加点位',
    batchAdd: '批量添加',
    batchGenerate: '生成',
    batchPrefix: '前缀',
    batchStart: '起始',
    batchCount: '数量',
    ptName: '名称',
    ptNamePh: '名称',
    ptFc: '功能码',
    ptAddr: '地址',
    ptUnit: '单位',
    colName: '名称',
    colFn: '功能码',
    colAddr: '地址',
    monitorOn: '监视',
    alarmOn: '告警',
    ptAlarmMin: '下限',
    ptAlarmMax: '上限',
    savePoint: '保存',
    csvCancel: '取消',
    csvImport: '导入 CSV',
    csvExport: '导出 CSV',
    readAll: '读取',
    devEdit: '编辑设备',
    ptEdit: '编辑点位',
    ptSave: '保存',
    devSave: '保存',
    editing: '编辑',
    deleteSegment: '删除',
    noPoints: '暂无点位',
    writing: '写入中…',
    quickWrite: '写入',
  })[k] || k

export const makePost = (mb = MB) => {
  const posts = []
  const post = async (path, body) => {
    posts.push([path, body || {}])
    if (/\/dsh-vision-bench\/state$/.test(path)) {
      return {
        ok: true,
        workspace: { modbus: mb, focus: null },
        journal: { tasks: [], running: [], timeline: [] },
        health: {},
        pendingWrites: [],
        connectionStates: [{ connectionId: 'c1', status: 'connected' }],
      }
    }
    if (/\/dsh-vision-bench\/serial\/ports$/.test(path)) return { ok: true, ports: ['COM3'] }
    if (/\/dsh-vision-bench\/modbus\/write$/.test(path)) {
      return {
        ok: true,
        values: [{ key: body.pointId, pointId: body.pointId, raw: 300, value: 30, ok: true, at: Date.now() }],
        framesLog: [],
      }
    }
    return { ok: true }
  }
  return { post, posts }
}

export async function selectConn(tree) {
  const connTab = Array.from(tree.container.querySelectorAll('.dvb-tab')).find((b) => b.textContent.includes('C1'))
  if (connTab) {
    await act(async () => {
      connTab.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    })
  }
  await new Promise((r) => setTimeout(r, 30))
}

/** Mount HMI page, select C1, wait for 温度 + switches (flags-race). */
export async function mountHmi(post) {
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

/** Connection-state workspace setup. */
export const setupConnBench = (tCtx, conns) => createBench(tCtx, { prefix: 'mcs-', shared: { connections: conns } })

export const fakeTransport = (rows) => ({
  listConnections: async () => ({ ok: true, data: { connections: rows } }),
  captureFeed: async () => ({ ok: true, data: { lines: [] } }),
  closeConnection: async () => ({ ok: true }),
})

/** Live actions harness for unlink/link/polling failure tests. */
export function liveHarness(opts = {}) {
  const pack = {
    version: 3,
    configVersion: 1,
    connections: [{ id: 'c1', name: 'C1', conn: { mode: 'tcp', host: '127.0.0.1', sim: false } }],
    devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
    points: [],
    values: [],
    pollingByConnection: { c1: { enabled: false, intervalMs: 1000 } },
    framesByConnection: {},
    activeConnectionId: 'c1',
    activeDeviceId: 'd1',
  }
  let workspace = { modbus: structuredClone(pack) }
  const workspaceRef = { current: workspace }
  let error = ''
  let linkBusy = ''
  let connectionStates = [{ connectionId: 'c1', status: 'connected' }]
  const posts = []
  const post =
    opts.post ||
    (async (path, body) => {
      posts.push({ path, body })
      throw new Error('missing post')
    })
  const ctx = {
    t: (key) => (key === 'fail' ? '失败' : key),
    post,
    cwd: '/tmp/ws',
    sessionId: 's1',
    setBusy() {},
    setError(value) {
      error = String(value || '')
    },
    setWorkspace(updater) {
      workspace = typeof updater === 'function' ? updater(workspace) : updater
    },
    setJournal() {},
    setConnectionStates(value) {
      connectionStates = value
    },
    workspaceRef,
    setNewPointDraft() {},
    inlineWrite: null,
    setInlineWrite() {},
    setLinkBusy(value) {
      linkBusy = value
    },
  }
  const core = {
    normalizePack() {
      return workspaceRef.current.modbus
    },
    persist: opts.persist || (async () => ({ ok: true })),
    derived() {
      const polling = workspace.modbus.pollingByConnection.c1
      return {
        activeConnId: 'c1',
        sim: false,
        watchEnabled: !!polling.enabled,
        polling,
        pollingByConnection: workspace.modbus.pollingByConnection,
        connections: workspace.modbus.connections,
      }
    },
  }
  return {
    actions: createHmiLiveActions(ctx, core),
    posts,
    get error() {
      return error
    },
    get linkBusy() {
      return linkBusy
    },
    get connectionStates() {
      return connectionStates
    },
    get workspace() {
      return workspace
    },
  }
}

/** Point-actions harness for flags persist / rollback tests. */
export function flagHarness(opts = {}) {
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
  let workspace = { modbus: structuredClone(pack), ...(opts.session ? { session: opts.session } : {}) }
  const workspaceRef = { current: workspace }
  const flagPatches = []
  const errors = []
  const ctx = {
    t: (key) => key,
    post: opts.post,
    cwd: '/tmp/ws',
    sessionId: opts.sessionId,
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

export { connection }
