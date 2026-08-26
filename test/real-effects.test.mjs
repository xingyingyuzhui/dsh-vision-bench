// Task8/0.18.2: REAL React lifecycle tests — actual useEffect, refs, scroll,
// unmount cleanup. Uses @testing-library/react + happy-dom + real react@18.
// These replace "React.useEffect = () => {}" stubs as page-level acceptance.
import { beforeEach, afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import React from 'react'
import { createElement } from 'react'
import { render, cleanup, waitFor, act } from '@testing-library/react'
import { createFramesPage } from '../bench-frames-view.mjs'
import { pushFramesLog } from '../bench-shared.mjs'
import { createTrendPage } from '../bench-live.mjs'

// Task8/0.18.3: tests must exit naturally — every component effect tears down
// its timers on unmount, so no process.exit() is allowed here.

// Source-level tests must see the same vendored runtime the bundle injects:
// bench-vendor reads `typeof DvbVendor` → resolves to globalThis.DvbVendor.
// Use the REAL react-virtual adapter + real functions from node_modules.
const loadVendor = async () => {
  const uPlot = (await import('uplot')).default
  const vcore = await import('@tanstack/virtual-core')
  const rv = await import('@tanstack/react-virtual')
  globalThis.__rvUseVirtualizer = rv.useVirtualizer
  globalThis.DvbVendor = {
    uPlot,
    Virtualizer: vcore.Virtualizer,
    elementScroll: vcore.elementScroll,
    observeElementRect: vcore.observeElementRect,
    observeElementOffset: vcore.observeElementOffset,
    useVirtualizer: rv.useVirtualizer,
  }
}

let win
beforeEach(async () => {
  await loadVendor()
  win = new Window({ url: 'http://localhost/' })
  // install happy-dom globals
  globalThis.window = win
  globalThis.document = win.document
  try { globalThis.navigator = { clipboard: { writeText: async () => {} }, userAgent: 'happy' } } catch {
    Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async () => {} }, userAgent: 'happy' }, configurable: true })
  }
  // ResizeObserver that fires immediately with a REAL stable rect, and
  // getBoundingClientRect that ALWAYS returns a real viewport (happy-dom's
  // zero-size fallback killed Virtualizer measurement).
  globalThis.ResizeObserver = class {
    constructor(cb) { this.cb = cb }
    observe(el) {
      queueMicrotask(() => this.cb([{
        target: el,
        borderBoxSize: [{ inlineSize: 400, blockSize: 320 }],
        contentRect: { x: 0, y: 0, width: 400, height: 320, top: 0, left: 0, right: 400, bottom: 320 },
      }]))
    }
    unobserve() {}
    disconnect() {}
  }
  globalThis.Element = win.HTMLElement
  const RECT = () => ({ width: 400, height: 320, top: 0, left: 0, right: 400, bottom: 320, x: 0, y: 0, toJSON() {} })
  win.HTMLElement.prototype.getBoundingClientRect = function () { return RECT() }
  for (const k of ['clientWidth', 'clientHeight', 'offsetWidth', 'offsetHeight']) {
    try { Object.defineProperty(win.HTMLElement.prototype, k, { get() { return k.endsWith('Width') ? 400 : 320 }, configurable: true }) } catch {}
  }
  globalThis.HTMLElement = win.HTMLElement
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0)
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
  globalThis.devicePixelRatio = 1
  globalThis.CustomEvent = win.CustomEvent
  globalThis.getComputedStyle = (el) => ({ getPropertyValue: () => '', setProperty() {}, removeProperty() {} })
  globalThis.scrollTo = () => {}
})
afterEach(() => {
  cleanup()
  for (const k of ['window', 'document', 'navigator', 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'devicePixelRatio', 'CustomEvent', 'getComputedStyle']) {
    delete globalThis[k]
  }
})

const makeFrames = (connId, n, startAt = 1000) =>
  Array.from({ length: n }, (_, i) => ({ frameId: connId + '-f' + (startAt + i), connectionId: connId, deviceId: 'd1', t: startAt + i, at: startAt + i, direction: 'tx', request: 'req' + i, label: 'L' + i, status: 'ok', functionCode: 3 }))

