// @ts-check
/**
 * P1-3：React 页面测试运行时。
 *
 * 抽取前，`real-effects` / HMI / visualization / project-tree 等文件各自手写
 * happy-dom 安装、`ResizeObserver`、`requestAnimationFrame` 和（可选的）
 * `DvbVendor` 注入。重复本身不是最糟的：`console.warn` 被永久包一层却从不
 * 还原，`DvbVendor` 在测试之间泄漏，卸载后的异步回调只能靠「别删 window」
 * 这种注释式约定活着。
 *
 * 本模块提供两种 profile：
 *
 * - `page`：页面级 DOM（HMI / visualization / project-tree）
 * - `virtualized`：完整 vendor + 稳定测量矩形 + 意外 warn 失败（real-effects）
 *
 * 生命周期：`useReactPageRuntime()` 挂到 `beforeEach` / `afterEach` /
 * `after`。每个测试结束时 `cleanup()` 并还原 vendor / warn；套件结束时
 * 对**最后一个** HappyDOM Window 同步 `close()`，释放句柄好让 Node 退出。
 *
 * 不要在每个测试之间 `abort()`/`close()` 后再 `new Window()`：HappyDOM 20
 * 下会把事件循环打进死转（CPU 自旋、数 GB 内存）。也不要 await
 * `abort()`/`close()`。测试之间仍保留 `globalThis.window`（裸 `window`
 * 引用在 ESM 里否则 ReferenceError）；下一次 `beforeEach` 换新 Window。
 *
 * 放置：`test/helpers/` —— 不进 runner、结构预算、源码断言、发布清单。
 */

import { after, afterEach, beforeEach } from 'node:test'
import { cleanup } from '@testing-library/react'
import { Window } from 'happy-dom'

/** @typedef {'page' | 'virtualized'} ReactRuntimeProfile */

/**
 * @typedef {object} ReactRuntimeOptions
 * @property {ReactRuntimeProfile} [profile]
 * @property {string} [url]
 * @property {boolean} [vendor] 覆盖 profile 默认：是否注入真实 DvbVendor
 * @property {boolean} [measureRects] 覆盖：是否给虚拟列表装稳定 getBoundingClientRect
 * @property {boolean} [failOnWarn] 覆盖：意外 console.warn 是否抛错
 * @property {'noop' | 'immediate'} [resizeObserver] 覆盖 ResizeObserver 行为
 * @property {RegExp[]} [warnAllow] 额外允许的 warn 消息
 */

const DEFAULT_WARN_ALLOW = [/Download the React DevTools/]

/** @type {Promise<Record<string, any>> | null} */
let vendorModulesPromise = null

/** Current happy-dom Window for the active test. Live ESM binding. */
export let pageWindow = null

/**
 * @returns {Window}
 */
export function getPageWindow() {
  if (!pageWindow) throw new Error('react page runtime is not installed')
  return pageWindow
}

/**
 * @param {ReactRuntimeOptions} [options]
 */
function resolveOptions(options = {}) {
  const profile = options.profile || 'page'
  const virtualized = profile === 'virtualized'
  return {
    profile,
    url: options.url || 'http://localhost/',
    vendor: options.vendor ?? virtualized,
    measureRects: options.measureRects ?? virtualized,
    failOnWarn: options.failOnWarn ?? virtualized,
    resizeObserver: options.resizeObserver || (virtualized ? 'immediate' : 'noop'),
    warnAllow: [...DEFAULT_WARN_ALLOW, ...(options.warnAllow || [])],
  }
}

async function loadVendorModules() {
  if (!vendorModulesPromise) {
    vendorModulesPromise = (async () => {
      const vcore = await import('@tanstack/virtual-core')
      const rv = await import('@tanstack/react-virtual')
      const table = await import('@tanstack/table-core')
      return {
        Virtualizer: vcore.Virtualizer,
        elementScroll: vcore.elementScroll,
        observeElementRect: vcore.observeElementRect,
        observeElementOffset: vcore.observeElementOffset,
        useVirtualizer: rv.useVirtualizer,
        createTable: table.createTable,
        getCoreRowModel: table.getCoreRowModel,
        getSortedRowModel: table.getSortedRowModel,
      }
    })()
  }
  return vendorModulesPromise
}

async function ensureVendor() {
  const mods = await loadVendorModules()
  globalThis.__rvUseVirtualizer = mods.useVirtualizer
  globalThis.DvbVendor = { ...mods }
}

/**
 * @param {Window} win
 * @param {'noop' | 'immediate'} mode
 */
