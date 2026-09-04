// Task4/0.19.2: connection states are separate from serial-frame sources —
// TCP/sim never leak into 串口报文; hosts expose full connectionStates.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildFramePortOptions } from '../bench-frames-model.mjs'
import { listConnectedSerialSources, listConnectionStates } from '../bench-serial-monitor.mjs'
import { saveWorkspace } from '../bench-store.mjs'
import { renderConnectionForm } from '../src/ui/hmi/connection-form.mjs'
import { renderConnectionOverview } from '../src/ui/hmi/connection-overview.mjs'
import { renderConnectionPanel } from '../src/ui/hmi/connection-panel.mjs'
import { renderConnectionTabs } from '../src/ui/hmi/connection-tabs.mjs'
import { renderConnectionWorkspace } from '../src/ui/hmi/connection-workspace.mjs'
import { renderDeviceCards } from '../src/ui/hmi/device-card.mjs'
import { createHmiConnectionActions } from '../src/ui/hmi/hmi-connection-actions.mjs'
import { createHmiLiveActions } from '../src/ui/hmi/hmi-live-actions.mjs'

const cfg = (id, mode, port, extra = {}) => ({
  id,
  name: id,
  role: 'client',
  enabled: true,
  conn: { mode, port, host: mode === 'tcp' ? '192.168.1.50' : '', tcpPort: 502, baudrate: 9600, slave: 1, ...extra },
})

async function setup(conns) {
  const home = await mkdtemp(join(tmpdir(), 'mcs-'))
  const cwd = join(home, 'board')
  mkdirSync(cwd)
  saveWorkspace(home, cwd, { modbus: { version: 3, connections: conns, devices: [], points: [] } })
  return { home, cwd }
}

const fakeTransport = (rows) => ({
  listConnections: async () => ({ ok: true, data: { connections: rows } }),
  captureFeed: async () => ({ ok: true, data: { lines: [] } }),
  closeConnection: async () => ({ ok: true }),
})

test('connectionStates covers every configured RTU/TCP connection with live status', async () => {
  const { home, cwd } = await setup([cfg('c1', 'rtu', 'COM3'), cfg('c2', 'rtu', 'COM5'), cfg('c3', 'tcp', '')])
  const t = fakeTransport([
    { connectionId: 'c1', state: 'connected', connectedAt: 123, epoch: 'e1', error: '' },
    { connectionId: 'c2', state: 'error', error: 'USB 拔出', connectedAt: 0, epoch: 'e2' },
  ])
  const ran = await listConnectionStates(home, cwd, { transport: t })
  const byId = new Map(ran.connectionStates.map((s) => [s.connectionId, s]))
  assert.equal(ran.connectionStates.length, 3, 'all configured rtu+tcp connections present')
  assert.equal(byId.get('c1').status, 'connected')
  assert.equal(byId.get('c1').endpoint, 'COM3')
  assert.equal(byId.get('c1').connectedAt, 123)
  assert.equal(byId.get('c1').connectionEpoch, 'e1')
  assert.equal(byId.get('c2').status, 'error', 'unexpected disconnect surfaces as error')
  assert.equal(byId.get('c2').error, 'USB 拔出')
  assert.equal(byId.get('c3').status, 'disconnected', 'configured but never opened')
  assert.equal(byId.get('c3').endpoint, '192.168.1.50:502')
  assert.equal(byId.get('c3').mode, 'tcp')
  await rm(home, { recursive: true, force: true })
})

test('TCP never appears in serialSources even when connected', async () => {
  const { home, cwd } = await setup([cfg('c1', 'rtu', 'COM3'), cfg('c3', 'tcp', '')])
  const t = fakeTransport([
    { connectionId: 'c1', state: 'connected', connectedAt: 1, port: 'COM3' },
    { connectionId: 'c3', state: 'connected', connectedAt: 2, port: '192.168.1.50' },
  ])
  const ran = await listConnectedSerialSources(home, cwd, { transport: t })
  assert.deepEqual(
    ran.sources.map((s) => s.connectionId),
    ['c1'],
    'only the RTU connection is a serial source',
  )
  await rm(home, { recursive: true, force: true })
})

