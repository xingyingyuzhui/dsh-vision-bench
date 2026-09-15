import assert from 'node:assert/strict'
import test from 'node:test'
import { renderConnectionForm } from '../../src/ui/hmi/connection-form.mjs'
import { createHmiConnectionActions } from '../../src/ui/hmi/hmi-connection-actions.mjs'

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

test('连接编辑器不提供站号/单元字段', () => {
  const el = (type, props, ...children) => ({ type, props, children: children.flat().filter(Boolean) })
  const t = (k) =>
    ({ watchIv: '采集间隔', role: '角色', mode: '模式', serial: '串口', csvCancel: '取消', connSave: '保存配置' })[k] || k
  const field = (label, control) => ({ type: 'field', label, control })
  const texts = []
  function walk(node) {
    if (!node) return
    if (typeof node === 'string' || typeof node === 'number') texts.push(String(node))
    if (node.type === 'field') texts.push(String(node.label || ''))
    if (node.control) walk(node.control)
    if (Array.isArray(node.children)) node.children.forEach(walk)
  }
  walk(
    renderConnectionForm(el, t, {
      connForm: {
        open: true,
        id: 'c1',
        name: 'Link 1',
        role: 'client',
        intervalMs: 1000,
        conn: { mode: 'rtu', port: 'COM1', baudrate: 9600 },
      },
      setConnForm: () => {},
      connectionStates: [],
      field,
      scanning: false,
      ports: ['COM1'],
      findRtuOccupier: () => null,
      findTcpOccupier: () => null,
      scanPorts: () => {},
      cwd: '/mock',
      saveConnEdit: () => {},
    }),
  )
  const blob = texts.join(' ')
  assert.ok(blob.length > 0, 'form rendered')
  assert.equal(/站号\/单元|站号|单元号/.test(blob), false, 'connection editor must not expose 站号/单元')
})
