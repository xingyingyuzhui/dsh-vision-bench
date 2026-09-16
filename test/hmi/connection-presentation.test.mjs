// Connection presentation structure (ADR-025 / react-unit).
// No HappyDOM — stub trees only. Page-runtime coverage lives in
// `connection-presentation-runtime.test.mjs`.
import assert from 'node:assert/strict'
import test from 'node:test'
import { renderConnectionOverview } from '../../src/ui/hmi/connection-overview.mjs'
import { renderConnectionPanel } from '../../src/ui/hmi/connection-panel.mjs'
import { connTabLabel } from '../../src/ui/hmi/connection-label.mjs'
import { renderConnectionTabs } from '../../src/ui/hmi/connection-tabs.mjs'
import { renderConnectionThead } from '../../src/ui/hmi/connection-thead.mjs'
import { renderConnectionWorkspace } from '../../src/ui/hmi/connection-workspace.mjs'
import { renderModalDialog } from '../../src/ui/components/modal-dialog.mjs'
import { renderDeviceCards } from '../../src/ui/hmi/device-card.mjs'
import { el } from '../helpers/react-unit.mjs'

test('连接表表头为四列：名称|角色|端点/状态|操作', () => {
  const thead = renderConnectionThead(el, (k) => ({ role: '角色' })[k] || k, {})
  const labels = thead.children[0].children.map((th) => {
    const span = th.children.find((c) => c && c.props && c.props.className === 'dvb-th-label')
    return span ? span.children[0] : null
  })
  assert.deepEqual(labels, ['名称', '角色', '端点/状态', '操作'])
})

test('连接总览挂载 connListPanel，单连接工作区挂载 deviceCardsPanel', () => {
  const t = (k) => k
  const ctx = {
    cwd: '/ws',
    sessionId: 's1',
    workspace: {},
    journal: {},
    pending: [],
    error: '',
    agentCopied: '',
    ioStatus: { kind: 'idle', labelKey: 'idle' },
    tabBar: null,
    focusToast: null,
    connListPanel: el('div', { 'data-panel': 'conn-list' }),
    connFormPanel: null,
    devFormPanel: null,
    deviceCardsPanel: el('div', { 'data-panel': 'device-cards' }),
    pendingPanel: null,
    statusBar: () => null,
    visionCollabBar: () => null,
  }
  const overview = renderConnectionOverview(el, t, ctx)
  const workspace = renderConnectionWorkspace(el, t, ctx)
  const flat = (node, out = []) => {
    if (!node) return out
    out.push(node)
    if (Array.isArray(node.children)) node.children.forEach((c) => flat(c, out))
    return out
  }
  assert.ok(
    flat(overview).some((n) => n.props && n.props['data-panel'] === 'conn-list'),
    'overview renders connection list panel',
  )
  assert.ok(
    flat(workspace).some((n) => n.props && n.props['data-panel'] === 'device-cards'),
    'workspace renders device cards panel',
  )
  assert.equal(
    flat(workspace).some((n) => n.props && n.props['data-panel'] === 'conn-list'),
    false,
    'single-connection workspace must not host the overview list',
  )
})

test('renderConnectionOverview 和 renderConnectionWorkspace 面对 object error 安全渲染字符串', () => {
  const t = (k) => k
  const ModalDialog = (props) => renderModalDialog(el, t, props)
  const ctx = {
    ModalDialog,
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
  const t = (k) => ({ connBar: '全部连接' })[k] || k
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
  const title = tree.children?.find((n) => n?.props?.className?.includes('dvb-conn-section-head'))
    ?.children?.find((n) => n?.props?.className === 'dvb-panel-title')
  assert.equal(title?.children?.[0], '全部连接')
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

test('connTabLabel 与二级页签一致：连接名 · COM号', () => {
  assert.equal(connTabLabel({ name: 'test1', conn: { mode: 'rtu', port: 'COM3' } }), 'test1 · COM3')
  assert.equal(connTabLabel({ name: '连接3', conn: { mode: 'rtu', port: 'COM1' } }), '连接3 · COM1')
  assert.equal(connTabLabel({ name: '网口', role: 'client', conn: { mode: 'tcp', host: '192.168.1.8', tcpPort: 502 } }), '网口 · 192.168.1.8:502')
  assert.equal(connTabLabel({ name: '仿真口', conn: { sim: true } }), '仿真口 · 仿真')
  assert.equal(connTabLabel(null), '')
})

test('renderDeviceCards has 连接/断开 button next to 添加设备 in panel-head, and no single 读取 button in toolbar', () => {
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
    activeConnObj: { id: 'c1', name: 'test1', conn: { mode: 'rtu', port: 'COM3' } },
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
  const title = treeDisconnected.children?.find((n) => n?.props?.className?.includes('dvb-dev-section-head'))
    ?.children?.find((n) => n?.props?.className === 'dvb-panel-title')
  assert.equal(title?.children?.[0], 'test1 · COM3', '设备区标题与二级页签同为 连接名 · COM号')
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
