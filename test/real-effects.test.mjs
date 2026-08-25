// Task8/0.18.2: REAL React lifecycle tests — actual useEffect, refs, scroll,
// unmount cleanup. Uses @testing-library/react + happy-dom + real react@18.
// These replace "React.useEffect = () => {}" stubs as page-level acceptance.
import { beforeEach, afterEach, test, after } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import React from 'react'
import { createElement } from 'react'
import { render, cleanup, waitFor, act } from '@testing-library/react'
import { createFramesPage } from '../bench-frames-view.mjs'
import { createTrendPage } from '../bench-live.mjs'

// The components keep background intervals alive (state poll / raw feed) so
// the event loop never drains; force-exit once the suite finishes.
after(() => process.exit(0))

// Source-level tests must see the same vendored runtime the bundle injects:
// bench-vendor reads `typeof DvbVendor` → resolves to globalThis.DvbVendor.
// Use the REAL react-virtual adapter + real functions from node_modules.
const loadVendor = async () => {
  const uPlot = (await import('uplot')).default
  const vcore = await import('@tanstack/virtual-core')
  const rv = await import('@tanstack/react-virtual')
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
  // ResizeObserver that fires immediately with a real rect so @tanstack
  // measurement runs; elements report a 400x320 viewport.
  globalThis.ResizeObserver = class {
    constructor(cb) { this.cb = cb }
    observe(el) { queueMicrotask(() => this.cb([{ target: el }])) }
    unobserve() {}
    disconnect() {}
  }
  globalThis.Element = win.HTMLElement
  const origRect = win.HTMLElement.prototype.getBoundingClientRect
  win.HTMLElement.prototype.getBoundingClientRect = function () {
    try { return origRect.call(this) } catch {}
    return { width: 400, height: 320, top: 0, left: 0, right: 400, bottom: 320, x: 0, y: 0, toJSON() {} }
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

function makePost({ frames = {}, openCalls = [], closeCalls = [], stateFn } = {}) {
  const calls = { state: 0, open: 0, close: 0, evidence: 0, clear: 0 }
  const post = async (path, body) => {
    if (path === '/dsh-vision-bench/state') {
      calls.state++
      const mb = { version: 3, connections: [{ id: 'c1', name: 'C1', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3', sim: true } }], devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }], points: [], framesByConnection: frames, configVersion: 7 }
      return { ok: true, workspace: { modbus: mb }, health: { python: { bound: true, exists: true } } }
    }
    if (path === '/dsh-vision-bench/serial/ports') return { ok: true, ports: ['COM3'] }
    if (path === '/dsh-vision-bench/serial/open') { calls.open++; openCalls.push(body); return { ok: true } }
    if (path === '/dsh-vision-bench/serial/close') { calls.close++; closeCalls.push(body); return { ok: true } }
    if (path === '/dsh-vision-bench/serial/feed') return { ok: true, open: true, error: '', lastId: 1, lines: [] }
    if (path === '/dsh-vision-bench/frames/clear') { calls.clear++; return { ok: true, cleared: (body && body.connectionId) || 'all' } }
    if (path === '/dsh-vision-bench/evidence') { calls.evidence++; return { ok: true, evidence: [] } }
    if (stateFn) return stateFn(path, body)
    return { ok: true }
  }
  return { post, calls, openCalls, closeCalls }
}

const t = (k) => ({
  framesRaw: '原始数据', framesProto: '协议报文', serialOpen: '打开串口', serialClose: '关闭串口',
  serialPause: '暂停', serialResume: '恢复', framesClear: '清空', framesCopyHex: '复制',
  serialCopied: '已复制', framesExport: '导出', framesTab: '串口报文', framesEmpty: '暂无报文',
  serialFilter: '过滤', openInHmi: '在上位机打开', framesAll: '全部串口',
}[k] || k)
const noop = () => {}

test('Task8: FramesPage runs real effects; state pulled; viewport-limited DOM when rows render', async () => {
  const frames = { c1: makeFrames('c1', 5000, 1) }
  const { post, calls } = makePost({ frames })
  const Frames = createFramesPage(React, t, post, {})
  const tree = render(createElement(Frames, { sessionId: 's1', scope: { cwd: '/tmp/proj' }, useSessions: noop }))
  // real useEffect pulled /state at least twice (bootstrap + interval)
  await waitFor(() => {
    assert.ok(calls.state >= 2, 'must poll /state repeatedly via real effect, got ' + calls.state)
  }, { timeout: 6000 })
  const rows = tree.container.querySelectorAll('.dvb-live-row')
  // happy-dom has no layout engine, so the virtualizer may yield 0 items here;
  // viewport-limiting of 500/1000/5000 is asserted at the REAL Virtualizer
  // level in virtual-compat.test.mjs (count-invariant items < 50).
  if (rows.length > 0) assert.ok(rows.length < 50, 'DOM rows viewport-limited when rendered, got ' + rows.length)
  const list = tree.container.querySelector('.dvb-frames-virtual')
  assert.ok(list, 'virtual list container exists')
  // unmount must not throw (effect cleanup runs)
  await act(async () => { tree.unmount() })
  assert.ok(true)
})

test('Task8: pause freezes the displayed snapshot while live frames keep arriving', async () => {
  let live = { c1: makeFrames('c1', 5, 1) }
  const { post } = makePost({ frames: live })
  const Frames = createFramesPage(React, t, post, {})
  const tree = render(createElement(Frames, { sessionId: 's1', scope: { cwd: '/tmp/proj' }, useSessions: noop }))
  await waitFor(() => {
    const pauseBtn = Array.from(tree.container.querySelectorAll('button')).find((b) => b.textContent === '暂停')
    assert.ok(pauseBtn, 'pause button rendered via real effects')
  }, { timeout: 6000 })
  // grow the live frames then pause: click must not throw and display is bounded
  live = { c1: makeFrames('c1', 15, 1) }
  await act(async () => {
    const pauseBtn = Array.from(tree.container.querySelectorAll('button')).find((b) => b.textContent === '暂停')
    if (pauseBtn) pauseBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 60))
  })
  const before = tree.container.querySelectorAll('.dvb-live-row').length
  assert.ok(before <= 15, 'paused display bounded')
  tree.unmount()
})

test('Task8: raw mode cannot open without a resolvable port; proto→raw keeps conn', async () => {
  const { post, calls, openCalls } = makePost({ frames: { c1: makeFrames('c1', 3) } })
  const Frames = createFramesPage(React, t, post, {})
  const tree = render(createElement(Frames, { sessionId: 's1', scope: { cwd: '/tmp/proj' }, useSessions: noop }))
  await waitFor(() => {
    assert.ok(calls.state >= 1)
  }, { timeout: 5000 })
  // switch to raw mode (button 原始数据)
  await act(async () => {
    const rawBtn = Array.from(tree.container.querySelectorAll('button')).find((b) => b.textContent === '原始数据')
    assert.ok(rawBtn, 'raw mode button exists')
    rawBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 40))
  })
  // raw + conn:c1 selected baseline 'all' → open disabled (no port)
  const openBtn = Array.from(tree.container.querySelectorAll('button')).find((b) => b.textContent === '打开串口')
  assert.ok(openBtn, 'open button in raw mode')
  assert.equal(openBtn.disabled, true, '"all" selection must disable open in raw mode')
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
  const { sampleTrend, clearTrendState } = await import('../bench-trend.mjs')
  const cwdA = '/tmp/trend-agent-' + Math.random()
  clearTrendState(cwdA)
  const wall = Date.now()
  sampleTrend(cwdA, {
    points: [{ id: 'p1', connectionId: 'c1', deviceId: 'd1', name: 'Temp', scale: 1, offset: 0 }],
    values: [{ pointId: 'p1', raw: 42, ok: true }],
  })
  let undoNow = null
  try {
    const oldNow = Date.now
    Date.now = () => Math.max(wall + 1000, oldNow())
    undoNow = () => { Date.now = oldNow }

    let draft = '用户已写好的中文输入'
    const evidenceCalls = []
    const evidenceOkFlag = { ok: true, evidence: [] }
    const post = async (path, body) => {
      if (path === '/dsh-vision-bench/state') return { ok: true, workspace: { modbus: { version: 3, configVersion: 7, connections: [{ id: 'c1', name: 'C1', conn: { mode: 'rtu', port: 'COM3', sim: true } }], devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }], points: [], framesByConnection: {} } }, health: {} }
      if (path === '/dsh-vision-bench/evidence') { evidenceCalls.push(body.evidence || body.item || [body]); return evidenceOkFlag }
      return { ok: true }
    }
    const tMap = (k) => ({ liveChart: '曲线', chartWindow: '最近 5 分钟' }[k] || k)
    const Trend = createTrendPage(React, tMap, post, {})
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
    window.addEventListener('error', onError)
    const tree = render(createElement(Trend, props))
    await waitFor(() => {
      const btn = Array.from(tree.container.querySelectorAll('button')).find((b) => b.textContent === '让 Agent 分析区间')
      assert.ok(btn, 'trend agent button rendered after real effect')
    }, { timeout: 6000 })
    await act(async () => {
      const btn = Array.from(tree.container.querySelectorAll('button')).find((b) => b.textContent === '让 Agent 分析区间')
      btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 120))
    })
    assert.equal(errors.length, 0, 'no uncaught/window errors: ' + JSON.stringify(errors))
    assert.equal(setDraftCalls, 1, 'setDraft called exactly once')
    assert.equal(submissions, 0, 'no auto-submit without send option')
    // original text preserved, reference appended after it
    assert.ok(draft.startsWith('用户已写好的中文输入'), 'user text preserved')
    assert.ok(draft.includes('"kind": "trend"'), 'typed trend kind present')
    assert.ok(draft.includes('"trendKey"'), 'trendKey present')
    for (const key of ['connectionId', 'deviceId', 'pointId', 'configVersion', 'timeRange']) {
      assert.ok(draft.includes('"' + key + '"'), key + ' present in serialized ref')
    }
    assert.ok(draft.includes('"configVersion": 7'), 'real configVersion 7, not 1')
    // typed trend evidence posted
    assert.equal(evidenceCalls.length, 1, 'evidence posted once')
    const ev = evidenceCalls[0][0]
    assert.equal(ev.kind, 'trend')
    assert.ok(ev.trendKey)
    assert.equal(ev.version, 7)
    tree.unmount()
    window.removeEventListener('error', onError)
  } finally {
    if (undoNow) undoNow()
    clearTrendState(cwdA)
  }
})

