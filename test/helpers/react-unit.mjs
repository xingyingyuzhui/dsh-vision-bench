// @ts-check
/**
 * P1-3：轻量 React 组件测试 harness。
 *
 * 与 `test/helpers/react-runtime.mjs` 的分工：
 *
 * - 本模块（**unit**）：无 DOM、无 happy-dom、无 vendor。用一个可预测的
 *   元素树 + 手写 Hook 槽位驱动组件，断言**结构与回调**。适用于
 *   `src/ui/components/*` 这类纯函数式组件。
 * - `react-runtime.mjs`（**page**）：真实 happy-dom + `@testing-library/react`
 *   + vendor 运行时。适用于需要真实 `document`/`window` 监听、焦点、
 *   `ResizeObserver`、CodeMirror/GridStack/ECharts 生命周期的页面级测试。
 *
 * 抽取前，`primitives` / `custom-select` / `data-table` 各自维护一份
 * 略有差异的 mock React（元素形状、children 展平、Hook 槽位各写一遍）。
 * 差异本身就会让断言在不同文件里语义不一致。
 *
 * 设计约束（刻意与 DSH Client 的真实 React 保持一致）：
 *
 * 1. `props.children` 与 `element.children` 同时存在，前者保留原始入参，
 *    后者为展平后的节点数组。
 * 2. Hook 按**渲染顺序**取槽位；`render(<Comp/>)` 每次调用都从 0 开始。
 * 3. `useEffect` / `useLayoutEffect` 的清理函数进入队列，由 `flushEffects()`
 *    或下一次 `render()` 执行。
 */

/** @typedef {{ type: any, props: Record<string, any>, children: any[] }} Element */

/** Hook 槽位与副作用队列，模块级单例，每个测试通过 `resetReactUnit()` 重置。 */
const slots = /** @type {any[]} */ ([])
/** @type {Array<() => void>} */
const cleanupQueue = []
/** @type {Array<() => void>} */
const effectQueue = []
let slotIndex = 0
let idCounter = 0
/** @type {Array<{ deps: any[] | undefined, cleanup: (() => void) | void }>} */
let effectSlots = []

/** 重置全部单例状态。`beforeEach(resetReactUnit)` 即可。 */
export function resetReactUnit() {
  slots.length = 0
  effectSlots.length = 0
  cleanupQueue.length = 0
  effectQueue.length = 0
  slotIndex = 0
  idCounter = 0
}

/** 执行上一次渲染排队的 effect，并返回本次收集到的清理函数数量。 */
export function flushEffects() {
  let ran = 0
  while (effectQueue.length) {
    const fn = effectQueue.shift()
    if (fn) {
      fn()
      ran += 1
    }
  }
  return ran
}

/** 执行所有已登记清理（卸载语义），并清空队列。 */
export function flushCleanups() {
  let ran = 0
  while (cleanupQueue.length) {
    const fn = cleanupQueue.pop()
    if (fn) {
      fn()
      ran += 1
    }
  }
  return ran
}

/**
 * @param {any} node
 * @returns {node is Element}
 */
function isElement(node) {
  return Boolean(node) && typeof node === 'object' && !Array.isArray(node) && 'type' in node && 'props' in node
}

/**
 * @param {any[]} children
 * @returns {any[]}
 */
function flattenChildren(children) {
  return children.flat(Number.POSITIVE_INFINITY).filter((child) => child !== null && child !== undefined && child !== false)
}

/**
 * 与真实 React 一致的 `createElement`，外加一个**单元测试专用**能力：
 * 当 `type` 是函数时直接调用它（并保持 Hook 槽位追踪），这样测试可以对
 * 组件做一次“渲染”而不需要 DOM。页面级测试不需要这个能力。
 *
 * @param {any} type
 * @param {Record<string, any> | null} [props]
 * @param {...any} children
 * @returns {any}
 */
export function createElement(type, props = null, ...children) {
  const flat = flattenChildren(children)
  const merged = { ...(props || {}) }
  if (flat.length === 1) merged.children = flat[0]
  else if (flat.length > 1) merged.children = flat

  if (typeof type === 'function') {
    const previous = slotIndex
    slotIndex = 0
    try {
      return type(merged)
    } finally {
      slotIndex = previous
    }
  }
  return { type, props: merged, children: flat }
}

/** 记录当前渲染是否在追踪 Hook（供 `useCallback` 等判断，当前实现无分支依赖）。 */
/**
 * @template T
 * @param {T | (() => T)} init
 * @returns {[T, (next: T | ((prev: T) => T)) => void]}
 */
function useState(init) {
  const i = slotIndex++
  if (slots[i] === undefined) slots[i] = typeof init === 'function' ? init() : init
  const set = (next) => {
    slots[i] = typeof next === 'function' ? next(slots[i]) : next
  }
  return [slots[i], set]
}

/**
 * @template T
 * @param {T} init
 */
function useRef(init) {
  const i = slotIndex++
  if (slots[i] === undefined) slots[i] = { current: init }
  return slots[i]
}

/**
 * @param {() => void | (() => void)} fn
 * @param {any[]} [deps]
 */