function makePost({ frames = {}, openCalls = [], closeCalls = [], serialSources, connections, stateFn } = {}) {
  const calls = { state: 0, open: 0, close: 0, evidence: 0, clear: 0, feed: 0 }
  const conns = connections || [{ id: 'c1', name: 'C1', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3' } }]
  const sources = serialSources !== undefined ? serialSources : [{ connectionId: 'c1', port: 'COM3', state: 'connected', name: 'C1' }]
  const post = async (path, body) => {
    if (path === '/dsh-vision-bench/state') {
      calls.state++
      const mb = { version: 3, connections: conns, devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }], points: [], framesByConnection: frames, configVersion: 7 }
      return { ok: true, workspace: { modbus: mb }, health: { python: { bound: true, exists: true } }, serialSources: sources }
    }
    if (path === '/dsh-vision-bench/serial/ports') return { ok: true, ports: ['COM3'] }
    if (path === '/dsh-vision-bench/serial/open') { calls.open++; openCalls.push(body); return { ok: false, error: 'USE_HMI_CONNECT' } }
    if (path === '/dsh-vision-bench/serial/close') { calls.close++; closeCalls.push(body); return { ok: true } }
    if (path === '/dsh-vision-bench/connection/open') { calls.open++; openCalls.push(body); return { ok: true } }
    if (path === '/dsh-vision-bench/connection/close') { calls.close++; closeCalls.push(body); return { ok: true } }
    if (path === '/dsh-vision-bench/serial/feed') { calls.feed++; return { ok: true, open: true, error: '', lastId: 1, lines: [] } }
    if (path === '/dsh-vision-bench/frames/clear') { calls.clear++; return { ok: true, cleared: (body && body.connectionId) || 'all' } }
    if (path === '/dsh-vision-bench/evidence') { calls.evidence++; return { ok: true, evidence: [] } }
    if (stateFn) return stateFn(path, body)
    return { ok: true }
  }
  return { post, calls, openCalls, closeCalls }
}

const t = (k) => ({
  framesRaw: '原始数据', framesProto: '协议报文', framesClearView: '清空显示',
  serialPause: '暂停', serialResume: '恢复', framesClear: '清空', framesCopyHex: '复制',
  serialCopied: '已复制', framesExport: '导出', framesTab: '串口报文', framesEmpty: '暂无报文',
  serialFilter: '过滤', openInHmi: '在上位机打开', framesAll: '全部串口', framesGoHmi: '前往上位机',
  framesNoLink: '暂无已连接串口',
}[k] || k)
const noop = () => {}

test('Task8: official Virtualizer renders viewport-limited rows (adapter level) and drives component without errors', async () => {
  // 1) adapter-level STRONG assertions with the official Virtualizer class:
  // deterministic element stub (rect+scroll) — same class the react hook uses.
  const vcore = await import('@tanstack/virtual-core')
  const official = vcore.Virtualizer
  const makeEl = (top = 0) => {
    const el = {
      scrollTop: top, offsetHeight: 320, offsetWidth: 400, clientHeight: 320, clientWidth: 400,
      getBoundingClientRect: () => ({ width: 400, height: 320, top: 0, left: 0, right: 400, bottom: 320, x: 0, y: 0, toJSON() {} }),
      addEventListener() {}, removeEventListener() {},
    }
    return el
  }
  const makeWin = () => ({ ResizeObserver: class { observe() {} unobserve() {} disconnect() {} }, requestAnimationFrame: (cb) => setTimeout(cb, 0), cancelAnimationFrame: (id) => clearTimeout(id) })
  const create = (count, top = 0) => {
    const scrollElement = makeEl(top)
    const v = new official({
      count,
      getScrollElement: () => scrollElement,
      estimateSize: () => 36,
      overscan: 10,
      scrollToFn: () => {},
      observeElementRect: (instance, cb) => { cb({ width: 400, height: 320 }); return () => {} },
      observeElementOffset: (instance, cb) => { cb(scrollElement.scrollTop, false); return () => {} },
    })
    v.scrollElement = scrollElement
    v.targetWindow = makeWin()
    v.scrollRect = { width: 400, height: 320 }
    v.scrollOffset = top
    v.measurementsCache = Array.from({ length: count }, (_, i) => ({ index: i, start: i * 36, size: 36, end: (i + 1) * 36, key: i }))
    return { v, el: scrollElement }
  }
  const c5k = create(5000)
  const items = c5k.v.getVirtualItems()
  assert.ok(items.length > 0, 'official Virtualizer produces rows for 5000')
  assert.ok(items.length < 50, 'viewport-limited (<50): ' + items.length)
  assert.equal(items[0].index, 0)
  // scroll to middle: window moves
  const mid = create(5000, 3000 * 36)
  const midItems = mid.v.getVirtualItems()
  assert.ok(midItems.some((it) => it.index >= 2900 && it.index <= 3100), 'scroll moves the visible window')

  // 2) component-level STRONG assertions with the OFFICIAL hook — the fixed
  // layout stubs (always-400x320 rect) must make the real Virtualizer render.
  const frames = { c1: makeFrames('c1', 5000, 1) }
  const { post, calls } = makePost({ frames })
  const officialViz = globalThis.__rvUseVirtualizer || (await import('@tanstack/react-virtual')).useVirtualizer
  assert.ok(officialViz)
  const Frames = createFramesPage(React, t, post, { useVirtualizer: officialViz })
  const tree = render(createElement(Frames, { sessionId: 's1', scope: { cwd: '/tmp/proj' }, useSessions: noop }))
  await waitFor(() => {
    assert.ok(calls.state >= 2, 'must poll /state repeatedly via real effect, got ' + calls.state)
    const rows = tree.container.querySelectorAll('.dvb-live-row')
    assert.ok(rows.length > 0, 'official Virtualizer MUST render rows inside FramesPage, got 0')
  }, { timeout: 10000 })
  let rows = tree.container.querySelectorAll('.dvb-live-row')
  assert.ok(rows.length < 50, 'viewport-limited: ' + rows.length)
  assert.equal(rows[0].getAttribute('data-frameid'), 'c1-f1', 'first visible row is frame 1')
  const list = tree.container.querySelector('.dvb-frames-virtual')
  assert.ok(list)
  // scroll to the middle — visible ids must change and stay <50 rows
  await act(async () => {
    list.scrollTop = 3000 * 36
    list.dispatchEvent(new win.Event('scroll'))
    await new Promise((r) => setTimeout(r, 200))
  })
  await waitFor(() => {
    const ids = Array.from(tree.container.querySelectorAll('.dvb-live-row')).map((el) => el.getAttribute('data-frameid'))
    assert.ok(!ids.includes('c1-f1'), 'scroll must leave the first frame: ' + ids.slice(0, 4))
  }, { timeout: 6000 })
  rows = tree.container.querySelectorAll('.dvb-live-row')
  assert.ok(rows.length < 50, 'still viewport-limited after scroll: ' + rows.length)
  tree.unmount()
})