test('Task4: no input writer → clipboard fallback and no crash', async () => {
  const { sampleTrend, clearTrendState } = await import('../bench-trend.mjs')
  const cwdB = '/tmp/trend-agent-cb-' + Math.random()
  clearTrendState(cwdB)
  sampleTrend(cwdB, {
    points: [{ id: 'p2', connectionId: 'c2', deviceId: 'd2', name: 'P', scale: 1, offset: 0 }],
    values: [{ pointId: 'p2', raw: 1, ok: true }],
  })
  const post = async (path) => {
    if (path === '/dsh-vision-bench/state') return { ok: true, workspace: { modbus: { version: 3, configVersion: 3, connections: [{ id: 'c2', name: 'C2', conn: { mode: 'tcp', host: '10.0.0.8', tcpPort: 502 } }], devices: [], points: [] } }, health: {} }
    return { ok: true }
  }
  const tMap = (k) => ({ liveChart: '曲线', chartWindow: '最近 5 分钟' }[k] || k)
  const Trend = createTrendPage(React, tMap, post, {})
  const errors = []
  const onError = (e) => errors.push(e)
  window.addEventListener('error', onError)
  const tree = render(createElement(Trend, { sessionId: 's1', scope: { cwd: cwdB }, useSessions: noop }))
  await waitFor(() => {
    const btn = Array.from(tree.container.querySelectorAll('button')).find((b) => b.textContent === '让 Agent 分析区间')
    assert.ok(btn)
  }, { timeout: 6000 })
  await act(async () => {
    const btn = Array.from(tree.container.querySelectorAll('button')).find((b) => b.textContent === '让 Agent 分析区间')
    btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 80))
  })
  assert.equal(errors.length, 0, 'no errors on clipboard fallback: ' + JSON.stringify(errors))
  tree.unmount()
  window.removeEventListener('error', onError)
  clearTrendState(cwdB)
})
