import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
// Task10/0.18.4: verify the GENERATED client.js itself — execute the real
// ModuleLoader factory, mount the actual `dsh-vision-bench:frames` tab
// component with real React + happy-dom, and assert strong virtualized
// rendering (non-zero rows < 50, no second React, no hook/scroll warnings).
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { Window } from 'happy-dom'
import React from 'react'
import { createElement } from 'react'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let win
let factoryMod = null
let consoleSpy = []

function installDom() {
  win = new Window({ url: 'http://localhost/' })
  globalThis.window = win
  globalThis.document = win.document
  try {
    globalThis.navigator = { clipboard: { writeText: async () => {} }, userAgent: 'g' }
  } catch {
    Object.defineProperty(globalThis, 'navigator', {
      value: { clipboard: { writeText: async () => {} }, userAgent: 'g' },
      configurable: true,
    })
  }
  globalThis.ResizeObserver = class {
    constructor(cb) {
      this.cb = cb
    }
    observe(el) {
      queueMicrotask(() =>
        this.cb([
          {
            target: el,
            borderBoxSize: [{ inlineSize: 400, blockSize: 320 }],
            contentRect: { width: 400, height: 320 },
          },
        ]),
      )
    }
    unobserve() {}
    disconnect() {}
  }
  globalThis.Element = win.HTMLElement
  const VIEW_RECT = () => ({
    width: 400,
    height: 320,
    top: 0,
    left: 0,
    right: 400,
    bottom: 320,
    x: 0,
    y: 0,
    toJSON() {},
  })
  const ROW_RECT = () => ({ width: 400, height: 36, top: 0, left: 0, right: 400, bottom: 36, x: 0, y: 0, toJSON() {} })
  const ZERO_RECT = () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} })
  const rectFor = (el) => {
    const cls = (el && el.className && String(el.className)) || ''
    if (cls.includes('dvb-frames-virtual') || cls.includes('dvb-live-list')) return VIEW_RECT()
    if (cls.includes('dvb-live-row')) return ROW_RECT()
    return ZERO_RECT()
  }
  win.HTMLElement.prototype.getBoundingClientRect = function () {
    return rectFor(this)
  }
  for (const k of ['clientWidth', 'clientHeight', 'offsetWidth', 'offsetHeight']) {
    try {
      Object.defineProperty(win.HTMLElement.prototype, k, {
        configurable: true,
        get() {
          const r = rectFor(this)
          return k.endsWith('Width') ? r.width : r.height
        },
      })
    } catch {}
  }
  globalThis.HTMLElement = win.HTMLElement
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0)
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  globalThis.devicePixelRatio = 1
  globalThis.CustomEvent = win.CustomEvent
}

