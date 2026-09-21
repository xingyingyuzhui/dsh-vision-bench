import { TREND_WINDOW_MS, UPLOT_PROTO, trendDataForComponents } from '../../../../application/modbus/trend-model.mjs'
import { visualizationComponentStatus } from '../../../../domain/modbus/visualization-model.mjs'
import { getEcharts } from '../../../vendor/echarts-runtime.mjs'
import { vendorUPlot } from '../../../vendor/vendor-bridge.mjs'
import {
  VIZ_COLORS,
  chartState,
  echartsBarFromLatest,
  hasTrendSamples,
  latestFingerprint,
  optionFingerprint,
} from '../viz-helpers.mjs'
import { buildBarOption, buildLineOption, checkDark, darkAlpha, padLineYMax, resolveLineTimeRange } from './viz-chart-options.mjs'

const sameChartState = (a, b) => a && b && a.series === b.series && a.data === b.data && a.option === b.option

/** Skip init while GridStack/layout has not given the plot a real box yet. */
export function plotBox(node) {
  const width = Math.round(Number(node?.clientWidth) || 0)
  const height = Math.round(Number(node?.clientHeight) || 0)
  return { width, height, ready: width >= 8 && height >= 8 }
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

function uplotAxis(show, stroke, showGrid, gridColor, dash) {
  return { show, stroke, grid: { show: showGrid, stroke: gridColor, width: 1, dash } }
}

function uplotXScale(range) {
  return { time: true, min: range.min / 1000, max: range.max / 1000 }
}

function uplotYRange(_u, min, max) {
  const lo = Number.isFinite(min) && min >= 0 ? Math.min(0, min) : min
  return [Number.isFinite(lo) ? lo : 0, padLineYMax(min, max)]
}

function applyUplotTimeRange(chart, settings, payload) {
  const range = resolveLineTimeRange(settings || {}, payload)
  try {
    chart.setScale('x', { min: range.min / 1000, max: range.max / 1000 })
  } catch {}
  return range
}

function setChartErr(setChartErrors, id, msg) {
  setChartErrors((prev) => (prev[id] === msg ? prev : { ...prev, [id]: msg }))
}

export function useVizCharts(React, { components, points, trendStore }) {
  const useCallback = typeof React.useCallback === 'function' ? React.useCallback : (fn) => fn
  const [chartErrors, setChartErrors] = React.useState({})
  const clearErr = (id) =>
    setChartErrors((p) => {
      if (!p[id]) return p
      const n = { ...p }
      delete n[id]
      return n
    })
  const uplotRefs = React.useRef({})
  const echartRefs = React.useRef({})
  const pendingRef = React.useRef({})

  const destroyChart = useCallback((id) => {
    pendingRef.current[id]?.disconnect?.()
    delete pendingRef.current[id]
    for (const refs of [uplotRefs, echartRefs]) {
      const c = refs.current[id]
      if (c) {
        try {
          c._ro?.disconnect()
          c.destroy?.()
          c.dispose?.()
        } catch {}
      }
      delete refs.current[id]
    }
  }, [])

  React.useEffect(() => {
    const live = new Set()
    for (const comp of components) {
      if ((comp.type === 'line' || comp.type === 'bar') && visualizationComponentStatus(comp, points) === 'ok') {
        live.add(comp.id)
      }
    }
    for (const refs of [uplotRefs, echartRefs]) {
      for (const id of Object.keys(refs.current)) {
        if (!live.has(id)) destroyChart(id)
      }
    }
  }, [components, points, destroyChart])

  React.useEffect(() => {
    const onResize = () => {
      for (const u of Object.values(uplotRefs.current)) {
        const box = plotBox(u?._node)
        if (!box.ready) continue
        try {
          u.setSize({ width: box.width, height: box.height })
        } catch {}
      }
      for (const c of Object.values(echartRefs.current)) {
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
      for (const id of [...Object.keys(uplotRefs.current), ...Object.keys(echartRefs.current)]) destroyChart(id)
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

  const ensureUplot = useCallback(
    (node, comp) => {
      if (!node) return
      const UPlot = vendorUPlot()
      if (!UPlot) {
        setChartErr(setChartErrors, comp.id, '图表运行时不可用')
        return
      }
      const payload = seriesOfComponent(comp)
      if (!hasTrendSamples(payload)) {
        destroyChart(comp.id)
        return
      }
      const box = plotBox(node)
      if (!box.ready) {
        watchPlotReady(pendingRef, comp.id, node, () => ensureUplot(node, comp))
        return
      }
      try {
        if (echartRefs.current[comp.id]) destroyChart(comp.id)
        const isDark = checkDark()
        const existing = uplotRefs.current[comp.id]
        const state = chartState(comp, payload, isDark, trendStore)
        const s = comp.settings || {}
        if (existing && existing._node === node) {
          if (sameChartState(existing._state, state)) return
          if (existing._state?.series === state.series && existing._state?.option === state.option) {
            existing.setData(payload.data)
            applyUplotTimeRange(existing, s, payload)
            existing._state = state
            return
          }
          destroyChart(comp.id)
        } else if (existing) {
          destroyChart(comp.id)
        }
        const lineType = s.xGridType || s.gridLineType || 'solid'
        const dash = lineType === 'dashed' ? [4, 4] : lineType === 'dotted' ? [2, 2] : []
        const gridColor = s.xGridColor || s.gridColor || darkAlpha(isDark, '.08')
        const stroke = (k) => s[k] || (isDark ? 'rgba(255,255,255,.5)' : 'rgba(0,0,0,.5)')
        const xRange = resolveLineTimeRange(s, payload)
        const chart = new UPlot(
          {
            ...UPLOT_PROTO,
            width: box.width,
            height: box.height,
            scales: { x: uplotXScale(xRange), y: { auto: true, range: uplotYRange } },
            axes: [
              uplotAxis(s.xShowLabel !== false, stroke('xAxisColor'), s.xShowGrid ?? s.showGrid !== false, gridColor, dash),
              uplotAxis(s.yShowLabel !== false, stroke('yAxisColor'), s.yShowGrid ?? s.showGrid !== false, gridColor, dash),
            ],
            series: [{}].concat(
              payload.meta.map((m, idx) => ({
                label: m.label,
                spanGaps: s.connectNulls !== false,
                stroke: s.lineColor || VIZ_COLORS[idx % VIZ_COLORS.length],
                width: Number(s.lineWidth) || 2,
                points: { show: s.showSymbol !== false },
                fill: s.area ? 'rgba(79, 142, 247, 0.12)' : undefined,
              })),
            ),
          },
          payload.data,
          node,
        )
        chart._node = node
        chart._state = state
        attachPlotResize(chart, node, (next) => chart.setSize({ width: next.width, height: next.height }))
        uplotRefs.current[comp.id] = chart
        clearErr(comp.id)
      } catch (err) {
        setChartErr(setChartErrors, comp.id, `曲线渲染失败: ${String(err?.message || err)}`)
      }
    },
    [seriesOfComponent, destroyChart, trendStore],
  )

  const ensureChart = useCallback(
    (node, comp) => {
      if (!node) return
      const echarts = getEcharts()
      if (!echarts) {
        ensureUplot(node, comp)
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
      try {
        if (uplotRefs.current[comp.id]) destroyChart(comp.id)
        const chart = bindEchart(echarts, echartRefs, comp.id, node)
        attachPlotResize(chart, node, (next) => {
          try {
            chart.resize({ width: next.width, height: next.height })
          } catch {
            chart.resize()
          }
        })
        const isDark = checkDark()
        const state = chartState(comp, payload, isDark, trendStore)
        if (sameChartState(chart._state, state)) return
        chart.setOption(buildLineOption(comp.settings, payload, isDark), true)
        chart.resize({ width: box.width, height: box.height })
        chart._state = state
        clearErr(comp.id)
      } catch (err) {
        setChartErr(setChartErrors, comp.id, `曲线渲染失败: ${String(err?.message || err)}`)
      }
    },
    [seriesOfComponent, destroyChart, ensureUplot, trendStore],
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
    try {
      const chart = bindEchart(echarts, echartRefs, comp.id, node)
      attachPlotResize(chart, node, (next) => {
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
    ensureUplot,
    ensureChart,
    ensureBarChart,
  }
}
