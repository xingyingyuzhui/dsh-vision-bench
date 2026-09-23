import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { plotBox, useVizCharts } from '../../src/ui/monitor/visualization/hooks/use-viz-charts.mjs'
import { setEchartsRuntime } from '../../src/ui/vendor/echarts-runtime.mjs'

afterEach(() => {
  setEchartsRuntime(null)
})

function makeReact() {
  return {
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
    useRef: (init) => ({ current: init }),
    useCallback: (fn) => fn,
    useEffect: () => {},
  }
}

function trendStore() {
  return {
    getComponentData: () => ({
      data: [
        [1, 2, 3],
        [10, 20, 30],
      ],
      meta: [{ label: 'a' }],
      keys: ['p1'],
    }),
  }
}

test('plotBox treats empty nodes as not ready', () => {
  assert.equal(plotBox({ clientWidth: 0, clientHeight: 0 }).ready, false)
  assert.equal(plotBox({ clientWidth: 4, clientHeight: 4 }).ready, false)
  assert.deepEqual(plotBox({ clientWidth: 400, clientHeight: 220 }), { width: 400, height: 220, ready: true })
})

test('ensureChart does not init ECharts until the plot node has a real size', () => {
  const inits = []
  setEchartsRuntime({
    init(node) {
      inits.push({ w: node.clientWidth, h: node.clientHeight })
      return {
        setOption() {},
        resize() {},
        dispose() {},
      }
    },
  })
  const hook = useVizCharts(makeReact(), { components: [], points: [], trendStore: trendStore() })
  hook.ensureChart({ clientWidth: 0, clientHeight: 0 }, { id: 'c1', type: 'line', pointIds: ['p1'], settings: {} })
  assert.equal(inits.length, 0)
})

function reactWithErrors(box) {
  return {
    useState: (init) => {
      box.errors = typeof init === 'function' ? init() : init
      return [
        box.errors,
        (next) => {
          box.errors = typeof next === 'function' ? next(box.errors) : next
        },
      ]
    },
    useRef: (init) => ({ current: init }),
    useCallback: (fn) => fn,
    useEffect: () => {},
  }
}

test('ensureChart reports the chart-library message when ECharts is missing', () => {
  const translated = { errors: null }
  const fallback = { errors: null }
  const node = { clientWidth: 640, clientHeight: 280 }
  const comp = { id: 'c1', type: 'line', pointIds: ['p1'], settings: {} }
  useVizCharts(reactWithErrors(translated), {
    components: [],
    points: [],
    trendStore: trendStore(),
    t: (key) => (key === 'vizChartUnavailable' ? 'Chart library not loaded' : key),
  }).ensureChart(node, comp)
  useVizCharts(reactWithErrors(fallback), {
    components: [],
    points: [],
    trendStore: trendStore(),
  }).ensureChart(node, comp)
  assert.equal(translated.errors.c1, 'Chart library not loaded')
  assert.equal(fallback.errors.c1, 'Chart library not loaded')
})

test('ensureChart paints line options with resolved CSS tokens', () => {
  const options = []
  const prev = globalThis.getComputedStyle
  globalThis.getComputedStyle = () => ({
    getPropertyValue(name) {
      if (name === '--dvb-color-fg-muted') return 'rgb(9, 9, 9)'
      return ''
    },
  })
  setEchartsRuntime({
    init() {
      return {
        setOption(opt) {
          options.push(opt)
        },
        resize() {},
        dispose() {},
      }
    },
  })
  try {
    const hook = useVizCharts(makeReact(), { components: [], points: [], trendStore: trendStore() })
    hook.ensureChart({ clientWidth: 640, clientHeight: 280 }, { id: 'c1', type: 'line', pointIds: ['p1'], settings: {} })
    assert.equal(options.length, 1)
    assert.equal(options[0].textStyle.color, 'rgb(9, 9, 9)')
    assert.equal(options[0].series.length, 1)
  } finally {
    if (prev) globalThis.getComputedStyle = prev
    else delete globalThis.getComputedStyle
  }
})

test('ensureChart inits ECharts at the node box and attaches ResizeObserver', () => {
  const inits = []
  const resizes = []
  const observed = []
  const prevRO = globalThis.ResizeObserver
  globalThis.ResizeObserver = class {
    constructor() {}
    observe(node) {
      observed.push(node)
    }
    disconnect() {}
  }
  setEchartsRuntime({
    init(node) {
      inits.push({ w: node.clientWidth, h: node.clientHeight })
      return {
        setOption() {},
        resize(box) {
          resizes.push(box)
        },
        dispose() {},
      }
    },
  })
  try {
    const hook = useVizCharts(makeReact(), { components: [], points: [], trendStore: trendStore() })
    const node = { clientWidth: 640, clientHeight: 280 }
    hook.ensureChart(node, { id: 'c1', type: 'line', pointIds: ['p1'], settings: {} })
    assert.equal(inits.length, 1)
    assert.deepEqual(inits[0], { w: 640, h: 280 })
    assert.ok(resizes.some((box) => box && box.width === 640 && box.height === 280))
    assert.equal(observed.length, 1)
  } finally {
    globalThis.ResizeObserver = prevRO
  }
})