before(async () => {
  installDom()
  // the GENERATED runtime's post() uses fetch — intercept it so the bundle's
  // real components talk to our fake backend
  globalThis.fetch = async (url, init) => {
    const path = String(url)
    let payload = { ok: true }
    try {
      const body = init && init.body ? JSON.parse(String(init.body)) : {}
      if (/\/dsh-vision-bench\/state$/.test(path)) {
        stateCalls++
        payload = {
          ok: true,
          workspace: {
            modbus: {
              version: 3,
              connections: [{ id: 'c1', name: 'C1', conn: { mode: 'rtu', port: 'COM3', sim: true } }],
              devices: [],
              points: [],
              framesByConnection: frames,
              configVersion: 7,
            },
          },
          health: {},
        }
      } else if (/serial\/ports$/.test(path)) {
        payload = { ok: true, ports: ['COM3'] }
      } else if (/serial\/feed$/.test(path)) {
        payload = { ok: true, open: true, error: '', lastId: 0, lines: [] }
      }
    } catch {
      /* keep {ok:true} */
    }
    return new win.Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const src = readFileSync(join(root, 'client.js'), 'utf8')
  let loaded = null
  const sandboxWindow = {
    __ModuleLoader__: {
      load(mod) {
        loaded = mod
      },
    },
    dispatchEvent: () => true,
    addEventListener() {},
    removeEventListener() {},
    CustomEvent: class {
      constructor(type) {
        this.type = type
      }
    },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    devicePixelRatio: 1,
    ResizeObserver: globalThis.ResizeObserver,
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    navigator: { userAgent: 'g' },
  }
  new Function('window', src)(sandboxWindow)
  assert.ok(loaded, 'generated client called __ModuleLoader__.load')
  // single registration; use harness react via require
  const requireStub = (name) => {
    if (name === 'react') return React
    throw new Error('unexpected require: ' + name)
  }
  factoryMod = loaded.factory(requireStub)
  assert.ok(factoryMod && typeof factoryMod.apply === 'function')
  // capture console errors/warnings of the component run
  const origErr = console.error
  const origWarn = console.warn
  console.error = (...a) => {
    consoleSpy.push(
      'error: ' +
        a
          .map((x) => (x && x.message) || String(x))
          .join(' ')
          .slice(0, 200),
    )
  }
  console.warn = (...a) => {
    consoleSpy.push(
      'warn: ' +
        a
          .map((x) => (x && x.message) || String(x))
          .join(' ')
          .slice(0, 200),
    )
  }
  after(() => {
    console.error = origErr
    console.warn = origWarn
  })
})

after(() => {
  cleanup()
})

let stateCalls = 0
let frames = { c1: [] }
const t = (k) =>
  ({
    framesProto: '协议报文',
    framesRaw: '原始数据',
    serialPause: '暂停',
    serialResume: '恢复',
    framesClear: '清空',
    framesTab: '串口报文',
    framesAll: '全部串口',
    serialFilter: '过滤',
    framesCopyHex: '复制',
    serialCopied: '已复制',
    framesExport: '导出',
    serialOpen: '打开串口',
    serialClose: '关闭串口',
    framesEmpty: '暂无报文',
    openInHmi: '在上位机打开',
  })[k] || k

const makeFrames = (n, start = 1) =>
  Array.from({ length: n }, (_, i) => ({
    frameId: 'c1-f' + (start + i),
    connectionId: 'c1',
    deviceId: 'd1',
    t: start + i,
    at: start + i,
    direction: 'tx',
    request: 'r' + i,
    label: 'L' + i,
    status: 'ok',
  }))
frames = { c1: makeFrames(5000) }

test('Task10: generated client renders the real frames tab with 5000 rows (1–49) and no warnings', async () => {
  stateCalls = 0
  let monitorPage = null
  const slots = {
    inject(_name, fn) {
      const d = fn()
      return typeof d === 'function' ? d : () => {}
    },
    register(def, comp) {
      if (def && def.id === 'vision-bench-monitor') monitorPage = comp
      return () => {}
    },
  }
  const ctx = {
    get(key) {
      return key === 'slots' ? slots : null
    },
    locale: { register: () => () => {} },
    inject() {
      return () => {}
    },
    effect() {},
  }
  factoryMod.apply(ctx)
  assert.ok(monitorPage, 'generated bundle registered vision-bench-monitor')
  assert.equal(typeof monitorPage, 'function')

  const tree = render(createElement(monitorPage, { sessionId: 's1', scope: { cwd: '/tmp/gen' }, useSessions: noop }))
  const framesBtn = tree.container.querySelector('[data-section="frames"]')
  assert.ok(framesBtn, 'monitor workspace exposes frames section tab')
  fireEvent.click(framesBtn)
  await waitFor(
    () => {
      assert.ok(stateCalls >= 1, 'generated page polls state')
      const rows = tree.container.querySelectorAll('.dvb-live-row')
      assert.ok(rows.length > 0, 'GENERATED client renders rows, got 0')
    },
    { timeout: 10000 },
  )
  const rows = tree.container.querySelectorAll('.dvb-live-row')
  assert.ok(rows.length < 50, 'viewport-limited in generated client: ' + rows.length)
  assert.equal(rows[0].getAttribute('data-frameid'), 'c1-f1', 'first row frame 1')
  // scroll window changes
  const list = tree.container.querySelector('.dvb-frames-virtual')
  await act(async () => {
    list.scrollTop = 5000 * 36
    list.dispatchEvent(new win.Event('scroll'))
    await new Promise((r) => setTimeout(r, 200))
  })
  await waitFor(
    () => {
      const ids = Array.from(tree.container.querySelectorAll('.dvb-live-row')).map((el) =>
        el.getAttribute('data-frameid'),
      )
      assert.ok(!ids.includes('c1-f1'), 'scroll moved the visible window in generated client: ' + ids.slice(0, 4))
    },
    { timeout: 6000 },
  )
  assert.ok(Array.from(tree.container.querySelectorAll('.dvb-live-row')).length < 50)
  tree.unmount()
  await new Promise((r) => setTimeout(r, 50))

  // no second React, no hook/scroll retry warnings
  const bad = consoleSpy.filter((line) =>
    /second React|Invalid hook call|Maximum update depth|Failed to scroll|act\(/.test(line),
  )
  assert.deepEqual(bad, [], 'no hook/scroll/act warnings in generated client run: ' + JSON.stringify(bad))
})
const noop = () => {}
