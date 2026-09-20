// TaskP2/0.20.0: ECharts & uPlot 图表生命周期与渲染管理 Hook
// 负责图表实例创建/更新、尺寸自适应、多系列时序数据聚合及组件卸载清理。

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

export { buildAxisOpt, buildBarOption, buildLineOption, checkDark, darkAlpha } from './viz-chart-options.mjs'
export { renderPreviewChart } from './viz-preview-chart.mjs'

function sameChartState(a, b) {
  return a && b && a.series === b.series && a.data === b.data && a.option === b.option
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
    const u = uplotRefs.current[id]
    if (u) {
      try {
        u._ro?.disconnect()
        u.destroy()
      } catch {}
    }
    delete uplotRefs.current[id]
    const chart = echartRefs.current[id]
    if (chart) {
      try {
        chart._ro?.disconnect()
        chart.dispose()
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
    for (const id of Object.keys(uplotRefs.current)) {
      if (!live.has(id)) destroyChart(id)
    }
    for (const id of Object.keys(echartRefs.current)) {
      if (!live.has(id)) destroyChart(id)
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
      const live = trendStore?.getComponentData ? trendStore.getComponentData(comp.id) : null
      if (live && live.data && live.data[0] && live.data[0].length > 0) return live
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
        setChartErrors((prev) => ({ ...prev, [comp.id]: '图表运行时不可用' }))
        return
      }
      try {
        if (echartRefs.current[comp.id]) destroyChart(comp.id)
        const isDark = checkDark()
        const existing = uplotRefs.current[comp.id]
        const state = chartState(comp, payload, isDark, trendStore)
        if (existing && existing._node === node) {
          if (sameChartState(existing._state, state)) return
          // Pure data append with stable series/options → setData only.
          if (
            existing._state &&
            existing._state.series === state.series &&
            existing._state.option === state.option
          ) {
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
        const gridColor = s.xGridColor || s.gridColor || darkAlpha(isDark, '.08')
        const showGrid = s.xShowGrid ?? (s.showGrid !== false)
        const opts = {
          ...UPLOT_PROTO,
          width: Math.max(node.clientWidth || 0, 320),
          height: Math.max(node.clientHeight || 0, 140),
          axes: [
            {
              show: s.xShowLabel !== false,
              stroke: s.xAxisColor || (isDark ? 'rgba(255,255,255,.5)' : 'rgba(0,0,0,.5)'),
              grid: {
                show: showGrid,
                stroke: gridColor,
                width: 1,
                dash: lineType === 'dashed' ? [4, 4] : lineType === 'dotted' ? [2, 2] : [],
              },
            },
            {
              show: s.yShowLabel !== false,
              stroke: s.yAxisColor || (isDark ? 'rgba(255,255,255,.5)' : 'rgba(0,0,0,.5)'),
              grid: {
                show: s.yShowGrid ?? (s.showGrid !== false),
                stroke: gridColor,
                width: 1,
                dash: lineType === 'dashed' ? [4, 4] : lineType === 'dotted' ? [2, 2] : [],
              },
            },
          ],
          series: [{}].concat(
            payload.meta.map((m, idx) => ({
              label: m.label,
              spanGaps: false,
              stroke: s.lineColor || VIZ_COLORS[idx % VIZ_COLORS.length],
              width: Number(s.lineWidth) || 2,
              points: { show: s.showSymbol !== false },
              fill: s.area ? 'rgba(79, 142, 247, 0.12)' : undefined,
            })),
          ),
        }
        const chart = new UPlot(opts, payload.data, node)
        chart._node = node
        chart._state = state
        if (!chart._ro && typeof ResizeObserver !== 'undefined') {
          const ro = new ResizeObserver((entries) => {
            try {
              const entry = entries[0]
              const cr = entry?.contentRect
              if (cr && cr.width && cr.height) {
                chart.setSize({ width: cr.width, height: cr.height })
              }
            } catch {}
          })
          ro.observe(node)
          chart._ro = ro
        }
        uplotRefs.current[comp.id] = chart
        clearErr(comp.id)
      } catch (err) {
        const msg = `曲线渲染失败: ${String(err?.message || err)}`
        setChartErrors((prev) => (prev[comp.id] === msg ? prev : { ...prev, [comp.id]: msg }))
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
        let chart = echartRefs.current[comp.id]
        if (!chart || chart._node !== node) {
          if (chart) {
            try {
              chart.dispose()
            } catch {}
          }
          chart = echarts.init(node, null, { renderer: 'canvas' })
          chart._node = node
          echartRefs.current[comp.id] = chart
        }
        const isDark = checkDark()
        const state = chartState(comp, payload, isDark, trendStore)
        if (sameChartState(chart._state, state)) return
        // Series identity or theme/options changed → full setOption; same for data-only.
        chart.setOption(buildLineOption(comp.settings, payload, isDark), true)
        chart.resize()
        chart._state = state
        clearErr(comp.id)
      } catch (err) {
        const msg = `曲线渲染失败: ${String(err?.message || err)}`
        setChartErrors((prev) => (prev[comp.id] === msg ? prev : { ...prev, [comp.id]: msg }))
      }
    },
    [seriesOfComponent, destroyChart, ensureUplot, trendStore],
  )

  const ensureBarChart = useCallback(
    (node, comp, latest) => {
      if (!node) return
      const echarts = getEcharts()
      if (!echarts) return
      try {
        let chart = echartRefs.current[comp.id]
        if (!chart || chart._node !== node) {
          if (chart) {
            try {
              chart.dispose()
            } catch {}
          }
          chart = echarts.init(node, null, { renderer: 'canvas' })
          chart._node = node
          echartRefs.current[comp.id] = chart
        }
        const isDark = checkDark()
        const state = {
          series: latestFingerprint(latest),
          data: latestFingerprint(latest),
          option: optionFingerprint(comp.settings, isDark),
        }
        if (sameChartState(chart._state, state)) return
        const packBar = echartsBarFromLatest(latest, VIZ_COLORS)
        chart.setOption(buildBarOption(comp.settings, packBar, isDark), true)
        chart.resize()
        chart._state = state
        clearErr(comp.id)
      } catch (err) {
        const msg = `柱状图渲染失败: ${String(err?.message || err)}`
        setChartErrors((prev) => (prev[comp.id] === msg ? prev : { ...prev, [comp.id]: msg }))
      }
    },
    [],
  )

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
