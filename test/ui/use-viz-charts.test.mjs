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
