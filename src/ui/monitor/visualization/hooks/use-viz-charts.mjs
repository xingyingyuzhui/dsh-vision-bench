// TaskP2/0.20.0: ECharts & uPlot 图表生命周期与渲染管理 Hook
// 负责图表实例创建/更新、尺寸自适应、多系列时序数据聚合及组件卸载清理。

import { TREND_WINDOW_MS, UPLOT_PROTO, trendDataForComponents } from '../../../../../bench-trend.mjs'
import { vendorUPlot } from '../../../../../bench-vendor.mjs'
import { visualizationComponentStatus } from '../../../../../bench-visualization-model.mjs'
import { getEcharts } from '../../../vendor/echarts-runtime.mjs'
import { VIZ_COLORS, echartsBarFromLatest, echartsSeriesFromTrend, hasTrendSamples } from '../viz-helpers.mjs'

const darkAlpha = (isDark, a) => isDark ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`
const checkDark = () => typeof globalThis !== 'undefined' && !!globalThis.window?.matchMedia?.('(prefers-color-scheme: dark)').matches

export const buildAxisOpt = (s = {}, p, isDark, extra = {}) => {
  const ls = { color: s[p + 'AxisColor'] || darkAlpha(isDark, '.3') }
  const n = (k, d) => Number(s[p + k]) || d
  return {
    ...extra,
    splitNumber: (s[p + 'SplitMode'] === 'custom' && Number(s[p + 'SplitNumber'])) || extra.splitNumber,
    axisLine: { show: true, lineStyle: ls },
    axisTick: { show: true, length: n('TickLength', 5), lineStyle: ls },
    minorTick: { show: !!s[p + 'MinorTick'], splitNumber: Math.max(2, n('MinorSplit', 2)), length: n('MinorLength', 3), lineStyle: ls },
    splitLine: { show: s[p + 'ShowGrid'] ?? (s.showGrid !== false), lineStyle: { color: s[p + 'GridColor'] || s.gridColor || darkAlpha(isDark, '.08'), type: s[p + 'GridType'] || s.gridLineType || 'solid' } },
    axisLabel: {
      show: s[p + 'ShowLabel'] !== false,
      fontSize: n('LabelSize', 11),
      rotate: n('LabelRotate', 0),
      ...extra.axisLabel,
    },
  }
}

export function buildLineOption(s = {}, payload, isDark = false, isPreview = false, explicitNow) {
  const windowMs = Number(s.windowMs) || TREND_WINDOW_MS
  const isCount = s.xScaleType === 'count'
  const isCustomX = s.xSplitMode === 'custom' && Number(s.xSplitNumber) > 0
  const xSplitNum = isCustomX ? Number(s.xSplitNumber) : (windowMs === 1800000 ? 6 : (windowMs === 300000 || windowMs === 900000 ? 5 : 4))
  const xInterval = isCount
    ? Math.max(1, Math.round(((payload?.data?.[0]?.length || 1) - 1) / xSplitNum))
    : Math.round(windowMs / xSplitNum)
  const now = explicitNow || Math.floor(Date.now() / xInterval) * xInterval
  const showLegend = s.showLegend !== false
  const legendPos = s.legendPos || 'top'
  const yUnit = s.yUnit || ''
  const yDec = s.yDecimals
  const p2 = (n) => (n < 10 ? '0' : '') + n
  const fmtTime = (v) => { const d = new Date(Number(v)); return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}` }

  const xAxisExtra = {
    type: 'value',
    name: isPreview ? undefined : (s.xTitle || (isCount ? '点数' : undefined)),
    min: isCount ? 1 : now - windowMs,
    max: isCount ? (payload?.data?.[0]?.length || 1) : now,
    splitNumber: xSplitNum,
    interval: xInterval,
    minInterval: xInterval,
    maxInterval: xInterval,
    axisLabel: {
      formatter: (v) => {
        if (isCount) return String(Math.round(v))
        const d = new Date(Number(v))
        return (xInterval && xInterval % 60000 !== 0) || windowMs < 300000
          ? `${p2(d.getMinutes())}:${p2(d.getSeconds())}`
          : `${p2(d.getHours())}:${p2(d.getMinutes())}`
      },
      fontSize: isPreview ? 10 : (Number(s.xLabelSize) || 11),
    },
  }

  const yExtra = {
    type: s.yScaleType === 'log' ? 'log' : 'value',
    position: s.yPosition || 'left',
    name: isPreview ? undefined : (s.yTitle || yUnit || undefined),
    min: s.yMin ? Number(s.yMin) : undefined,
    max: s.yMax ? Number(s.yMax) : undefined,
    interval: s.yInterval ? Number(s.yInterval) : undefined,
    axisLabel: yDec != null && yDec !== ''
      ? { formatter: (v) => Number(v).toFixed(Number(yDec)) + (yUnit ? ' ' + yUnit : '') }
      : (yUnit ? { formatter: `{value} ${yUnit}` } : undefined),
  }

  return {
    animation: false,
    backgroundColor: 'transparent',
    color: s.lineColor ? [s.lineColor] : VIZ_COLORS,
    textStyle: { color: darkAlpha(isDark, '.72'), fontSize: isPreview ? 10 : 12 },
    tooltip: {
      show: s.showTooltip !== false,
      trigger: s.tooltipTrigger || 'axis',
      axisPointer: {
        type: s.tooltipAxisPointer || 'cross',
        label: {
          formatter: (p) => {
            if (p.axisDimension === 'y') return Number(p.value).toFixed(yDec != null && yDec !== '' ? Number(yDec) : 2)
            if (isCount) return `点 ${Math.round(p.value)}`
            return fmtTime(p.value)
          },
        },
      },
      formatter: (params) => {
        const arr = Array.isArray(params) ? params : (params ? [params] : [])
        if (!arr.length) return ''
        const p0 = arr[0]
        const val = p0.axisValue ?? (Array.isArray(p0.value) ? p0.value[0] : p0.value)
        const head = isCount ? `点 ${p0.axisValue || p0.dataIndex + 1}` : fmtTime(val)
        return `<div>${head}</div>` + arr.map((it) => {
          const v = Array.isArray(it.value) ? it.value[1] : it.value
          const num = v != null && !isNaN(v) ? Number(v).toFixed(yDec != null && yDec !== '' ? Number(yDec) : 1) : '-'
          return `<div>${it.marker || ''}${it.seriesName || ''}: <b>${num}${yUnit ? ' ' + yUnit : ''}</b></div>`
        }).join('')
      },
    },
    legend: {
      show: isPreview ? false : showLegend,
      type: 'scroll',
      selectedMode: s.legendSelect !== false,
      textStyle: { fontSize: Number(s.legendSize) || 12 },
      ...(legendPos === 'bottom' ? { bottom: 0, left: 'center' } :
          legendPos === 'left' || legendPos === 'right' ? { [legendPos]: 0, top: 'middle', orient: 'vertical' } :
          { top: 0, left: 'center' }),
    },
    grid: isPreview
      ? { left: 34, right: 14, top: 16, bottom: 24 }
      : {
          left: s.yPosition === 'right' ? 20 : (yUnit ? 52 : 44),
          right: s.yPosition === 'right' ? (yUnit ? 52 : 44) : 16,
          top: showLegend && legendPos === 'top' ? 28 : 16,
          bottom: (showLegend && legendPos === 'bottom' ? 32 : 24) + (Number(s.xLabelRotate) ? 14 : 0),
        },
    xAxis: buildAxisOpt(s, 'x', isDark, xAxisExtra),
    yAxis: buildAxisOpt(s, 'y', isDark, yExtra),
    series: echartsSeriesFromTrend(payload, s),
  }
}

