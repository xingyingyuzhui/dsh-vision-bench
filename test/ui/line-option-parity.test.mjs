import assert from 'node:assert/strict'
import test from 'node:test'
import { VIZ_COLORS } from '../../src/ui/monitor/visualization/viz-helpers.mjs'
import {
  buildLineOption,
  chartInk,
  readChartTokens,
} from '../../src/ui/monitor/visualization/hooks/viz-chart-options.mjs'

function payload() {
  return {
    data: [
      [1_700_000_000, 1_700_000_001, 1_700_000_002],
      [10, null, 12],
      [null, 25, 28],
    ],
    keys: ['p1', 'p2'],
    meta: [
      { label: '温度', unit: '℃' },
      { label: '压力', unit: 'kPa' },
    ],
  }
}

function pad(n) {
  return (n < 10 ? '0' : '') + n
}

test('buildLineOption draws one series per point, with gaps, area, and width', () => {
  const broken = buildLineOption({ connectNulls: false, area: true, lineWidth: 3, showSymbol: false }, payload(), false)
  assert.equal(broken.series.length, 2)
  assert.deepEqual(
    broken.series.map((s) => s.name),
    ['温度', '压力'],
  )
  assert.equal(broken.series[0].connectNulls, false)
  assert.deepEqual(broken.series[0].data, [
    [1_700_000_000_000, 10],
    [1_700_000_001_000, null],
    [1_700_000_002_000, 12],
  ])
  assert.equal(broken.series[1].data[0][1], null)
  assert.equal(broken.series[0].areaStyle.opacity, 0.14)
  assert.equal(broken.series[0].areaStyle.color, VIZ_COLORS[0])
  assert.equal(broken.series[1].areaStyle.color, VIZ_COLORS[1])
  assert.notEqual(broken.series[0].lineStyle.color, broken.series[1].lineStyle.color)
  assert.equal(broken.series[0].lineStyle.width, 3)
  assert.equal(broken.series[0].showSymbol, false)
  assert.equal(broken.series[0].symbol, 'circle')

  const joined = buildLineOption({ lineColor: '#112233' }, payload(), false)
  assert.equal(joined.series[0].connectNulls, true)
  assert.equal(joined.series[0].areaStyle, undefined)
  assert.deepEqual(joined.series[0].data, [
    [1_700_000_000_000, 10],
    [1_700_000_002_000, 12],
  ])
  assert.equal(joined.series[0].lineStyle.color, '#112233')
  assert.equal(joined.series[1].lineStyle.color, '#112233')
})

test('buildLineOption formats the time axis from the window and the count axis as indexes', () => {
  const fiveMin = buildLineOption({ windowMs: 300000 }, payload(), false)
  assert.equal(typeof fiveMin.xAxis.axisLabel.formatter, 'function')
  const stamp = Date.UTC(2026, 0, 1, 8, 5, 9)
  const local = new Date(stamp)
  assert.equal(fiveMin.xAxis.axisLabel.formatter(stamp), `${pad(local.getHours())}:${pad(local.getMinutes())}`)
  assert.equal(fiveMin.xAxis.splitLine.lineStyle.type, 'solid')
  assert.equal(fiveMin.xAxis.axisLabel.show, true)

  const minute = buildLineOption({ windowMs: 60000, xGridType: 'dashed', xShowLabel: false, xShowGrid: false }, payload(), false)
  assert.equal(minute.xAxis.axisLabel.formatter(stamp), `${pad(local.getMinutes())}:${pad(local.getSeconds())}`)
  assert.equal(minute.xAxis.splitLine.lineStyle.type, 'dashed')
  assert.equal(minute.xAxis.splitLine.show, false)
  assert.equal(minute.xAxis.axisLabel.show, false)

  const count = buildLineOption({ xScaleType: 'count', yDecimals: 2, yUnit: 'V' }, payload(), false)
  assert.equal(count.xAxis.axisLabel.formatter(3.2), '3')
  assert.equal(count.yAxis.axisLabel.formatter(1.2), '1.20 V')
  assert.equal(count.legend.show, true)
})

test('buildLineOption follows autoscroll off by pinning x to the first sample', () => {
  const firstSec = 1_700_000_000
  const lastSec = firstSec + 180
  const liveNow = lastSec * 1000
  const data = {
    data: [
      [firstSec, lastSec],
      [1, 2],
    ],
    meta: [{ label: 'A' }],
    keys: ['p1'],
  }
  const pinned = buildLineOption({ windowMs: 60000, xAutoScroll: false }, data, false, false, liveNow)
  assert.equal(pinned.xAxis.min, firstSec * 1000)
  assert.equal(pinned.xAxis.max, firstSec * 1000 + 60000)
  const follow = buildLineOption({ windowMs: 60000 }, data, false, false, liveNow)
  assert.equal(follow.xAxis.min, lastSec * 1000 - 60000)
  assert.ok(follow.xAxis.max > lastSec * 1000)
})

test('buildLineOption themes axes and tooltip from dark mode and CSS tokens', () => {
  const data = payload()
  const light = buildLineOption({}, data, false)
  const dark = buildLineOption({}, data, true)
  assert.equal(light.textStyle.color, 'rgba(0,0,0,.72)')
  assert.equal(dark.textStyle.color, 'rgba(255,255,255,.72)')
  assert.equal(light.xAxis.axisLine.lineStyle.color, 'rgba(0,0,0,.3)')
  assert.equal(dark.xAxis.axisLine.lineStyle.color, 'rgba(255,255,255,.3)')
  assert.equal(light.tooltip.backgroundColor, 'rgba(255,255,255,.96)')
  assert.equal(dark.tooltip.backgroundColor, 'rgba(20,24,32,.92)')
  assert.equal(dark.tooltip.textStyle.color, 'rgba(255,255,255,.72)')

  const themed = buildLineOption({ xAxisColor: '#abc', gridColor: '#def' }, data, true, false, undefined, {
    text: 'rgb(1, 2, 3)',
    axis: 'rgb(4, 5, 6)',
    grid: 'rgb(7, 8, 9)',
    tooltipBg: 'rgb(10, 11, 12)',
    tooltipBorder: 'rgb(13, 14, 15)',
  })
  assert.equal(themed.textStyle.color, 'rgb(1, 2, 3)')
  assert.equal(themed.yAxis.axisLine.lineStyle.color, 'rgb(4, 5, 6)')
  assert.equal(themed.xAxis.axisLine.lineStyle.color, '#abc')
  assert.equal(themed.xAxis.splitLine.lineStyle.color, '#def')
  assert.equal(themed.tooltip.backgroundColor, 'rgb(10, 11, 12)')
  assert.equal(themed.tooltip.borderColor, 'rgb(13, 14, 15)')
  assert.equal(chartInk(false, { text: 'inherit' }).text, 'rgba(0,0,0,.72)')
})

test('readChartTokens reads dvb color tokens and ignores a missing view', () => {
  assert.deepEqual(readChartTokens(null), {})
  const prev = globalThis.getComputedStyle
  globalThis.getComputedStyle = () => ({
    getPropertyValue(name) {
      if (name === '--dvb-color-fg-muted') return ' rgb(1, 2, 3) '
      if (name === '--dvb-bg-surface') return 'rgb(4, 5, 6)'
      return ''
    },
  })
  try {
    assert.deepEqual(readChartTokens({}), {
      text: 'rgb(1, 2, 3)',
      tooltipBg: 'rgb(4, 5, 6)',
    })
  } finally {
    if (prev) globalThis.getComputedStyle = prev
    else delete globalThis.getComputedStyle
  }
})