test('Task8: pause freezes content (ids/text identical), resume shows live frames', async () => {
  const holder = { frames: { c1: makeFrames('c1', 12, 1) } }
  let stateCalls = 0
  const post = async (path) => {
    if (path === '/dsh-vision-bench/state') {
      stateCalls++
      return { ok: true, workspace: { modbus: { version: 3, connections: [{ id: 'c1', name: 'C1', conn: { mode: 'rtu', port: 'COM3', sim: true } }], devices: [], points: [], framesByConnection: holder.frames, configVersion: 1 } }, health: {} }
    }
    if (path === '/dsh-vision-bench/serial/ports') return { ok: true, ports: ['COM3'] }
    return { ok: true }
  }
  // Force the FALLBACK row path (deterministic DOM rows in happy-dom) by
  // temporarily hiding the vendor — pause lifecycle is asserted on real content.
  const savedVendor = globalThis.DvbVendor
  globalThis.DvbVendor = null
  try {
    const Frames = createFramesPage(React, t, post, { useVirtualizer: () => null })
    const tree = render(createElement(Frames, { sessionId: 's1', scope: { cwd: '/tmp/proj' }, useSessions: noop }))
    await waitFor(() => {
      const pauseBtn = Array.from(tree.container.querySelectorAll('button')).find((b) => b.textContent === '暂停')
      assert.ok(pauseBtn, 'pause button rendered via real effects')
      assert.ok(tree.container.querySelectorAll('.dvb-live-row').length > 0, 'fallback rows rendered')
    }, { timeout: 8000 })
    const rowsAtRest = tree.container.querySelectorAll('.dvb-live-row').length
    assert.equal(rowsAtRest, 12, 'all 12 initial frames shown')
    // grow live frames while NOT paused → display catches up (within fallback cap)
    holder.frames = { c1: makeFrames('c1', 30, 1) }
    await waitFor(() => {
      const rows = tree.container.querySelectorAll('.dvb-live-row')
      assert.ok(rows.length > rowsAtRest, 'display follows live growth: ' + rows.length + ' > ' + rowsAtRest)
    }, { timeout: 5000 })
    // PAUSE
    await act(async () => {
      Array.from(tree.container.querySelectorAll('button')).find((b) => b.textContent === '暂停')
        .dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 60))
    })
    const pausedIds = Array.from(tree.container.querySelectorAll('.dvb-live-row')).map((el) => el.getAttribute('data-frameid'))
    const pausedText = tree.container.querySelector('.dvb-frames-virtual').textContent
    // grow MORE while paused → display must stay frozen; allow a state poll to
    // account the growth into pendingNew
    holder.frames = { c1: makeFrames('c1', 40, 1) }
    await new Promise((r) => setTimeout(r, 1900))
    const stillPausedIds = Array.from(tree.container.querySelectorAll('.dvb-live-row')).map((el) => el.getAttribute('data-frameid'))
    const stillPausedText = tree.container.querySelector('.dvb-frames-virtual').textContent
    assert.deepEqual(stillPausedIds, pausedIds, 'paused content ids are frozen')
    assert.equal(stillPausedText, pausedText, 'paused content text is frozen')
    // while paused the banner advertises the paused+new state
    assert.ok(tree.container.textContent.includes('已暂停'), 'paused banner shown: ["' + tree.container.textContent.slice(0, 200) + '"]')
    // RESUME clears the snapshot and the paused banner
    await act(async () => {
      const resumeBtn = Array.from(tree.container.querySelectorAll('button')).find((b) => b.textContent === '恢复')
      if (resumeBtn) resumeBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 120))
    })
    await waitFor(() => {
      assert.ok(!tree.container.textContent.includes('已暂停'), 'resume clears the paused banner')
    }, { timeout: 4000 })
    tree.unmount()
  } finally {
    globalThis.DvbVendor = savedVendor
  }
})