function scheduleEffect(fn, deps) {
  const i = slotIndex++
  const previous = effectSlots[i]
  if (previous && deps && previous.deps && deps.length === previous.deps.length && deps.every((d, idx) => Object.is(d, previous.deps[idx]))) {
    return
  }
  if (previous && typeof previous.cleanup === 'function') cleanupQueue.push(previous.cleanup)
  const record = /** @type {{ deps: any[] | undefined, cleanup: (() => void) | void }} */ ({ deps, cleanup: undefined })
  effectSlots[i] = record
  effectQueue.push(() => {
    const cleanup = fn()
    record.cleanup = typeof cleanup === 'function' ? cleanup : undefined
  })
}

/**
 * @param {() => void | (() => void)} fn
 * @param {any[]} [deps]
 */
function useEffect(fn, deps) {
  scheduleEffect(fn, deps)
}

/**
 * @param {() => void | (() => void)} fn
 * @param {any[]} [deps]
 */
function useLayoutEffect(fn, deps) {
  /* no separate commit phase in the unit harness: queue alongside useEffect */
  scheduleEffect(fn, deps)
}

/**
 * @template T
 * @param {() => T} factory
 * @param {any[]} [deps]
 * @returns {T}
 */
function useMemo(factory, deps) {
  const i = slotIndex++
  const previous = slots[i]
  if (previous && deps && previous.deps && deps.length === previous.deps.length && deps.every((d, idx) => Object.is(d, previous.deps[idx]))) {
    return previous.value
  }
  const value = factory()
  slots[i] = { deps, value }
  return value
}

/**
 * @template {(...args: any[]) => any} T
 * @param {T} fn
 * @param {any[]} [deps]
 * @returns {T}
 */
function useCallback(fn, deps) {
  return useMemo(() => fn, deps)
}

/** @param {string} [prefix] */
function useId(prefix = ':r') {
  idCounter += 1
  return `${prefix}${idCounter}:`
}

/** 当前 harness 不模拟 Context；返回传入的默认值，避免组件探测崩溃。 */
function useContext(_context, defaultValue) {
  return defaultValue
}

/** 可直接传给 `createX(React)` 的最小运行时。 */
export const mockReact = /** @type {any} */ ({
  createElement,
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useCallback,
  useId,
  useContext,
})

/** `React.createElement` 的别名，供 `renderX(el, ...)` 风格测试使用。 */
export const el = createElement

/**
 * 渲染一个组件函数（或元素）并返回元素树。
 *
 * @param {any} componentOrElement
 * @param {Record<string, any>} [props]
 * @returns {any}
 */
export function render(componentOrElement, props = {}) {
  slotIndex = 0
  if (typeof componentOrElement === 'function' && componentOrElement.prototype?.isReactComponent) {
    return createElement(componentOrElement, props)
  }
  if (typeof componentOrElement === 'function') return componentOrElement(props)
  return componentOrElement
}

/** 深度优先遍历元素树。 */
export function walk(node, visit) {
  if (!node) return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  if (!isElement(node)) return
  visit(node)
  for (const child of node.children) walk(child, visit)
}

/**
 * 收集所有满足条件的节点。
 *
 * @param {any} root
 * @param {string | ((node: Element) => boolean)} matcher 元素类型字符串或谓词
 * @returns {Element[]}
 */
export function findAll(root, matcher) {
  const test = typeof matcher === 'string' ? (node) => node.type === matcher : matcher
  /** @type {Element[]} */
  const out = []
  walk(root, (node) => {
    if (test(node)) out.push(node)
  })
  return out
}

/** 返回第一个匹配节点，未找到时抛错（比 `undefined` 更容易定位断言失败）。 */
export function find(root, matcher) {
  const found = findAll(root, matcher)[0]
  if (!found) {
    const label = typeof matcher === 'string' ? `type="${matcher}"` : 'predicate'
    throw new Error(`react-unit: no node matching ${label}`)
  }
  return found
}

/** 按 className 子串匹配（与组件里 `className.includes(...)` 断言语义一致）。 */
export function findByClass(root, fragment) {
  return find(root, (node) => String(node.props?.className || '').includes(fragment))
}

/** 按 className 子串收集全部匹配。 */
export function findAllByClass(root, fragment) {
  return findAll(root, (node) => String(node.props?.className || '').includes(fragment))
}

/** 取节点（含后代）的可见文本。 */
export function text(node) {
  if (node === null || node === undefined || node === false) return ''
  if (Array.isArray(node)) return node.map(text).join('')
  if (!isElement(node)) return String(node)
  return node.children.map(text).join('')
}

/** 读取 prop（含 `data-*`/`aria-*` 这类非驼峰命名）。 */
export function attr(node, name) {
  return node?.props?.[name]
}

/**
 * 构造合成事件，缺省行为全部是 no-op，测试只断言被调用的部分。
 *
 * @param {Record<string, any>} [init]
 */
export function makeEvent(init = {}) {
  return {
    preventDefault() {},
    stopPropagation() {},
    ...init,
  }
}

/** 触发节点的 `onClick`。 */
export function click(node, init = {}) {
  node?.props?.onClick?.(makeEvent(init))
}

/** 触发节点的 `onKeyDown`。 */
export function key(node, keyValue, init = {}) {
  node?.props?.onKeyDown?.(makeEvent({ key: keyValue, ...init }))
}

/** 触发节点的 `onChange`。 */
export function change(node, value, init = {}) {
  node?.props?.onChange?.(makeEvent({ target: { value }, ...init }))
}
