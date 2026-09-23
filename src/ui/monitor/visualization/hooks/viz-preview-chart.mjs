// Editor-drawer preview chart (sample data only — not live trend).

import { getEcharts } from '../../../vendor/echarts-runtime.mjs'
import { VIZ_COLORS } from '../viz-helpers.mjs'
import { buildBarOption, buildLineOption, checkDark, readChartTokens } from './viz-chart-options.mjs'

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
      const xSplitNum = isCustomX
        ? Number(s.xSplitNumber)
        : windowMs === 1800000
          ? 6
          : windowMs === 300000 || windowMs === 900000
            ? 5
            : 4
      const xInterval = Math.round(windowMs / xSplitNum)
      const now = Math.floor(Date.now() / xInterval) * xInterval
      const count = isCount ? 10 : Math.min(36, Math.max(6, Math.round(windowMs / 10000)))
      const t0 = Math.floor((now - windowMs) / 1000)
      const step = Math.floor(windowMs / (count - 1) / 1000)
      const times = Array.from({ length: count }, (_, i) => (isCount ? i + 1 : t0 + step * i))
      const vals = Array.from({ length: count }, (_, i) => +(24 + Math.sin(i * 0.7) * 3 + Math.cos(i * 0.4) * 1.5).toFixed(1))
      const payload = { data: [times, vals], meta: [{ label: '温度' }], keys: ['temp'] }
      chart.setOption(buildLineOption(s, payload, isDark, true, now, readChartTokens(node)), true)
    } else {
      const packBar = { names: ['A', 'B', 'C', 'D'], values: [65, 78, 54, 88], itemColors: VIZ_COLORS }
      chart.setOption(buildBarOption(s, packBar, isDark, true), true)
    }
    chart.resize()
  } catch {}
}