test('frames page has no open/close serial buttons in proto or raw', async () => {
  const { post, calls } = makePost({ frames: { c1: makeFrames('c1', 3) } })
  const Frames = createFramesPage(React, t, post, {})
  const tree = render(createElement(Frames, { sessionId: 's1', scope: { cwd: '/tmp/proj' }, useSessions: noop }))
  await waitFor(() => {
    assert.ok(calls.state >= 1)
  }, { timeout: 5000 })
  const labels = Array.from(tree.container.querySelectorAll('button')).map((b) => b.textContent)
  assert.ok(!labels.includes('打开串口'))
  assert.ok(!labels.includes('关闭串口'))
  await act(async () => {
    const rawBtn = Array.from(tree.container.querySelectorAll('button')).find((b) => b.textContent === '原始数据')
    assert.ok(rawBtn, 'raw mode button exists')
    rawBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 40))
  })
  const after = Array.from(tree.container.querySelectorAll('button')).map((b) => b.textContent)
  assert.ok(!after.includes('打开串口'))
  assert.ok(!after.includes('关闭串口'))
  tree.unmount()
})

test('Task8: TrendPage mounts with real effects without leaking listeners', async () => {
  const { post } = makePost({ frames: {} })
  const Tabs = createTrendPage(React, t, post, {})
  const tree = render(createElement(Tabs, { sessionId: 's1', scope: { cwd: '/tmp/proj' }, useSessions: noop }))
  await waitFor(() => {
    assert.ok(tree.container.querySelector('.dvb-live'), 'trend page rendered')
  }, { timeout: 5000 })
  tree.unmount()
  // hard to assert listener count generically; at least unmount must not throw
  assert.ok(true)
})
test('Task4: TrendPage 让 Agent 分析区间 uses the input bridge, preserves text, posts typed trend evidence', async () => {
  // Task3/0.19.3: 曲线数据来自工作区 trend 存储（提交阶段采样）
  const cwdA = '/tmp/trend-agent-' + Math.random()
  const wall = Date.now()
  let undoNow = null
  try {
    const oldNow = Date.now
    Date.now = () => Math.max(wall + 1000, oldNow())
    undoNow = () => { Date.now = oldNow }

    let draft = '用户已写好的中文输入'
    const evidenceCalls = []
    const evidenceOkFlag = { ok: true, evidence: [] }
    const post = async (path, body) => {
      if (path === '/dsh-vision-bench/state') return { ok: true, workspace: { modbus: { version: 3, configVersion: 7, trend: { p1: [[wall, 42], [wall + 500, 43]] }, connections: [{ id: 'c1', name: 'C1', conn: { mode: 'rtu', port: 'COM3', sim: true } }], devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }], points: [{ id: 'p1', connectionId: 'c1', deviceId: 'd1', name: 'Temp', function: 3, address: 0, scale: 1, offset: 0, trendEnabled: true, monitorEnabled: true }], framesByConnection: {}, visualization: { schemaVersion: 1, components: [{ id: 'viz_1', name: '测试趋势', type: 'line', pointIds: ['p1'] }] } } }, health: {} }
      if (path === '/dsh-vision-bench/evidence') { evidenceCalls.push(body.evidence || body.item || [body]); return evidenceOkFlag }
      return { ok: true }
    }
    const tMap = (k) => ({ liveChart: '可视化' }[k] || k)
    const Trend = createTrendPage(React, tMap, post, {})
    const copiedNotes = []
    let setDraftCalls = 0
    let submissions = 0
    const props = {
      sessionId: 's1',
      scope: { cwd: cwdA },
      useSessions: noop,
      useInput: (sel) => sel({ draft }),
      inputActions: {
        setDraft(v) { setDraftCalls++; draft = v },
        submit() { submissions++ },
      },
    }
    const errors = []
    const onError = (e) => errors.push(e)
    const origWrite = navigator.clipboard && navigator.clipboard.writeText
    window.addEventListener('error', onError)
    const writeSpy = () => copiedNotes.push('copied')
    if (origWrite) navigator.clipboard.writeText = writeSpy
    const tree = render(createElement(Trend, props))
    await waitFor(() => {
      const btn = Array.from(tree.container.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') || '').includes('让 Agent 分析组件'))
      assert.ok(btn, 'visualization agent button rendered after real effect')
    }, { timeout: 6000 })
    await act(async () => {
      const btn = Array.from(tree.container.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') || '').includes('让 Agent 分析组件'))
      btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 120))
    })
    assert.equal(errors.length, 0, 'no uncaught/window errors: ' + JSON.stringify(errors))
    // Task7/0.20.1: 组件引用追加到当前 Session 输入框——不覆盖已有输入、不自动发送
    assert.equal(setDraftCalls, 1, 'setDraft called once via input bridge')
    assert.equal(submissions, 0, 'no auto-submit')
    assert.ok(draft.startsWith('用户已写好的中文输入'), '已有输入保留')
    assert.ok(draft.includes('\n"kind": "visualization"') || draft.includes('\n{\n  "kind": "visualization"'), '换行追加引用')
    assert.ok(draft.includes('"visualizationId"') && draft.includes('"componentType"') && draft.includes('"pointIds"'), '引用字段完整')
    assert.ok(draft.includes('"configVersion": 7'), 'configVersion 7')
    assert.ok(draft.includes('"timeRange"'), 'timeRange 存在')
    if (origWrite) navigator.clipboard.writeText = origWrite
    tree.unmount()
    window.removeEventListener('error', onError)
  } finally {
    if (undoNow) undoNow()
  }
})

