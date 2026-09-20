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
import { buildBarOption, buildLineOption, checkDark, darkAlpha } from './viz-chart-options.mjs'

const sameChartState = (a, b) => a && b && a.series === b.series && a.data === b.data && a.option === b.option

function bindEchart(echarts, refs, id, node) {
  let chart = refs.current[id]
  if (!chart || chart._node !== node) {
    try {
      chart?.dispose?.()
    } catch {}
    chart = echarts.init(node, null, { renderer: 'canvas' })
    chart._node = node
    refs.current[id] = chart
  }
  return chart
}

function uplotAxis(show, stroke, showGrid, gridColor, dash) {
  return { show, stroke, grid: { show: showGrid, stroke: gridColor, width: 1, dash } }
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

  const destroyChart = useCallback((id) => {
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
        if (u?._node?.clientWidth) {
          try {
            u.setSize({ width: u._node.clientWidth, height: u._node.clientHeight || 150 })
          } catch {}
        }
      }
      for (const c of Object.values(echartRefs.current)) {
        try {
          c?.resize?.()
        } catch {}
      }
    }
    const win = typeof globalThis !== 'undefined' ? globalThis.window : undefined
    win?.addEventListener('resize', onResize)
    return () => {
      win?.removeEventListener('resize', onResize)
      for (const id of [...Object.keys(uplotRefs.current), ...Object.keys(echartRefs.current)]) destroyChart(id)
    }
  }, [destroyChart])

  const seriesOfComponent = useCallback(
    (comp) => {
      const live = trendStore?.getComponentData?.(comp.id)
      if (live?.data?.[0]?.length > 0) return live
      return trendDataForComponents(trendStore, points, comp.pointIds, comp.settings?.windowMs || TREND_WINDOW_MS)
    },
    [points, trendStore],
  )

  const ensureUplot = useCallback(
    (node, comp) => {
      if (!node) return
      const payload = seriesOfComponent(comp)
      if (!hasTrendSamples(payload)) {
        destroyChart(comp.id)
        return
      }
      const UPlot = vendorUPlot()
      if (!UPlot) {
        setChartErr(setChartErrors, comp.id, '图表运行时不可用')
        return
      }
      try {
        if (echartRefs.current[comp.id]) destroyChart(comp.id)
        const isDark = checkDark()
        const existing = uplotRefs.current[comp.id]
        const state = chartState(comp, payload, isDark, trendStore)
        if (existing && existing._node === node) {
          if (sameChartState(existing._state, state)) return
          if (existing._state?.series === state.series && existing._state?.option === state.option) {
            existing.setData(payload.data)
            existing._state = state
            return
          }
          destroyChart(comp.id)
        } else if (existing) {
          destroyChart(comp.id)
        }
        const s = comp.settings || {}
        const lineType = s.xGridType || s.gridLineType || 'solid'
        const dash = lineType === 'dashed' ? [4, 4] : lineType === 'dotted' ? [2, 2] : []
        const gridColor = s.xGridColor || s.gridColor || darkAlpha(isDark, '.08')
        const stroke = (k) => s[k] || (isDark ? 'rgba(255,255,255,.5)' : 'rgba(0,0,0,.5)')
        const chart = new UPlot(
          {
            ...UPLOT_PROTO,
            width: Math.max(node.clientWidth || 0, 320),
            height: Math.max(node.clientHeight || 0, 140),
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
        if (!chart._ro && typeof ResizeObserver !== 'undefined') {
          const ro = new ResizeObserver((entries) => {
            try {
              const cr = entries[0]?.contentRect
              if (cr?.width && cr.height) chart.setSize({ width: cr.width, height: cr.height })
            } catch {}
          })
          ro.observe(node)
          chart._ro = ro
        }
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
      try {
        if (uplotRefs.current[comp.id]) destroyChart(comp.id)
        const chart = bindEchart(echarts, echartRefs, comp.id, node)
        const isDark = checkDark()
        const state = chartState(comp, payload, isDark, trendStore)
        if (sameChartState(chart._state, state)) return
        chart.setOption(buildLineOption(comp.settings, payload, isDark), true)
        chart.resize()
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
    try {
      const chart = bindEchart(echarts, echartRefs, comp.id, node)
      const isDark = checkDark()
      const fp = latestFingerprint(latest)
      const state = { series: fp, data: fp, option: optionFingerprint(comp.settings, isDark) }
      if (sameChartState(chart._state, state)) return
      chart.setOption(buildBarOption(comp.settings, echartsBarFromLatest(latest, VIZ_COLORS), isDark), true)
      chart.resize()
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