export function buildBarOption(s = {}, packBar, isDark = false, isPreview = false) {
  const isHoriz = !!s.barHorizontal
  const yUnit = s.yUnit || ''
  const barRadius = Number(s.barRadius) || 0
  const barWidth = Number(s.barWidth) || undefined
  const barDec = s.barLabelDecimals
  const catAxis = { type: 'category', data: packBar.names, name: isPreview ? undefined : s.xTitle }
  const valAxis = {
    type: 'value',
    name: isPreview ? undefined : (s.yTitle || yUnit || undefined),
    min: s.yMin ? Number(s.yMin) : undefined,
    max: s.yMax ? Number(s.yMax) : undefined,
    interval: s.yInterval ? Number(s.yInterval) : undefined,
  }
  return {
    animation: false,
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis' },
    grid: isPreview ? { left: 30, right: 12, top: 14, bottom: 22 } : { left: yUnit ? 50 : 38, right: 16, top: yUnit ? 24 : 14, bottom: 26 },
    xAxis: buildAxisOpt(s, isHoriz ? 'y' : 'x', isDark, isHoriz ? valAxis : catAxis),
    yAxis: buildAxisOpt(s, isHoriz ? 'x' : 'y', isDark, isHoriz ? catAxis : valAxis),
    series: [{
      type: 'bar',
      barWidth,
      label: {
        show: s.showBarLabel !== false,
        position: s.barLabelPos || (isHoriz ? 'right' : 'top'),
        formatter: barDec != null && barDec !== '' ? (p) => Number(p.value).toFixed(Number(barDec)) : '{c}',
      },
      data: packBar.values.map((v, i) => ({
        value: v,
        itemStyle: {
          color: packBar.itemColors[i],
          borderRadius: barRadius ? (isHoriz ? [0, barRadius, barRadius, 0] : [barRadius, barRadius, 0, 0]) : 0,
        },
      })),
    }],
  }
}