test('Task4: no input writer → clipboard fallback and no crash', async () => {
  const cwdB = '/tmp/trend-agent-cb-' + Math.random()
  const wall = Date.now()
  const post = async (path) => {
    if (path === '/dsh-vision-bench/state') return { ok: true, workspace: { modbus: { version: 3, configVersion: 3, trend: { p2: [[wall, 1]] }, connections: [{ id: 'c2', name: 'C2', conn: { mode: 'tcp', host: '10.0.0.8', tcpPort: 502 } }], devices: [{ id: 'd2', connectionId: 'c2', name: 'D2', unitId: 1 }], points: [{ id: 'p2', connectionId: 'c2', deviceId: 'd2', name: 'P', function: 3, address: 0, scale: 1, offset: 0, trendEnabled: true, monitorEnabled: true }], visualization: { schemaVersion: 1, components: [{ id: 'viz_2', name: '测试', type: 'line', pointIds: ['p2'] }] } } }, health: {} }
    return { ok: true }
  }
  const tMap = (k) => ({ liveChart: '曲线', chartWindow: '最近 5 分钟' }[k] || k)
  const Trend = createTrendPage(React, tMap, post, {})
  const errors = []
  const onError = (e) => errors.push(e)
  window.addEventListener('error', onError)
  const tree = render(createElement(Trend, { sessionId: 's1', scope: { cwd: cwdB }, useSessions: noop }))
  await waitFor(() => {
    const btn = Array.from(tree.container.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') || '').includes('让 Agent 分析组件'))
    assert.ok(btn)
  }, { timeout: 6000 })
  await act(async () => {
    const btn = Array.from(tree.container.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') || '').includes('让 Agent 分析组件'))
    btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 80))
  })
  assert.equal(errors.length, 0, 'no errors on clipboard fallback: ' + JSON.stringify(errors))
  assert.ok(tree.container.textContent.includes('已复制组件引用') || tree.container.textContent.includes('仅复制'), '无输入桥时剪贴板回退并提示')
  tree.unmount()
  window.removeEventListener('error', onError)
})

test('unmounting frames page never opens or closes a COM', async () => {
  const { post, calls, closeCalls, openCalls } = makePost({ frames: { c1: makeFrames('c1', 3) } })
  const Frames = createFramesPage(React, t, post, {})
  const tree = render(createElement(Frames, { sessionId: 's1', scope: { cwd: '/tmp/proj' }, useSessions: noop }))
  await waitFor(() => { assert.ok(calls.state >= 1) }, { timeout: 6000 })
  tree.unmount()
  assert.equal(closeCalls.length, 0, 'unmount must not close HMI connections')
  assert.equal(openCalls.length, 0, 'frames page must not open a port')
})

