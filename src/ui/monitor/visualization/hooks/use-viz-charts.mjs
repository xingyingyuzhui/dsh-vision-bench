import { TREND_WINDOW_MS, trendDataForComponents } from '../../../../domain/modbus/trend-model.mjs'
import { visualizationComponentStatus } from '../../../../domain/modbus/visualization-model.mjs'
import { getEcharts } from '../../../vendor/echarts-runtime.mjs'
import {
  VIZ_COLORS,
  chartState,
  echartsBarFromLatest,
  hasTrendSamples,
  latestFingerprint,
  optionFingerprint,
} from '../viz-helpers.mjs'
import { buildBarOption, buildLineOption, checkDark, readChartTokens } from './viz-chart-options.mjs'

const sameChartState = (a, b) => a && b && a.series === b.series && a.data === b.data && a.option === b.option

/** Skip init while GridStack/layout has not given the plot a real box yet. */
export function plotBox(node) {
  const width = Math.round(Number(node?.clientWidth) || 0)
  const height = Math.round(Number(node?.clientHeight) || 0)
  return { width, height, ready: width >= 8 && height >= 8 }
}

/** True when the chart lives under a kept-mounted but inactive workspace pane. */
export function plotPaneInactive(node) {
  const pane = typeof node?.closest === 'function' ? node.closest('.dvb-ws-pane') : null
  return pane?.getAttribute?.('data-active') === 'false'
}

function bindEchart(echarts, refs, id, node) {
  let chart = refs.current[id]
  if (!chart || chart._node !== node) {
    try {
      chart?._ro?.disconnect()
      chart?.dispose?.()
    } catch {}
    chart = echarts.init(node, null, { renderer: 'canvas' })
    chart._node = node
    refs.current[id] = chart
  }
  return chart
}

function attachPlotResize(chart, node, applySize) {
  if (!chart || chart._ro || typeof ResizeObserver === 'undefined' || !node) return
  const ro = new ResizeObserver(() => {
    if (plotPaneInactive(node)) return
    const box = plotBox(node)
    if (!box.ready) return
    try {
      applySize(box)
    } catch {}
  })
  ro.observe(node)
  chart._ro = ro
}

