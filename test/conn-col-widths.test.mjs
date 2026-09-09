import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_CONN_COL_WIDTHS,
  MIN_CONN_COL_WIDTHS,
  sanitizeConnColWidths,
  loadConnColWidths,
  saveConnColWidths,
  useConnColWidths,
} from '../src/ui/hmi/hooks/use-conn-col-widths.mjs'
import { renderConnectionThead } from '../src/ui/hmi/connection-thead.mjs'
import { renderConnectionPanel } from '../src/ui/hmi/connection-panel.mjs'

test('sanitizeConnColWidths 规范化列宽数据并进行边界限制', () => {
  const fallback = sanitizeConnColWidths(null)
  assert.deepEqual(fallback, DEFAULT_CONN_COL_WIDTHS)

  const custom = {
    name: 240,
    role: 150,
    endpoint: 350,
    actions: 300,
  }
  const sanitized = sanitizeConnColWidths(custom)
  assert.equal(sanitized.name, 240)
  assert.equal(sanitized.role, 150)
  assert.equal(sanitized.endpoint, 350)
  assert.equal(sanitized.actions, 300)

  // 边界保护：低于最小值限制
  const tooSmall = sanitizeConnColWidths({
    name: 10,
    role: 20,
    endpoint: 30,
    actions: 40,
  })
  assert.equal(tooSmall.name, MIN_CONN_COL_WIDTHS.name)
  assert.equal(tooSmall.role, MIN_CONN_COL_WIDTHS.role)
  assert.equal(tooSmall.endpoint, MIN_CONN_COL_WIDTHS.endpoint)
  assert.equal(tooSmall.actions, MIN_CONN_COL_WIDTHS.actions)
})

test('loadConnColWidths 与 saveConnColWidths 健全容错与持久化', () => {
  const store = {}
  globalThis.localStorage = {
    getItem(key) {
      return store[key] || null
    },
    setItem(key, val) {
      store[key] = String(val)
    },
  }

  // 初始加载返回默认值
  const initial = loadConnColWidths()
  assert.deepEqual(initial, DEFAULT_CONN_COL_WIDTHS)

  // 保存自定义列宽并重新加载
  saveConnColWidths({ name: 220, role: 90, endpoint: 280, actions: 310 })
  const reloaded = loadConnColWidths()
  assert.equal(reloaded.name, 220)
  assert.equal(reloaded.role, 90)
  assert.equal(reloaded.endpoint, 280)
  assert.equal(reloaded.actions, 310)

  // 损坏的 JSON 容错
  store['dvb_conn_col_widths'] = 'not-a-valid-json{{'
  const safeFallback = loadConnColWidths()
  assert.deepEqual(safeFallback, DEFAULT_CONN_COL_WIDTHS)
})

test('useConnColWidths Hook 提供初始状态、重置列宽与总宽计算', () => {
  let stateVal = null
  const React = {
    useState: (init) => {
      stateVal = typeof init === 'function' ? init() : init
      const setter = (next) => {
        stateVal = typeof next === 'function' ? next(stateVal) : next
      }
      return [stateVal, setter]
    },
    useRef: (init) => ({ current: init }),
    useCallback: (fn) => fn,
  }

  const hook = useConnColWidths(React)
  assert.ok(hook.connColWidths)
  assert.equal(typeof hook.onStartConnResize, 'function')
  assert.equal(typeof hook.resetConnColWidth, 'function')
  assert.equal(typeof hook.totalConnTableWidth, 'function')

  const total = hook.totalConnTableWidth()
  const expectedTotal =
    DEFAULT_CONN_COL_WIDTHS.name +
    DEFAULT_CONN_COL_WIDTHS.role +
    DEFAULT_CONN_COL_WIDTHS.endpoint +
    DEFAULT_CONN_COL_WIDTHS.actions
  assert.equal(total, expectedTotal)

  // 重置单列
  hook.resetConnColWidth('role')
  assert.equal(stateVal.role, DEFAULT_CONN_COL_WIDTHS.role)
})

test('renderConnectionThead 渲染4列并在表头内置 dvb-col-resizer 拖拽句柄', () => {
  const el = (type, props, ...children) => ({ type, props, children: children.flat().filter(Boolean) })
  const t = (k) => k

  let resizedKey = null
  let resetKey = null
  const thead = renderConnectionThead(el, t, {
    connColWidths: { name: 200, role: 120, endpoint: 300, actions: 260 },
    onStartResize: (key) => {
      resizedKey = key
    },
    resetColWidth: (key) => {
      resetKey = key
    },
  })

  assert.equal(thead.type, 'thead')
  const tr = thead.children[0]
  assert.equal(tr.children.length, 4)

  const thCols = tr.children
  assert.equal(thCols[0].props.className, 'dvb-col-name')
  assert.equal(thCols[0].props.style.width, '200px')
  assert.equal(thCols[1].props.className, 'dvb-col-role')
  assert.equal(thCols[1].props.style.width, '120px')
  assert.equal(thCols[2].props.className, 'dvb-col-endpoint')
  assert.equal(thCols[2].props.style.width, '300px')
  assert.equal(thCols[3].props.className, 'dvb-col-actions')
  assert.equal(thCols[3].props.style.width, '260px')

  // 验证每个 th 均包含标题与拖拽手柄
  for (const th of thCols) {
    const label = th.children.find((c) => c.props?.className === 'dvb-th-label')
    const resizer = th.children.find((c) => c.props?.className === 'dvb-col-resizer')
    assert.ok(label, 'th contains dvb-th-label')
    assert.ok(resizer, 'th contains dvb-col-resizer')
    assert.ok(resizer.props.onPointerDown, 'resizer has onPointerDown')
    assert.ok(resizer.props.onDoubleClick, 'resizer has onDoubleClick')
  }

  // 触发一次事件回调
  thCols[0].children[1].props.onPointerDown()
  assert.equal(resizedKey, 'name')
  thCols[1].children[1].props.onDoubleClick()
  assert.equal(resetKey, 'role')
})

test('renderConnectionPanel 采用 dvb-conn-table 与 dvb-conn-actions 且各列包含对应 class', () => {
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
    connColWidths: DEFAULT_CONN_COL_WIDTHS,
    onStartConnResize: () => {},
    resetConnColWidth: () => {},
    totalConnTableWidth: () => 810,
  }

  const panel = renderConnectionPanel(el, t, ctx)
  let table = null
  let actionsDiv = null
  function walk(node) {
    if (!node) return
    if (node.type === 'table' && String(node.props?.className).includes('dvb-conn-table')) {
      table = node
    }
    if (node.props?.className && String(node.props.className).includes('dvb-conn-actions')) {
      actionsDiv = node
    }
    if (Array.isArray(node.children)) node.children.forEach(walk)
  }
  walk(panel)

  assert.ok(table, 'renders dvb-conn-table')
  assert.equal(table.props.style.minWidth, '100%')
  assert.equal(table.props.style.width, '810px')

  assert.ok(actionsDiv, 'renders dvb-conn-actions container')
  // 检查操作栏包含的所有按钮
  const btnLabels = actionsDiv.children.map((b) => b.children?.[0])
  assert.ok(btnLabels.some((l) => ['断开', '连接', '已连接', 'connLive', 'connUnlink'].includes(l)))
  assert.ok(btnLabels.includes('编辑'))
  assert.ok(btnLabels.includes('AI'))
  assert.ok(btnLabels.some((l) => ['删除', 'removeDevice'].includes(l)))
})