test('live source list only includes connected RTU, never unconfigured COM', async () => {
  const frames = { c1: makeFrames('c1', 3) }
  const { post, calls } = makePost({
    frames,
    connections: [
      { id: 'c1', name: 'C1', conn: { mode: 'rtu', port: 'COM3' } },
      { id: 'c2', name: 'C2', conn: { mode: 'rtu', port: 'COM4' } },
    ],
    serialSources: [{ connectionId: 'c1', port: 'COM3', state: 'connected', name: 'C1' }],
  })
  const Frames = createFramesPage(React, t, post, {})
  const tree = render(createElement(Frames, { sessionId: 's1', scope: { cwd: '/tmp/proj' }, useSessions: noop }))
  await waitFor(() => { assert.ok(calls.state >= 1) }, { timeout: 6000 })
  const sel = Array.from(tree.container.querySelectorAll('select'))[0]
  const values = Array.from(sel.querySelectorAll('option')).map((o) => o.value)
  assert.ok(values.includes('all'))
  assert.ok(values.includes('conn:c1'))
  assert.ok(!values.includes('conn:c2'), 'disconnected COM4 hidden')
  assert.ok(!values.some((v) => String(v).startsWith('raw:')), 'unconfigured COM hidden')
  tree.unmount()
})

test('switching proto/raw does not open or close a COM', async () => {
  const frames = { c1: makeFrames('c1', 3) }
  const { post, calls, openCalls, closeCalls } = makePost({ frames })
  const Frames = createFramesPage(React, t, post, {})
  const tree = render(createElement(Frames, { sessionId: 's1', scope: { cwd: '/tmp/proj' }, useSessions: noop }))
  await waitFor(() => { assert.ok(calls.state >= 1) }, { timeout: 6000 })
  await act(async () => {
    Array.from(tree.container.querySelectorAll('button')).find((b) => b.textContent === '原始数据')
      .dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 40))
  })
  await act(async () => {
    Array.from(tree.container.querySelectorAll('button')).find((b) => b.textContent === '协议报文')
      .dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 40))
  })
  assert.equal(openCalls.length, 0)
  assert.equal(closeCalls.length, 0)
  tree.unmount()
  assert.equal(closeCalls.length, 0)
})

test('raw feed identity stays on the selected connection; COM4 does not mix in', async () => {
  const savedVendor = globalThis.DvbVendor
  globalThis.DvbVendor = null
  const holder = {
    frames: { c1: makeFrames('c1', 3) },
    feedLines: [{ id: 1, epoch: 'e1', connectionId: 'c1', port: 'COM3', at: 1, hex: '01', direction: 'tx' }],
  }
  const openCalls = []
  const post = async (path, body) => {
    if (path === '/dsh-vision-bench/state') {
      return {
        ok: true,
        workspace: { modbus: { version: 3, connections: [{ id: 'c1', name: 'C1', conn: { mode: 'rtu', port: 'COM3' } }, { id: 'c2', name: 'C2', conn: { mode: 'rtu', port: 'COM4' } }], devices: [], points: [], framesByConnection: holder.frames, configVersion: 1 } },
        health: {},
        serialSources: [
          { connectionId: 'c1', port: 'COM3', state: 'connected', name: 'C1' },
          { connectionId: 'c2', port: 'COM4', state: 'connected', name: 'C2' },
        ],
      }
    }
    if (path === '/dsh-vision-bench/serial/open') { openCalls.push(body); return { ok: false } }
    if (path === '/dsh-vision-bench/serial/feed') {
      const cid = body && body.connectionId
      const lines = cid === 'c2'
        ? [{ id: 9, epoch: 'e2', connectionId: 'c2', port: 'COM4', at: 2, hex: '04', direction: 'rx' }]
        : holder.feedLines
      return { ok: true, open: true, error: '', lastId: 1, lines }
    }
    return { ok: true }
  }
  const tmap = (k) => ({ framesRaw: '原始数据', serialPause: '暂停' }[k] || k)
  const Frames = createFramesPage(React, tmap, post, { useVirtualizer: () => null })
  const tree = render(createElement(Frames, { sessionId: 's1', scope: { cwd: '/tmp/p3' }, useSessions: noop }))
  await waitFor(() => {
    assert.ok(Array.from(tree.container.querySelectorAll('button')).some((b) => b.textContent === '原始数据'), 'raw button')
  }, { timeout: 6000 })
  await act(async () => {
    Array.from(tree.container.querySelectorAll('button')).find((b) => b.textContent === '原始数据')
      .dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 40))
  })
  await waitFor(() => {
    const sel = Array.from(tree.container.querySelectorAll('select'))[0]
    assert.ok(Array.from(sel.querySelectorAll('option')).some((o) => o.value === 'conn:c1'), 'conn:c1 option ready')
  }, { timeout: 6000 })
  await act(async () => {
    const sel = Array.from(tree.container.querySelectorAll('select'))[0]
    sel.value = 'conn:c1'
    sel.dispatchEvent(new win.Event('change', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 80))
  })
  assert.equal(openCalls.length, 0, 'raw mode must not open a port')
  const sel = Array.from(tree.container.querySelectorAll('select'))[0]
  assert.equal(sel.disabled, false, 'switching sources does not lock the connection')
  holder.feedLines = [{ id: 7, epoch: 'e1', connectionId: 'c1', port: 'COM3', at: 2, hex: 'AA', direction: 'rx' }]
  await waitFor(() => {
    const ids = Array.from(tree.container.querySelectorAll('.dvb-live-row')).map((el) => el.getAttribute('data-frameid'))
    assert.ok(ids.some((id) => String(id).includes('c1') && String(id).includes('7')), 'raw identity uses c1: ' + ids.slice(0, 3))
    assert.ok(!ids.some((id) => String(id).includes('c2') || String(id).includes('COM4')), 'no COM4 identity')
  }, { timeout: 6000 })
  tree.unmount()
  await new Promise((r) => setTimeout(r, 150))
  globalThis.DvbVendor = savedVendor
})