function watchPlotReady(pendingRef, id, node, run) {
  const existing = pendingRef.current[id]
  if (existing && existing._node === node) return
  existing?.disconnect?.()
  let cancelled = false
  let ro = null
  let raf = 0
  const disconnect = () => {
    cancelled = true
    try {
      ro?.disconnect()
    } catch {}
    if (raf && typeof cancelAnimationFrame === 'function') {
      try {
        cancelAnimationFrame(raf)
      } catch {}
    }
    if (pendingRef.current[id]?.disconnect === disconnect) delete pendingRef.current[id]
  }
  const tryRun = () => {
    if (cancelled) return
    if (!plotBox(node).ready) return
    disconnect()
    run()
  }
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(tryRun)
    ro.observe(node)
  }
  let frames = 0
  const tick = () => {
    if (cancelled) return
    tryRun()
    if (cancelled) return
    frames += 1
    if (frames < 12 && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(tick)
  }
  if (typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(tick)
  else tryRun()
  pendingRef.current[id] = { disconnect, try: tryRun, _node: node }
}

function chartLibraryMessage(t) {
  return typeof t === 'function' ? t('vizChartUnavailable') : 'Chart library not loaded'
}

function setChartErr(setChartErrors, id, msg) {
  setChartErrors((prev) => (prev[id] === msg ? prev : { ...prev, [id]: msg }))
}

export function useVizCharts(React, { components, points, trendStore, t }) {
  const useCallback = typeof React.useCallback === 'function' ? React.useCallback : (fn) => fn
  const [chartErrors, setChartErrors] = React.useState({})
  const clearErr = (id) =>
    setChartErrors((p) => {
      if (!p[id]) return p
      const n = { ...p }
      delete n[id]
      return n
    })
  const echartRefs = React.useRef({})
  const pendingRef = React.useRef({})

  const destroyChart = useCallback((id) => {
    pendingRef.current[id]?.disconnect?.()
    delete pendingRef.current[id]
    const c = echartRefs.current[id]
    if (c) {
      try {
        c._ro?.disconnect()
        c.dispose?.()
      } catch {}
    }
    delete echartRefs.current[id]
  }, [])

  React.useEffect(() => {
    const live = new Set()
    for (const comp of components) {
      if ((comp.type === 'line' || comp.type === 'bar') && visualizationComponentStatus(comp, points) === 'ok') {
        live.add(comp.id)
      }
    }
    for (const id of Object.keys(echartRefs.current)) {
      if (!live.has(id)) destroyChart(id)
    }
  }, [components, points, destroyChart])

  React.useEffect(() => {
    const onResize = () => {
      for (const c of Object.values(echartRefs.current)) {
        if (plotPaneInactive(c?._node)) continue
        const box = plotBox(c?._node)
        if (!box.ready) continue
        try {
          c.resize({ width: box.width, height: box.height })
        } catch {
          try {
            c?.resize?.()
          } catch {}
        }
      }
      for (const pending of Object.values(pendingRef.current)) {
        try {
          pending?.try?.()
        } catch {}
      }
    }
    const win = typeof globalThis !== 'undefined' ? globalThis.window : undefined
    win?.addEventListener('resize', onResize)
    return () => {
      win?.removeEventListener('resize', onResize)
      for (const id of Object.keys(pendingRef.current)) pendingRef.current[id]?.disconnect?.()
      pendingRef.current = {}
      for (const id of Object.keys(echartRefs.current)) destroyChart(id)
    }
  }, [destroyChart])

  const seriesOfComponent = useCallback(
    (comp) => {
      const live = trendStore?.getComponentData?.(comp.id)
      if (live?.data?.[0]?.length > 0) return live
      return trendDataForComponents(trendStore, points, comp.pointIds, comp.settings?.windowMs || TREND_WINDOW_MS, {
        autoScroll: comp.settings?.xAutoScroll !== false,
      })
    },
    [points, trendStore],
  )

  const ensureChart = useCallback(
    (node, comp) => {
      if (!node) return
      const echarts = getEcharts()
      if (!echarts) {
        destroyChart(comp.id)
        setChartErr(setChartErrors, comp.id, chartLibraryMessage(t))
        return
      }
      const payload = seriesOfComponent(comp)
      if (!hasTrendSamples(payload)) {
        destroyChart(comp.id)
        return
      }
      const box = plotBox(node)
      if (!box.ready) {
        watchPlotReady(pendingRef, comp.id, node, () => ensureChart(node, comp))
        return
      }
      if (plotPaneInactive(node)) return
      try {
        const chart = bindEchart(echarts, echartRefs, comp.id, node)
        attachPlotResize(chart, node, (next) => {
          if (plotPaneInactive(node)) return
          try {
            chart.resize({ width: next.width, height: next.height })
          } catch {
            chart.resize()
          }
        })
        const isDark = checkDark()
        const tokens = readChartTokens(node)
        const tokenKey = JSON.stringify(tokens)
        const state = chartState(comp, payload, isDark, trendStore)
        if (sameChartState(chart._state, state) && chart._tokens === tokenKey) return
        chart.setOption(buildLineOption(comp.settings, payload, isDark, false, undefined, tokens), true)
        chart.resize({ width: box.width, height: box.height })
        chart._state = state
        chart._tokens = tokenKey
        clearErr(comp.id)
      } catch (err) {
        setChartErr(setChartErrors, comp.id, `曲线渲染失败: ${String(err?.message || err)}`)
      }
    },
    [seriesOfComponent, destroyChart, trendStore, t],
  )

  const ensureBarChart = useCallback((node, comp, latest) => {
    if (!node) return
    const echarts = getEcharts()
    if (!echarts) return
    const box = plotBox(node)
    if (!box.ready) {
      watchPlotReady(pendingRef, comp.id, node, () => ensureBarChart(node, comp, latest))
      return
    }
    if (plotPaneInactive(node)) return
    try {
      const chart = bindEchart(echarts, echartRefs, comp.id, node)
      attachPlotResize(chart, node, (next) => {
        if (plotPaneInactive(node)) return
        try {
          chart.resize({ width: next.width, height: next.height })
        } catch {
          chart.resize()
        }
      })
      const isDark = checkDark()
      const fp = latestFingerprint(latest)
      const state = { series: fp, data: fp, option: optionFingerprint(comp.settings, isDark) }
      if (sameChartState(chart._state, state)) return
      chart.setOption(buildBarOption(comp.settings, echartsBarFromLatest(latest, VIZ_COLORS), isDark), true)
      chart.resize({ width: box.width, height: box.height })
      chart._state = state
      clearErr(comp.id)
    } catch (err) {
      setChartErr(setChartErrors, comp.id, `柱状图渲染失败: ${String(err?.message || err)}`)
    }
  }, [])

  return {
    chartErrors,
    setChartErrors,
    destroyChart,
    seriesOfComponent,
    ensureChart,
    ensureBarChart,
  }
}
