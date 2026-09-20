// Pure ECharts option builders for line/bar visualization components.

import { TREND_WINDOW_MS } from '../../../../application/modbus/trend-model.mjs'
import { VIZ_COLORS, echartsSeriesFromTrend } from '../viz-helpers.mjs'

export const darkAlpha = (isDark, a) => (isDark ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`)

export const checkDark = () =>
  typeof globalThis !== 'undefined' && !!globalThis.window?.matchMedia?.('(prefers-color-scheme: dark)').matches

export const buildAxisOpt = (s = {}, p, isDark, extra = {}) => {
  const ls = { color: s[p + 'AxisColor'] || darkAlpha(isDark, '.3') }
  const n = (k, d) => Number(s[p + k]) || d
  return {
    ...extra,
    splitNumber: (s[p + 'SplitMode'] === 'custom' && Number(s[p + 'SplitNumber'])) || extra.splitNumber,
    axisLine: { show: true, lineStyle: ls },
    axisTick: { show: true, length: n('TickLength', 5), lineStyle: ls },
    minorTick: {
      show: !!s[p + 'MinorTick'],
      splitNumber: Math.max(2, n('MinorSplit', 2)),
      length: n('MinorLength', 3),
      lineStyle: ls,
    },
    splitLine: {
      show: s[p + 'ShowGrid'] ?? (s.showGrid !== false),
      lineStyle: {
        color: s[p + 'GridColor'] || s.gridColor || darkAlpha(isDark, '.08'),
        type: s[p + 'GridType'] || s.gridLineType || 'solid',
      },
    },
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
  const xSplitNum = isCustomX
    ? Number(s.xSplitNumber)
    : windowMs === 1800000
      ? 6
      : windowMs === 300000 || windowMs === 900000
        ? 5
        : 4
  const xInterval = isCount
    ? Math.max(1, Math.round(((payload?.data?.[0]?.length || 1) - 1) / xSplitNum))
    : Math.round(windowMs / xSplitNum)
  const xs = payload?.data?.[0]
  const lastSampleMs =
    !isCount && xs?.length && Number.isFinite(Number(xs[xs.length - 1])) ? Number(xs[xs.length - 1]) * 1000 : null
  const now = explicitNow != null ? Number(explicitNow) : lastSampleMs != null ? lastSampleMs : Date.now()
  const showLegend = s.showLegend !== false
  const legendPos = s.legendPos || 'top'
  const yUnit = s.yUnit || ''
  const yDec = s.yDecimals
  const p2 = (n) => (n < 10 ? '0' : '') + n
  const fmtTime = (v) => {
    const d = new Date(Number(v))
    return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
  }

  const xAxisExtra = {
    type: 'value',
    name: isPreview ? undefined : s.xTitle || (isCount ? '点数' : undefined),
    min: isCount ? 1 : now - windowMs,
    max: isCount ? payload?.data?.[0]?.length || 1 : now,
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
      fontSize: isPreview ? 10 : Number(s.xLabelSize) || 11,
    },
  }

  const yExtra = {
    type: s.yScaleType === 'log' ? 'log' : 'value',
    position: s.yPosition || 'left',
    name: isPreview ? undefined : s.yTitle || yUnit || undefined,
    min: s.yMin ? Number(s.yMin) : undefined,
    max: s.yMax ? Number(s.yMax) : undefined,
    interval: s.yInterval ? Number(s.yInterval) : undefined,
    axisLabel:
      yDec != null && yDec !== ''
        ? { formatter: (v) => Number(v).toFixed(Number(yDec)) + (yUnit ? ' ' + yUnit : '') }
        : yUnit
          ? { formatter: `{value} ${yUnit}` }
          : undefined,
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
        const arr = Array.isArray(params) ? params : params ? [params] : []
        if (!arr.length) return ''
        const p0 = arr[0]
        const val = p0.axisValue ?? (Array.isArray(p0.value) ? p0.value[0] : p0.value)
        const head = isCount ? `点 ${p0.axisValue || p0.dataIndex + 1}` : fmtTime(val)
        return (
          `<div>${head}</div>` +
          arr
            .map((it) => {
              const v = Array.isArray(it.value) ? it.value[1] : it.value
              const num = v != null && !isNaN(v) ? Number(v).toFixed(yDec != null && yDec !== '' ? Number(yDec) : 1) : '-'
              return `<div>${it.marker || ''}${it.seriesName || ''}: <b>${num}${yUnit ? ' ' + yUnit : ''}</b></div>`
            })
            .join('')
        )
      },
    },
    legend: {
      show: isPreview ? false : showLegend,
      type: 'scroll',
      selectedMode: s.legendSelect !== false,
      textStyle: { fontSize: Number(s.legendSize) || 12 },
      ...(legendPos === 'bottom'
        ? { bottom: 0, left: 'center' }
        : legendPos === 'left' || legendPos === 'right'
          ? { [legendPos]: 0, top: 'middle', orient: 'vertical' }
          : { top: 0, left: 'center' }),
    },
    grid: isPreview
      ? { left: 34, right: 14, top: 16, bottom: 24 }
      : {
          left: s.yPosition === 'right' ? 20 : yUnit ? 52 : 44,
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
  const textColor = darkAlpha(isDark, '.72')
  const catAxis = { type: 'category', data: packBar.names, name: isPreview ? undefined : s.xTitle }
  const valAxis = {
    type: 'value',
    name: isPreview ? undefined : s.yTitle || yUnit || undefined,
    min: s.yMin ? Number(s.yMin) : undefined,
    max: s.yMax ? Number(s.yMax) : undefined,
    interval: s.yInterval ? Number(s.yInterval) : undefined,
  }
  return {
    animation: false,
    backgroundColor: 'transparent',
    textStyle: { color: textColor, fontSize: isPreview ? 10 : 12 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: isDark ? 'rgba(20,24,32,.92)' : 'rgba(255,255,255,.96)',
      borderColor: darkAlpha(isDark, '.12'),
      textStyle: { color: textColor },
    },
    grid: isPreview
      ? { left: 30, right: 12, top: 14, bottom: 22 }
      : { left: yUnit ? 50 : 38, right: 16, top: yUnit ? 24 : 14, bottom: 26 },
    xAxis: buildAxisOpt(s, isHoriz ? 'y' : 'x', isDark, isHoriz ? valAxis : catAxis),
    yAxis: buildAxisOpt(s, isHoriz ? 'x' : 'y', isDark, isHoriz ? catAxis : valAxis),
    series: [
      {
        type: 'bar',
        barWidth,
        label: {
          show: s.showBarLabel !== false,
          position: s.barLabelPos || (isHoriz ? 'right' : 'top'),
          color: textColor,
          formatter: barDec != null && barDec !== '' ? (p) => Number(p.value).toFixed(Number(barDec)) : '{c}',
        },
        data: packBar.values.map((v, i) => ({
          value: v,
          itemStyle: {
            color: packBar.itemColors[i],
            borderRadius: barRadius ? (isHoriz ? [0, barRadius, barRadius, 0] : [barRadius, barRadius, 0, 0]) : 0,
          },
        })),
      },
    ],
  }
}