function installResizeObserver(win, mode) {
  if (mode === 'immediate') {
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
              contentRect: { x: 0, y: 0, width: 400, height: 320, top: 0, left: 0, right: 400, bottom: 320 },
            },
          ]),
        )
      }
      unobserve() {}
      disconnect() {}
    }
    return
  }
  globalThis.ResizeObserver = class {
    constructor(cb) {
      this.cb = cb
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  void win
}

/**
 * @param {Window} win
 */
function installMeasureRects(win) {
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
  const ROW_RECT = () => ({
    width: 400,
    height: 36,
    top: 0,
    left: 0,
    right: 400,
    bottom: 36,
    x: 0,
    y: 0,
    toJSON() {},
  })
  const ZERO_RECT = () => ({
    width: 0,
    height: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    x: 0,
    y: 0,
    toJSON() {},
  })
  const rectFor = (el) => {
    const cls = (el && el.className && String(el.className)) || ''
    if (cls.includes('dvb-frames-virtual') || cls.includes('dvb-live-list') || cls.includes('dvb-data-table-scroll')) {
      return VIEW_RECT()
    }
    if (cls.includes('dvb-live-row') || cls.includes('dvb-data-table-row')) return ROW_RECT()
    return ZERO_RECT()
  }
  win.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
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
    } catch {
      /* prototype may already define some of these */
    }
  }
}

/**
 * @param {RegExp[]} warnAllow
 * @returns {() => void}
 */
function installWarnGuard(warnAllow) {
  if (console.warn.__dvbWrapped) {
    return console.warn.__dvbRestore || (() => {})
  }
  const origWarn = console.warn.bind(console)
  const wrapped = (...args) => {
    const msg = args.map((x) => (x && x.message) || String(x)).join(' ')
    if (warnAllow.some((re) => re.test(msg))) return origWarn(...args)
    const err = new Error('unexpected console.warn: ' + msg.slice(0, 300))
    err.name = 'UnexpectedConsoleWarn'
    throw err
  }
  wrapped.__dvbWrapped = true
  wrapped.__dvbOrig = origWarn
  const restore = () => {
    console.warn = origWarn
  }
  wrapped.__dvbRestore = restore
  console.warn = wrapped
  return restore
}

/**
 * Install happy-dom + page globals. Prefer `useReactPageRuntime` for tests.
 *
 * @param {ReactRuntimeOptions} [options]
 * @returns {Promise<{ win: Window, restore: () => void }>}
 */
export async function installReactPageRuntime(options = {}) {
  const opts = resolveOptions(options)
  if (opts.vendor) await ensureVendor()

  const win = new Window({ url: opts.url })
  pageWindow = win
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

  installResizeObserver(win, opts.resizeObserver)
  globalThis.Element = win.HTMLElement
  globalThis.HTMLElement = win.HTMLElement
  if (opts.measureRects) installMeasureRects(win)

  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0)
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
  globalThis.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  })
  globalThis.devicePixelRatio = 1
  globalThis.CustomEvent = win.CustomEvent
  globalThis.getComputedStyle = () => ({
    getPropertyValue: () => '',
    setProperty() {},
    removeProperty() {},
  })
  globalThis.scrollTo = () => {}

  const restoreWarn = opts.failOnWarn ? installWarnGuard(opts.warnAllow) : () => {}

  /**
   * Tear down React trees, warn guards, and vendor. Globals stay on this
   * Window until the next install — see header.
   *
   * HappyDOM async abort/close is deferred to the suite `after()` hook in
   * `useReactPageRuntime`. Calling `abort()`/`close()` between tests then
   * constructing a fresh Window has been observed to spin the event loop.
   */
  const restore = () => {
    cleanup()
    restoreWarn()
    if (opts.vendor) {
      delete globalThis.DvbVendor
      delete globalThis.__rvUseVirtualizer
    }
  }

  return { win, restore }
}

/**
 * Module-level hook: every test gets a fresh DOM; cleanup always runs.
 *
 * @param {ReactRuntimeOptions} [options]
 */
export function useReactPageRuntime(options = {}) {
  /** @type {(() => void) | null} */
  let restore = null
  beforeEach(async () => {
    const installed = await installReactPageRuntime(options)
    restore = installed.restore
  })
  afterEach(() => {
    restore?.()
    restore = null
  })
  after(() => {
    const last = pageWindow
    pageWindow = null
    // Suite-end only: per-test close()+new Window() spins HappyDOM 20.
    try {
      if (typeof last?.close === 'function') last.close()
    } catch {
      /* already closed */
    }
  })
}

export { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