export function useVizCharts(React, { components, points, trendStore }) {
  const useCallback = typeof React.useCallback === 'function' ? React.useCallback : (fn) => fn
  const [chartErrors, setChartErrors] = React.useState({})
  const clearErr = (id) => setChartErrors((p) => { if (!p[id]) return p; const n = { ...p }; delete n[id]; return n })
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
        if (u?._node?.clientWidth) try { u.setSize({ width: u._node.clientWidth, height: u._node.clientHeight || 150 }) } catch {}
      }
      for (const c of Object.values(echartRefs.current)) {
        try { c?.resize?.() } catch {}
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
        if (existing && existing._node === node) {
          existing.setData(payload.data)
          return
        }
        if (existing) destroyChart(comp.id)
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
              grid: { show: showGrid, stroke: gridColor, width: 1, dash: lineType === 'dashed' ? [4, 4] : lineType === 'dotted' ? [2, 2] : [] },
            },
            {
              show: s.yShowLabel !== false,
              stroke: s.yAxisColor || (isDark ? 'rgba(255,255,255,.5)' : 'rgba(0,0,0,.5)'),
              grid: { show: s.yShowGrid ?? (s.showGrid !== false), stroke: gridColor, width: 1, dash: lineType === 'dashed' ? [4, 4] : lineType === 'dotted' ? [2, 2] : [] },
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
    [seriesOfComponent, destroyChart],
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
        chart.setOption(buildLineOption(comp.settings, payload, isDark), true)
        chart.resize()
        clearErr(comp.id)
      } catch (err) {
        const msg = `曲线渲染失败: ${String(err?.message || err)}`
        setChartErrors((prev) => (prev[comp.id] === msg ? prev : { ...prev, [comp.id]: msg }))
      }
    },
    [seriesOfComponent, destroyChart, ensureUplot],
  )

  const ensureBarChart = useCallback((node, comp, latest) => {
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
      const packBar = echartsBarFromLatest(latest, VIZ_COLORS)
      chart.setOption(buildBarOption(comp.settings, packBar, false), true)
      chart.resize()
    } catch (err) {
      const msg = `柱状图渲染失败: ${String(err?.message || err)}`
      setChartErrors((prev) => (prev[comp.id] === msg ? prev : { ...prev, [comp.id]: msg }))
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

export function renderPreviewChart(node, editor) {
  if (!node || !editor || (editor.type !== 'line' && editor.type !== 'bar')) return
  const echarts = getEcharts()
  if (!echarts) return
  try {
    let chart = echarts.getInstanceByDom(node)
    if (!chart) chart = echarts.init(node, null, { renderer: 'canvas' })
    const isDark = checkDark()
    const s = editor.settings || {}
    if (editor.type === 'line') {
      const windowMs = Number(s.windowMs) || 300000
      const isCount = s.xScaleType === 'count'
      const isCustomX = s.xSplitMode === 'custom' && Number(s.xSplitNumber) > 0
      const xSplitNum = isCustomX ? Number(s.xSplitNumber) : (windowMs === 1800000 ? 6 : (windowMs === 300000 || windowMs === 900000 ? 5 : 4))
      const xInterval = Math.round(windowMs / xSplitNum)
      const now = Math.floor(Date.now() / xInterval) * xInterval
      const count = isCount ? 10 : Math.min(36, Math.max(6, Math.round(windowMs / 10000)))
      const t0 = Math.floor((now - windowMs) / 1000)
      const step = Math.floor(windowMs / (count - 1) / 1000)
      const times = Array.from({ length: count }, (_, i) => isCount ? i + 1 : t0 + step * i)
      const vals = Array.from({ length: count }, (_, i) => +(24 + Math.sin(i * 0.7) * 3 + Math.cos(i * 0.4) * 1.5).toFixed(1))
      const payload = { data: [times, vals], meta: [{ label: '温度' }], keys: ['temp'] }
      chart.setOption(buildLineOption(s, payload, isDark, true, now), true)
    } else {
      const packBar = { names: ['A', 'B', 'C', 'D'], values: [65, 78, 54, 88], itemColors: VIZ_COLORS }
      chart.setOption(buildBarOption(s, packBar, isDark, true), true)
    }
    chart.resize()
  } catch {}
}