test('sim connections are excluded from both states and sources', async () => {
  const { home, cwd } = await setup([cfg('c4', 'rtu', 'COM7', { sim: true })])
  const t = fakeTransport([{ connectionId: 'c4', state: 'connected', connectedAt: 1, port: 'COM7' }])
  const st = await listConnectionStates(home, cwd, { transport: t })
  assert.equal(st.connectionStates.length, 0, 'sim excluded from connectionStates')
  const src = await listConnectedSerialSources(home, cwd, { transport: t })
  assert.equal(src.sources.length, 0)
  await rm(home, { recursive: true, force: true })
})

function liveHarness(opts = {}) {
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

test('断开连接抛出异常时显示错误并清除 busy，不伪装已断开', async () => {
  const h = liveHarness({
    post: async (path) => {
      if (path === '/dsh-vision-bench/connection/close') throw new Error('close exploded')
      if (path === '/dsh-vision-bench/state') {
        return { ok: true, connectionStates: [{ connectionId: 'c1', status: 'connected' }] }
      }
      return { ok: true }
    },
  })
  await Promise.resolve(h.actions.unlinkConnection('c1'))
  await new Promise((r) => setTimeout(r, 20))
  assert.match(h.error, /close exploded|失败/)
  assert.equal(h.linkBusy, '')
  assert.equal(h.connectionStates[0].status, 'connected')
})

test('断开连接返回 ok:false 时显示错误并刷新真实状态', async () => {
  const h = liveHarness({
    post: async (path) => {
      if (path === '/dsh-vision-bench/connection/close') return { ok: false, error: 'port busy' }
      if (path === '/dsh-vision-bench/state') {
        return { ok: true, connectionStates: [{ connectionId: 'c1', status: 'connected' }] }
      }
      return { ok: true }
    },
  })
  await Promise.resolve(h.actions.unlinkConnection('c1'))
  await new Promise((r) => setTimeout(r, 20))
  assert.match(h.error, /port busy/)
  assert.equal(h.linkBusy, '')
  assert.equal(h.connectionStates[0].status, 'connected')
})

test('关闭连接后 /state 刷新失败仍有错误提示并清除 busy', async () => {
  const h = liveHarness({
    post: async (path) => {
      if (path === '/dsh-vision-bench/connection/close') return { ok: true }
      if (path === '/dsh-vision-bench/state') throw new Error('state down')
      return { ok: true }
    },
  })
  await Promise.resolve(h.actions.unlinkConnection('c1'))
  await new Promise((r) => setTimeout(r, 20))
  assert.ok(h.error)
  assert.equal(h.linkBusy, '')
})

test('采集启动抛出异常时显示错误且不伪装已开始采集', async () => {
  const h = liveHarness({
    post: async (path) => {
      if (path === '/dsh-vision-bench/polling/start') throw new Error('poll exploded')
      if (path === '/dsh-vision-bench/state') {
        return {
          ok: true,
          workspace: { modbus: { pollingByConnection: { c1: { enabled: false, intervalMs: 1000 } } } },
        }
      }
      return { ok: true }
    },
  })
  await Promise.resolve(h.actions.toggleCollection())
  await new Promise((r) => setTimeout(r, 20))
  assert.match(h.error, /poll exploded|失败/)
  assert.equal(h.linkBusy, '')
  assert.equal(h.workspace.modbus.pollingByConnection.c1.enabled, false)
})

test('采集启动返回 ok:false 时显示错误', async () => {
  const h = liveHarness({
    post: async (path) => {
      if (path === '/dsh-vision-bench/polling/start') return { ok: false, error: 'already running' }
      if (path === '/dsh-vision-bench/state') {
        return {
          ok: true,
          workspace: { modbus: { pollingByConnection: { c1: { enabled: false, intervalMs: 1000 } } } },
        }
      }
      return { ok: true }
    },
  })
  await Promise.resolve(h.actions.toggleCollection())
  await new Promise((r) => setTimeout(r, 20))
  assert.match(h.error, /already running/)
  assert.equal(h.workspace.modbus.pollingByConnection.c1.enabled, false)
})

test('修改采集间隔失败时保留原间隔并显示错误', async () => {
  const posts = []
  const h = liveHarness({
    post: async (path, body) => {
      posts.push({ path, body })
      if (path === '/dsh-vision-bench/polling/start') return { ok: false, error: 'interval denied' }
      if (path === '/dsh-vision-bench/state') {
        return {
          ok: true,
          workspace: { modbus: { pollingByConnection: { c1: { enabled: false, intervalMs: 1000 } } } },
        }
      }
      return { ok: true }
    },
  })
  await Promise.resolve(h.actions.setPollingInterval(2000))
  await new Promise((r) => setTimeout(r, 20))
  assert.match(h.error, /interval denied/)
  assert.equal(h.workspace.modbus.pollingByConnection.c1.intervalMs, 1000)
  assert.equal(h.workspace.modbus.pollingByConnection.c1.enabled, false)
  assert.ok(posts.some((item) => item.path === '/dsh-vision-bench/polling/start'))
})

test('frames port options only offer connected RTU sources (no TCP, no sim, no open button surface)', async () => {
  const conns = [
    { id: 'c1', name: 'C1', conn: { mode: 'rtu', port: 'COM3' } },
    { id: 'c3', name: 'C3', conn: { mode: 'tcp', host: '192.168.1.50', tcpPort: 502 } },
    { id: 'c4', name: 'C4', conn: { mode: 'rtu', port: 'COM7', sim: true } },
  ]
  const opts = buildFramePortOptions(conns, [], 'proto', [
    { connectionId: 'c1', port: 'COM3', state: 'connected' },
    { connectionId: 'c3', port: '192.168.1.50', state: 'connected' },
    { connectionId: 'c4', port: 'COM7', state: 'connected' },
  ])
  assert.deepEqual(
    opts.map((o) => o.value),
    ['all', 'conn:c1'],
    'TCP + sim excluded from 串口报文 source options',
  )
})

test('连接失败返回结构化 error 对象时被安全转为文本，不抛出 React 渲染异常', async () => {
  const h = liveHarness({
    post: async (path) => {
      if (path === '/dsh-vision-bench/connection/open') {
        return { ok: false, error: { code: 'PORT_NOT_FOUND', message: '串口不存在' } }
      }
      if (path === '/dsh-vision-bench/state') {
        return { ok: true, connectionStates: [{ connectionId: 'c1', status: 'error', error: '串口不存在' }] }
      }
      return { ok: true }
    },
  })
  await Promise.resolve(h.actions.linkConnection('c1'))
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(typeof h.error, 'string')
  assert.equal(h.error, '串口不存在')
  assert.equal(h.linkBusy, '')
})

test('renderConnectionOverview 和 renderConnectionWorkspace 面对 object error 安全渲染字符串', () => {
  const el = (type, props, ...children) => ({ type, props, children: children.flat() })
  const t = (k) => k
  const ctx = {
    cwd: '/ws',
    sessionId: 's1',
    workspace: {},
    journal: {},
    pending: [],
    error: { code: 'PORT_NOT_FOUND', message: '串口不存在' },
    agentCopied: '',
    ioStatus: { kind: 'idle', labelKey: 'idle' },
    tabBar: null,
    focusToast: null,
    connListPanel: null,
    connFormPanel: null,
    devFormPanel: null,
    deviceCardsPanel: null,
    pendingPanel: null,
    statusBar: () => null,
    visionCollabBar: () => null,
  }
  const tree1 = renderConnectionOverview(el, t, ctx)
  const maskEl1 = tree1.children.find((c) => c && c.props && c.props.className === 'dvb-mask')
  assert.ok(maskEl1)
  const bodyEl1 = maskEl1.children[0].children.find((c) => c && c.props && c.props.className === 'dvb-dialog-body')
  assert.ok(bodyEl1)
  assert.equal(bodyEl1.children[0], '串口不存在')

  const tree2 = renderConnectionWorkspace(el, t, ctx)
  const maskEl2 = tree2.children.find((c) => c && c.props && c.props.className === 'dvb-mask')
  assert.ok(maskEl2)
  const bodyEl2 = maskEl2.children[0].children.find((c) => c && c.props && c.props.className === 'dvb-dialog-body')
  assert.ok(bodyEl2)
  assert.equal(bodyEl2.children[0], '串口不存在')
})

test('renderConnectionTabs renders permanent physical connection status dot with matching kind and tooltip', () => {
  const el = (type, props, ...children) => ({ type, props, children: children.flat().filter(Boolean) })
  const t = (k) => k
  const ctx = {
    pack: { points: [], values: [] },
    pending: [],
    journal: {},
    activeConnId: 'c1',
    connections: [
      { id: 'c1', name: 'PLC-1', conn: { mode: 'tcp', host: '192.168.1.10', tcpPort: 502 } },
      { id: 'c2', name: 'Sensor-2', conn: { mode: 'rtu', port: 'COM3' } },
      { id: 'c3', name: 'Meter-3', conn: { mode: 'tcp', host: '192.168.1.20', tcpPort: 502 } },
    ],
    connectionStates: [
      { connectionId: 'c1', status: 'connected' },
      { connectionId: 'c2', status: 'disconnected' },
      { connectionId: 'c3', status: 'error' },
    ],
    hmiTab: 'c2', // c2 is active tab, but c1 is connected, c2 is disconnected, c3 is error
    setHmiTab: () => {},
    moreOpen: false,
    setMoreOpen: () => {},
    selectConnection: () => {},
    findRtuOccupier: () => null,
    findTcpOccupier: () => null,
    cwd: '/mock',
    addConnection: () => {},
  }
  const tree = renderConnectionTabs(el, t, ctx)
  const tabs = tree.children.filter((c) => c && c.props && c.props.role === 'tab' && c.props.key)
  assert.equal(tabs.length, 3)

  // c1: live dot even though it's NOT the active tab
  const c1Dot = tabs[0].children.find((c) => c && c.props && c.props.className === 'dvb-tab-dot')
  assert.ok(c1Dot, 'c1 tab has permanent status dot')
  assert.equal(c1Dot.props['data-kind'], 'live')
  assert.equal(c1Dot.props.title, '状态: 已连接')

  // c2: idle dot even though it IS the active tab (no fake green light)
  const c2Dot = tabs[1].children.find((c) => c && c.props && c.props.className === 'dvb-tab-dot')
  assert.ok(c2Dot, 'c2 tab has permanent status dot')
  assert.equal(c2Dot.props['data-kind'], 'idle')
  assert.equal(c2Dot.props.title, '状态: 未连接')

  // c3: error dot
  const c3Dot = tabs[2].children.find((c) => c && c.props && c.props.className === 'dvb-tab-dot')
  assert.ok(c3Dot, 'c3 tab has permanent status dot')
  assert.equal(c3Dot.props['data-kind'], 'err')
  assert.equal(c3Dot.props.title, '状态: 连接异常')
})

test('renderConnectionPanel renders clean connection name without trailing black dot', () => {
  const el = (type, props, ...children) => ({ type, props, children: children.flat().filter(Boolean) })
  const t = (k) => k
  const ctx = {
    focusState: {},
    connections: [{ id: 'c1', name: 'PLC-1', conn: { mode: 'tcp', host: '192.168.1.10', tcpPort: 502 } }],
    cwd: '/mock',
    addConnection: () => {},
    activeConnObj: { id: 'c1' },
    sim: false,
    activeConnId: 'c1',
    toggleSim: () => {},
    watchEnabled: false,
    linkBusy: '',
    points: [],
    toggleCollection: () => {},
    polling: false,
    setPollingInterval: () => {},
    canDevice: false,
    connectionStates: [{ connectionId: 'c1', status: 'connected' }],
    selectConnection: () => {},
    findRtuOccupier: () => null,
    linkConnection: () => {},
    unlinkConnection: () => {},
    openConnEdit: () => {},
    sendToAgent: () => {},
    pendingDeleteId: null,
    setPendingDeleteId: () => {},
    requestDeleteConnection: () => {},
  }
  const tree = renderConnectionPanel(el, t, ctx)
  const rows = []
  function walk(node) {
    if (!node) return
    if (node.props && node.props['data-active']) rows.push(node)
    if (Array.isArray(node.children)) node.children.forEach(walk)
  }
  walk(tree)
  assert.equal(rows.length, 1)
  const nameBtn = rows[0].children[0].children[0]
  assert.equal(nameBtn.children[0], 'PLC-1', 'Name has no trailing ● black dot')
})

test('renderConnectionPanel toolbar does not have collection buttons or interval select', () => {
  const el = (type, props, ...children) => ({ type, props, children: children.flat().filter(Boolean) })
  const t = (k) => k
  const ctx = {
    focusState: {},
    connections: [{ id: 'c1', name: 'PLC-1', conn: { mode: 'tcp', host: '192.168.1.10', tcpPort: 502 } }],
    cwd: '/mock',
    addConnection: () => {},
    activeConnObj: { id: 'c1' },
    sim: false,
    activeConnId: 'c1',
    toggleSim: () => {},
    points: [],
    canDevice: false,
    connectionStates: [{ connectionId: 'c1', status: 'connected' }],
    selectConnection: () => {},
    findRtuOccupier: () => null,
    linkConnection: () => {},
    unlinkConnection: () => {},
    openConnEdit: () => {},
    sendToAgent: () => {},
    pendingDeleteId: null,
    setPendingDeleteId: () => {},
    requestDeleteConnection: () => {},
  }
  const tree = renderConnectionPanel(el, t, ctx)
  const buttons = []
  function walk(node) {
    if (!node) return
    if (node.type === 'button') buttons.push(node)
    if (node.type === 'select') buttons.push(node)
    if (Array.isArray(node.children)) node.children.forEach(walk)
  }
  walk(tree)
  const buttonTexts = buttons.map((b) => String(b.children?.[0] || ''))
  assert.ok(!buttonTexts.some((txt) => /开始采集|停止采集|collectStart|collectStop/.test(txt)))
  assert.ok(!buttons.some((b) => b.type === 'select'))
})

test('renderDeviceCards has 连接/断开 button next to 添加设备 in panel-head, and no single 读取 button in toolbar', () => {
  const el = (type, props, ...children) => ({ type, props, children: children.flat().filter(Boolean) })
  const t = (k) =>
    ({
      connLink: '连接',
      connUnlink: '断开',
      addDev: '＋添加设备',
      ptEdit: '编辑点位',
      csvImport: '导入 CSV',
      csvExport: '导出 CSV',
    })[k] || k

  const calls = []
  const ctx = {
    cwd: '/mock',
    activeConnId: 'c1',
    activeConnObj: { id: 'c1', name: 'COM3' },
    canDevice: true,
    openAddDevice: () => calls.push('openAddDevice'),
    linkConnection: (id) => calls.push(`link:${id}`),
    unlinkConnection: (id) => calls.push(`unlink:${id}`),
    linkBusy: '',
    connectionStates: [{ connectionId: 'c1', status: 'disconnected' }],
    devForm: { open: false },
    activeDevices: [{ id: 'd1', name: 'Dev 1', unitId: 1, connectionId: 'c1' }],
    devices: [{ id: 'd1', name: 'Dev 1', unitId: 1, connectionId: 'c1' }],
    points: [],
    editingDeviceId: '',
    devDeleteId: '',
    deviceDraft: null,
    pointsOfDevice: () => [],
    editingPointsDeviceId: '',
    openEditDevice: () => {},
    requestDeleteDevice: () => {},
    enterPointsEdit: () => {},
    setCsvTarget: () => {},
    setCsvText: () => {},
    setCsvNote: () => {},
    sendToAgent: () => {},
    readAll: () => calls.push('readAll'),
  }

  // 1. In disconnected state: button shows "连接"
  const treeDisconnected = renderDeviceCards(el, t, ctx)
  const headButtons = []
  function walkHead(node) {
    if (!node) return
    if (node.props?.className?.includes('dvb-panel-head')) {
      node.children?.forEach((child) => {
        if (child?.type === 'button') headButtons.push(child)
      })
    }
    if (Array.isArray(node.children)) node.children.forEach(walkHead)
  }
  walkHead(treeDisconnected)
  assert.equal(headButtons.length, 2, 'panel-head has ＋添加设备 and 连接/断开')
  assert.equal(headButtons[0].children[0], '＋添加设备')
  assert.equal(headButtons[1].children[0], '连接')

  // Clicking "连接" invokes linkConnection('c1')
  headButtons[1].props.onClick()
  assert.deepEqual(calls, ['link:c1'])

  // 2. In connected state: button shows "断开"
  ctx.connectionStates = [{ connectionId: 'c1', status: 'connected' }]
  const treeConnected = renderDeviceCards(el, t, ctx)
  const connectedHeadButtons = []
  function walkConnectedHead(node) {
    if (!node) return
    if (node.props?.className?.includes('dvb-panel-head')) {
      node.children?.forEach((child) => {
        if (child?.type === 'button') connectedHeadButtons.push(child)
      })
    }
    if (Array.isArray(node.children)) node.children.forEach(walkConnectedHead)
  }
  walkConnectedHead(treeConnected)
  assert.equal(connectedHeadButtons[1].children[0], '断开')

  // 3. Equipment toolbar does NOT contain single "读取" (readAll) button
  const toolbarButtons = []
  function walkToolbar(node) {
    if (!node) return
    if (node.props?.className?.includes('dvb-toolbar')) {
      node.children?.forEach((child) => {
        if (child?.type === 'button') toolbarButtons.push(child)
      })
    }
    if (Array.isArray(node.children)) node.children.forEach(walkToolbar)
  }
  walkToolbar(treeConnected)
  const toolbarTexts = toolbarButtons.map((b) => String(b.children?.[0] || ''))
  assert.ok(!toolbarTexts.includes('读取'), 'toolbar has no single 读取 button')
  assert.ok(!toolbarTexts.includes('readAll'), 'toolbar has no readAll button')
  assert.deepEqual(toolbarTexts, ['编辑点位', '导入 CSV', '导出 CSV', 'AI'])
})

test('renderConnectionForm displays 采集间隔 select, openConnEdit and saveConnEdit persist intervalMs', async () => {
  const el = (type, props, ...children) => ({ type, props, children: children.flat().filter(Boolean) })
  const t = (k) =>
    ({ watchIv: '采集间隔', csvCancel: '取消', connSave: '保存配置', role: '角色', mode: '模式' })[k] || k
  const field = (label, control) => ({ type: 'field', label, control })

  let connForm = { open: false }
  const ctx = {
    connForm: {
      open: true,
      id: 'c1',
      name: 'Link 1',
      role: 'client',
      intervalMs: 2000,
      conn: { mode: 'rtu', port: 'COM1', baudrate: 9600 },
    },
    setConnForm: (updater) => {
      connForm = typeof updater === 'function' ? updater(connForm) : updater
    },
    connectionStates: [],
    field,
    scanning: false,
    ports: [],
    findRtuOccupier: () => null,
    findTcpOccupier: () => null,
    scanPorts: () => {},
    cwd: '/mock',
    saveConnEdit: () => {},
  }

  const formTree = renderConnectionForm(el, t, ctx)
  let foundIntervalField = false
  let headButtons = []
  let actionButtons = []
  function walkForm(node) {
    if (!node) return
    if (node.type === 'field' && node.label === '采集间隔') {
      foundIntervalField = true
      assert.equal(node.control.props.value, 2000)
    }
    if (node.props?.className?.includes('dvb-panel-head')) {
      node.children?.forEach((child) => {
        if (child?.type === 'button') headButtons.push(child)
      })
    }
    if (node.props?.className?.includes('dvb-actions')) {
      node.children?.forEach((child) => {
        if (child?.type === 'button') actionButtons.push(child)
      })
    }
    if (Array.isArray(node.children)) node.children.forEach(walkForm)
  }
  walkForm(formTree)
  assert.ok(foundIntervalField, 'Connection edit form includes 采集间隔 field')
  assert.equal(headButtons.length, 0, 'No cancel button in panel head')
  assert.equal(actionButtons.length, 2, 'Two action buttons at bottom')
  assert.equal(actionButtons[0].children[0], '保存配置')
  assert.equal(actionButtons[1].children[0], '取消')

  // Test openConnEdit and saveConnEdit
  let persistedPack = null
  const posts = []
  const actionCtx = {
    cwd: '/mock',
    post: async (url, body) => {
      posts.push({ url, body })
      return { ok: true }
    },
    setError: () => {},
    setFrameFilter: () => {},
    setDevForm: () => {},
    connForm: {
      id: 'c1',
      name: 'New Link 1',
      role: 'client',
      intervalMs: 500,
      conn: { mode: 'rtu', port: 'COM2', baudrate: 115200 },
    },
    setConnForm: (updater) => {
      connForm = typeof updater === 'function' ? updater(connForm) : updater
    },
    setHmiTab: () => {},
    setMoreOpen: () => {},
    pendingDeleteId: '',
    setPendingDeleteId: () => {},
    lastDeviceByConn: { current: {} },
  }
  const pack = {
    connections: [{ id: 'c1', name: 'Old Link', role: 'client', conn: { mode: 'rtu', port: 'COM1', baudrate: 9600 } }],
    devices: [],
    points: [],
    pollingByConnection: { c1: { enabled: true, intervalMs: 1000 } },
  }
  const core = {
    normalizePack: () => pack,
    persist: (patch) => {
      persistedPack = patch
    },
    activeConnIdOf: () => 'c1',
  }
  const actions = createHmiConnectionActions(actionCtx, core)

  actions.openConnEdit(pack.connections[0])
  assert.equal(connForm.intervalMs, 1000, 'openConnEdit extracts intervalMs from pollingByConnection')

  actions.saveConnEdit()
  assert.equal(persistedPack.pollingByConnection.c1.intervalMs, 500, 'saveConnEdit saves updated intervalMs')
  assert.equal(posts.length, 1, 'saveConnEdit updates running polling service')
  assert.equal(posts[0].url, '/dsh-vision-bench/polling/start')
  assert.equal(posts[0].body.intervalMs, 500)
})

test('linkConnection starts polling with intervalMs, and unlinkConnection stops polling', async () => {
  const posts = []
  const h = liveHarness({
    post: async (path, body) => {
      posts.push({ path, body })
      if (path === '/dsh-vision-bench/connection/open') return { ok: true }
      if (path === '/dsh-vision-bench/polling/start') return { ok: true }
      if (path === '/dsh-vision-bench/polling/stop') return { ok: true }
      if (path === '/dsh-vision-bench/connection/close') return { ok: true }
      if (path === '/dsh-vision-bench/state') {
        return { ok: true, connectionStates: [{ connectionId: 'c1', status: 'connected' }] }
      }
      return { ok: true }
    },
  })

  // 1. linkConnection
  await h.actions.linkConnection('c1')
  const openCall = posts.find((p) => p.path === '/dsh-vision-bench/connection/open')
  const startCall = posts.find((p) => p.path === '/dsh-vision-bench/polling/start')
  assert.ok(openCall, 'open connection called')
  assert.ok(startCall, 'polling start called')
  assert.equal(startCall.body.connectionId, 'c1')
  assert.equal(startCall.body.intervalMs, 1000)

  // 2. unlinkConnection
  posts.length = 0
  await h.actions.unlinkConnection('c1')
  const stopCall = posts.find((p) => p.path === '/dsh-vision-bench/polling/stop')
  const closeCall = posts.find((p) => p.path === '/dsh-vision-bench/connection/close')
  assert.ok(stopCall, 'polling stop called')
  assert.ok(closeCall, 'close connection called')
  assert.equal(stopCall.body.connectionId, 'c1')
  assert.equal(closeCall.body.connectionId, 'c1')
})

test('renderConnectionForm serial select does not show 未发现串口, provides COM1-COM20 and custom input', async () => {
  const el = (type, props, ...children) => ({ type, props, children: children.flat().filter(Boolean) })
  const t = (k) =>
    ({ serial: '串口', serialPick: '选择串口', serialScan: '刷新', csvCancel: '取消', connSave: '保存配置' })[k] || k
  const field = (label, control) => ({ type: 'field', label, control })

  let connForm = {
    open: true,
    id: 'c2',
    name: '连接2',
    role: 'server',
    conn: { mode: 'rtu', port: '', baudrate: 9600 },
  }
  const ctx = {
    connForm,
    setConnForm: (updater) => {
      connForm = typeof updater === 'function' ? updater(connForm) : updater
    },
    connectionStates: [],
    field,
    scanning: false,
    ports: [],
    findRtuOccupier: () => null,
    findTcpOccupier: () => null,
    scanPorts: () => {},
    cwd: '/mock',
    saveConnEdit: () => {},
  }

  // 1. Dropdown mode when no ports scanned
  const formTree = renderConnectionForm(el, t, ctx)
  let serialControl = null
  function walk(node) {
    if (!node) return
    if (node.type === 'field' && node.label === '串口') {
      serialControl = node.control
    }
    if (Array.isArray(node.children)) node.children.forEach(walk)
  }
  walk(formTree)
  assert.ok(serialControl, 'Found serial field')

  // Find CustomSelect child
  const selectNode = serialControl.children.find((c) => c.props?.options)
  assert.ok(selectNode, 'CustomSelect node exists')
  assert.equal(selectNode.props.placeholder, '选择串口', 'Placeholder is not 未发现串口')

  const optionLabels = selectNode.props.options.map((o) => o.label)
  assert.ok(!optionLabels.includes('未发现串口'), 'Does not contain 未发现串口 option')
  assert.ok(optionLabels.includes('COM1'), 'Contains COM1')
  assert.ok(optionLabels.includes('COM2'), 'Contains COM2')
  assert.ok(optionLabels.includes('COM20'), 'Contains COM20')
  assert.ok(
    optionLabels.some((l) => l.includes('手动输入')),
    'Contains custom manual input option',
  )

  // 2. Custom input mode
  ctx.connForm = { ...connForm, customPort: true, conn: { ...connForm.conn, port: '/dev/ttyUSB0' } }
  const customTree = renderConnectionForm(el, t, ctx)
  let customInput = null
  let listSelectBtn = null
  function walkCustom(node) {
    if (!node) return
    if (node.control) walkCustom(node.control)
    if (node.type === 'input' && node.props?.value === '/dev/ttyUSB0') customInput = node
    if (node.type === 'button' && node.children?.[0] === '列表选择') listSelectBtn = node
    if (Array.isArray(node.children)) node.children.forEach(walkCustom)
  }
  walkCustom(customTree)
  assert.ok(customInput, 'Rendered custom text input')
  assert.ok(listSelectBtn, 'Rendered 列表选择 button to switch back')
})
