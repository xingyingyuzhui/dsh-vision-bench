export const VIZ_COLORS = ['#4f8ef7', '#2eaf64', '#e0912f', '#c85454', '#8f63d2', '#2fa8a8', '#d27ab0', '#7a8494']

export function hasTrendSamples(payload) {
  return !!(
    payload &&
    Array.isArray(payload.data) &&
    payload.data.length > 0 &&
    Array.isArray(payload.data[0]) &&
    payload.data[0].length > 0
  )
}

export function pointCompatible(type, fn) {
  if (type === 'line' || type === 'bar') return fn === 3 || fn === 4
  if (type === 'switch') return fn === 1
  return [1, 2, 3, 4].includes(fn)
}

export function vizTypeLabel(type) {
  return { line: '曲线图', bar: '柱状图', value: '数值卡', switch: '开关' }[type] || type
}

export function vizFieldOf(el, label, control) {
  return el('div', { className: 'dvb-row' }, el('div', { className: 'dvb-label' }, el('span', null, label)), control)
}

export function echartsSeriesFromTrend(payload) {
  const data = payload && Array.isArray(payload.data) ? payload.data : []
  const times = data[0] || []
  const meta = Array.isArray(payload.meta) ? payload.meta : []
  const series = []
  for (let i = 1; i < data.length; i++) {
    const label = (meta[i - 1] && meta[i - 1].label) || `s${i}`
    series.push({
      type: 'line',
      name: label,
      showSymbol: false,
      data: times.map((t, j) => {
        const v = data[i][j]
        return [Number(t) * 1000, v == null || Number.isNaN(Number(v)) ? null : Number(v)]
      }),
    })
  }
  return series
}

export function echartsBarFromLatest(latest, colors) {
  const palette = Array.isArray(colors) && colors.length ? colors : VIZ_COLORS
  const names = []
  const values = []
  const itemColors = []
  ;(Array.isArray(latest) ? latest : []).forEach((item, i) => {
    names.push(item.name || item.pointId || String(i))
    const v = item.ok && item.value != null && Number.isFinite(Number(item.value)) ? Number(item.value) : null
    values.push(v)
    itemColors.push(palette[i % palette.length])
  })
  return { names, values, itemColors }
}
