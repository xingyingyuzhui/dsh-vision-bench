// Pure ECharts option builders for line/bar visualization components.

import { TREND_WINDOW_MS } from '../../../../domain/modbus/trend-model.mjs'
import { VIZ_COLORS, echartsSeriesFromTrend } from '../viz-helpers.mjs'

export const darkAlpha = (isDark, a) => (isDark ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`)

export const checkDark = () =>
  typeof globalThis !== 'undefined' && !!globalThis.window?.matchMedia?.('(prefers-color-scheme: dark)').matches

const SKIP_COLOR = /^(inherit|initial|unset|revert|revert-layer)$/i

const CHART_TOKEN_NAMES = {
  text: '--dvb-color-fg-muted',
  axis: '--dvb-color-fg-subtle',
  grid: '--dvb-color-border',
  tooltipBg: '--dvb-bg-surface',
  tooltipBorder: '--dvb-color-border',
}

export function chartInk(isDark, tokens = {}) {
  const pick = (value, fallback) => {
    const text = String(value ?? '').trim()
    if (!text || SKIP_COLOR.test(text)) return fallback
    return text
  }
  return {
    text: pick(tokens?.text, darkAlpha(isDark, '.72')),
    axis: pick(tokens?.axis, darkAlpha(isDark, '.3')),
    grid: pick(tokens?.grid, darkAlpha(isDark, '.08')),
    tooltipBg: pick(tokens?.tooltipBg, isDark ? 'rgba(20,24,32,.92)' : 'rgba(255,255,255,.96)'),
    tooltipBorder: pick(tokens?.tooltipBorder, darkAlpha(isDark, '.12')),
  }
}

export function readChartTokens(node) {
  const tokens = {}
  let style = null
  try {
    const view = node?.ownerDocument?.defaultView || globalThis
    if (typeof view?.getComputedStyle === 'function' && node) style = view.getComputedStyle(node)
  } catch {
    style = null
  }
  for (const [key, name] of Object.entries(CHART_TOKEN_NAMES)) {
    let value = ''
    try {
      value = style?.getPropertyValue?.(name) || ''
    } catch {
      value = ''
    }
    const text = String(value).trim()
    if (text) tokens[key] = text
  }
  return tokens
}

export const buildAxisOpt = (s = {}, p, isDark, extra = {}, ink = {}) => {
  const axisColor = s[p + 'AxisColor'] || ink.axis || darkAlpha(isDark, '.3')
  const gridColor = s[p + 'GridColor'] || s.gridColor || ink.grid || darkAlpha(isDark, '.08')
  const ls = { color: axisColor }
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
        color: gridColor,
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

/** 1 / 2 / 5 × 10^n step so the top tick is an integer-like label, not 6.6464. */
export function niceAxisStep(span, tickCount = 5) {
  const raw = Math.abs(Number(span)) / Math.max(1, tickCount)
  if (!Number.isFinite(raw) || raw <= 0) return 1
  const exp = Math.floor(Math.log10(raw))
  const pow = 10 ** exp
  const f = raw / pow
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10
  return nf * pow
}

/** Pad the live Y max so the newest peak is not clipped, then snap up to a nice tick. */
export function padLineYMax(min, max) {
  const hi = Number(max)
  const lo = Number(min)
  if (!Number.isFinite(hi)) return 1
  const baseLo = Number.isFinite(lo) ? lo : Math.min(0, hi)
  const span = Math.max(hi - baseLo, Math.abs(hi) * 0.08, 1e-6)
  const padded = hi + span * 0.08
  const step = niceAxisStep(Math.max(padded - baseLo, span), 5)
  const niceMax = Math.ceil((padded - 1e-12) / step) * step
  return Number(niceMax.toPrecision(12))
}

/**
 * Live line X range. Data shorter than the window starts at the first sample
 * (left of the plot) and keeps the configured window ahead — it does not hug
 * the latest points or park them on the right edge.
 */
export function resolveLineTimeRange(s = {}, payload, explicitNow) {
  const windowMs = Number(s.windowMs) > 0 ? Number(s.windowMs) : TREND_WINDOW_MS
  const isCount = s.xScaleType === 'count'
  const xs = payload?.data?.[0]
  const n = xs?.length || 0
  const firstSec = n && Number.isFinite(Number(xs[0])) ? Number(xs[0]) : null
  const lastSec = n && Number.isFinite(Number(xs[n - 1])) ? Number(xs[n - 1]) : null
  const firstMs = firstSec != null ? firstSec * 1000 : null
  const lastMs = lastSec != null ? lastSec * 1000 : null
  const wall = explicitNow != null ? Number(explicitNow) : Date.now()
  const now = lastMs != null ? lastMs : wall
  if (isCount) {
    return { isCount: true, min: 1, max: n || 1, windowMs, now, firstMs, lastMs }
  }
  const autoScroll = s.xAutoScroll !== false
  const padMs = Math.max(250, Math.round(windowMs * 0.02))
  const staleMs = Math.max(3000, Math.round(windowMs * 0.05))
  if (firstMs != null && lastMs != null && lastMs >= firstMs) {
    const span = lastMs - firstMs
    const stale = wall - lastMs > staleMs
    if (stale) {
      return {
        isCount: false,
        min: span < windowMs ? firstMs : lastMs - windowMs,
        max: lastMs + padMs,
        windowMs,
        now,
        firstMs,
        lastMs,
      }
    }
    if (!autoScroll || span < windowMs) {
      return { isCount: false, min: firstMs, max: firstMs + windowMs, windowMs, now, firstMs, lastMs }
    }
    return { isCount: false, min: lastMs - windowMs, max: lastMs + padMs, windowMs, now, firstMs, lastMs }
  }
  return { isCount: false, min: now - windowMs, max: now + padMs, windowMs, now, firstMs, lastMs }
}

export function buildLineOption(s = {}, payload, isDark = false, isPreview = false, explicitNow, tokens) {
  const ink = chartInk(isDark, tokens)
  const range = resolveLineTimeRange(s, payload, explicitNow)
  const windowMs = range.windowMs
  const isCount = range.isCount
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
    min: range.min,
    max: range.max,
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
    max: s.yMax ? Number(s.yMax) : (extent) => padLineYMax(extent?.min, extent?.max),
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
    textStyle: { color: ink.text, fontSize: isPreview ? 10 : 12 },
    tooltip: {
      show: s.showTooltip !== false,
      trigger: s.tooltipTrigger || 'axis',
      backgroundColor: ink.tooltipBg,
      borderColor: ink.tooltipBorder,
      textStyle: { color: ink.text },
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
          right: s.yPosition === 'right' ? (yUnit ? 52 : 44) : 22,
          top: showLegend && legendPos === 'top' ? 28 : 16,
          bottom: (showLegend && legendPos === 'bottom' ? 32 : 24) + (Number(s.xLabelRotate) ? 14 : 0),
        },
    xAxis: buildAxisOpt(s, 'x', isDark, xAxisExtra, ink),
    yAxis: buildAxisOpt(s, 'y', isDark, yExtra, ink),
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