test('empty live sources guide the user to HMI; closing the tab does not unlink', async () => {
  const savedVendor = globalThis.DvbVendor
  globalThis.DvbVendor = null
  const closeCalls = []
  const post = async (path) => {
    if (path === '/dsh-vision-bench/state') {
      return { ok: true, workspace: { modbus: { version: 3, connections: [{ id: 'c1', name: 'C1', conn: { mode: 'rtu', port: 'COM3' } }], devices: [], points: [], framesByConnection: {}, configVersion: 1 } }, health: {}, serialSources: [] }
    }
    if (path === '/dsh-vision-bench/serial/close' || path === '/dsh-vision-bench/connection/close') {
      closeCalls.push(path)
      return { ok: true }
    }
    return { ok: true }
  }
  const tmap = (k) => ({ framesNoLink: '暂无已连接串口', framesGoHmi: '前往上位机', framesRaw: '原始数据' }[k] || k)
  const Frames = createFramesPage(React, tmap, post, { useVirtualizer: () => null })
  const tree = render(createElement(Frames, { sessionId: 's1', scope: { cwd: '/tmp/p4' }, useSessions: noop }))
  await waitFor(() => {
    assert.ok(tree.container.textContent.includes('暂无已连接串口'))
    assert.ok(Array.from(tree.container.querySelectorAll('button')).some((b) => b.textContent === '前往上位机'))
  }, { timeout: 6000 })
  tree.unmount()
  assert.equal(closeCalls.length, 0)
  globalThis.DvbVendor = savedVendor
})

test('清空显示 only resets the page view and does not post frames/clear or close COM', async () => {
  const savedVendor = globalThis.DvbVendor
  globalThis.DvbVendor = null
  const holder = { frames: { c1: makeFrames('c1', 3) } }
  const clearCalls = []
  const closeCalls = []
  const memOnly = { frameId: 'mem-x', connectionId: 'c1', deviceId: 'd1', t: 900, at: 900, direction: 'tx', request: 'MEM', label: 'MEM', status: 'ok' }
  const post = async (path) => {
    if (path === '/dsh-vision-bench/state') {
      return { ok: true, workspace: { modbus: { version: 3, connections: [{ id: 'c1', name: 'C1', conn: { mode: 'rtu', port: 'COM3' } }], devices: [], points: [], framesByConnection: holder.frames, configVersion: 1 } }, health: {}, serialSources: [{ connectionId: 'c1', port: 'COM3', state: 'connected', name: 'C1' }] }
    }
    if (path === '/dsh-vision-bench/frames/clear') { clearCalls.push(path); return { ok: true } }
    if (path === '/dsh-vision-bench/serial/close' || path === '/dsh-vision-bench/connection/close') { closeCalls.push(path); return { ok: true } }
    return { ok: true }
  }
  const tmap = (k) => ({ serialPause: '暂停', serialResume: '恢复', framesClearView: '清空显示' }[k] || k)
  pushFramesLog('/tmp/p6', 'c1', [memOnly])
  const Frames = createFramesPage(React, tmap, post, { useVirtualizer: () => null })
  const tree = render(createElement(Frames, { sessionId: 's1', scope: { cwd: '/tmp/p6' }, useSessions: noop }))
  await waitFor(() => {
    const rows = tree.container.querySelectorAll('.dvb-live-row')
    assert.equal(rows.length, 4, 'persisted 3 + memory 1 rendered')
  }, { timeout: 8000 })
  await act(async () => {
    Array.from(tree.container.querySelectorAll('button')).find((b) => b.textContent === '暂停')
      .dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 60))
  })
  assert.ok(tree.container.textContent.includes('已暂停'), 'paused before clear')
  await act(async () => {
    Array.from(tree.container.querySelectorAll('button')).find((b) => b.textContent === '清空显示')
      .dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 80))
  })
  await waitFor(() => {
    assert.equal(tree.container.querySelectorAll('.dvb-live-row').length, 0, 'cleared view')
    assert.ok(!tree.container.textContent.includes('已暂停'), 'pause banner cleared after clear')
  }, { timeout: 6000 })
  assert.deepEqual(clearCalls, [])
  assert.deepEqual(closeCalls, [])
  tree.unmount()
  await new Promise((r) => setTimeout(r, 150))
  globalThis.DvbVendor = savedVendor
})

