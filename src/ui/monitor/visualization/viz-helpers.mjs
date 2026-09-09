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

export function echartsSeriesFromTrend(payload, options = {}) {
  const data = payload?.data || []
  const times = data[0] || []
  const meta = payload?.meta || []
  const isCount = options.xScaleType === 'count'
  const series = []
  const isLinear = options.lineStyle === 'linear'
  const isStep = options.lineStyle === 'step'
  const smooth = isLinear || isStep ? false : (options.smooth !== false ? 0.2 : false)
  const step = isStep ? 'end' : false
  const lineWidth = Number(options.lineWidth) || 2
  const showSymbol = options.showSymbol !== false
  const connectNulls = options.connectNulls !== false
  for (let i = 1; i < data.length; i++) {
    const label = meta[i - 1]?.label || `s${i}`
    const pts = []
    for (let j = 0; j < times.length; j++) {
      const v = data[i][j]
      if (v != null && Number.isFinite(Number(v))) {
        pts.push([isCount ? j + 1 : Number(times[j]) * 1000, Number(v)])
      }
    }
    const color = options.lineColor || VIZ_COLORS[(i - 1) % VIZ_COLORS.length]
    series.push({
      type: 'line',
      name: label,
      showSymbol,
      symbolSize: 4,
      connectNulls,
      smooth,
      step,
      lineStyle: { width: lineWidth, color },
      itemStyle: { color },
      areaStyle: options.area ? { opacity: 0.14, color } : undefined,
      data: pts,
    })
  }
  return series
}

export function echartsBarFromLatest(latest, colors) {
  const pal = colors?.length ? colors : VIZ_COLORS
  const names = [], values = [], itemColors = []
  for (let i = 0; i < (latest?.length || 0); i++) {
    const it = latest[i]
    names.push(it.name || it.pointId || String(i))
    values.push(it.ok && it.value != null && Number.isFinite(Number(it.value)) ? Number(it.value) : null)
    itemColors.push(pal[i % pal.length])
  }
  return { names, values, itemColors }
}

export function groupPointsByDevice(points = [], { devices = [], connections = [] } = {}) {
  const devMap = new Map((devices || []).map((d) => [d.id, d]))
  const connMap = new Map((connections || []).map((c) => [c.id, c]))
  const groups = []
  const groupMap = new Map()
  for (const p of points) {
    const devId = p.deviceId || ''
    const connId = p.connectionId || ''
    const key = `${connId}:${devId}`
    let grp = groupMap.get(key)
    if (!grp) {
      const dev = devMap.get(devId)
      const conn = connMap.get(connId)
      let devName = p.deviceName || dev?.name || ''
      let connName = p.connectionName || conn?.name || ''
      if (!devName && p.path && p.path.includes(' / ')) {
        const parts = p.path.split(' / ')
        if (parts.length >= 2) {
          connName = connName || parts[0]
          devName = parts[1]
        }
      }
      grp = {
        key,
        connectionId: connId,
        deviceId: devId,
        deviceName: devName || devId || '设备',
        connectionName: connName || connId || '',
        points: [],
      }
      groupMap.set(key, grp)
      groups.push(grp)
    }
    grp.points.push(p)
  }
  return groups
}