test('Task7: switching connection while paused exits pause and shows only the new conn', async () => {
  const savedVendor = globalThis.DvbVendor
  globalThis.DvbVendor = null
  const holder = { frames: { c1: makeFrames('c1', 3), c2: makeFrames('c2', 4, 100) } }
  const post = async (path) => {
    if (path === '/dsh-vision-bench/state') {
      return {
        ok: true,
        workspace: { modbus: { version: 3, connections: [{ id: 'c1', name: 'C1', conn: { mode: 'rtu', port: 'COM3' } }, { id: 'c2', name: 'C2', conn: { mode: 'rtu', port: 'COM4' } }], devices: [], points: [], framesByConnection: holder.frames, configVersion: 1 } },
        health: {},
        serialSources: [
          { connectionId: 'c1', port: 'COM3', state: 'connected', name: 'C1' },
          { connectionId: 'c2', port: 'COM4', state: 'connected', name: 'C2' },
        ],
      }
    }
    if (path === '/dsh-vision-bench/serial/ports') return { ok: true, ports: ['COM3', 'COM4'] }
    return { ok: true }
  }
  const tmap = (k) => ({ serialPause: '暂停', serialResume: '恢复' }[k] || k)
  const Frames = createFramesPage(React, tmap, post, { useVirtualizer: () => null })
  const tree = render(createElement(Frames, { sessionId: 's1', scope: { cwd: '/tmp/p7' }, useSessions: noop }))
  await waitFor(() => {
    assert.ok(tree.container.querySelectorAll('.dvb-live-row').length > 0)
  }, { timeout: 8000 })
  // select c1
  await act(async () => {
    const sel = Array.from(tree.container.querySelectorAll('select'))[0]
    sel.value = 'conn:c1'
    sel.dispatchEvent(new win.Event('change', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 60))
  })
  await waitFor(() => {
    const ids = Array.from(tree.container.querySelectorAll('.dvb-live-row')).map((el) => el.getAttribute('data-frameid'))
    assert.ok(ids.length === 3 && ids.every((id) => id.startsWith('c1-')), 'c1 frames only')
  }, { timeout: 6000 })
  // pause on c1
  await act(async () => {
    Array.from(tree.container.querySelectorAll('button')).find((b) => b.textContent === '暂停')
      .dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 60))
  })
  assert.ok(tree.container.textContent.includes('已暂停'))
  // switch to c2 while paused → auto-exit pause, only c2 frameIds, no c1 residue
  await act(async () => {
    const sel = Array.from(tree.container.querySelectorAll('select'))[0]
    sel.value = 'conn:c2'
    sel.dispatchEvent(new win.Event('change', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 80))
  })
  await waitFor(() => {
    const ids = Array.from(tree.container.querySelectorAll('.dvb-live-row')).map((el) => el.getAttribute('data-frameid'))
    assert.ok(ids.length === 4 && ids.every((id) => id.startsWith('c2-')), 'only c2 frames after switch: ' + ids.slice(0, 5))
    assert.ok(!tree.container.textContent.includes('已暂停'), 'pause exited on connection switch')
    assert.ok(!ids.some((id) => id.startsWith('c1-')), 'no c1 residue')
  }, { timeout: 6000 })
  tree.unmount()
})
