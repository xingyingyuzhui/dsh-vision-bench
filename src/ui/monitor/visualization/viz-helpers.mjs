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

/** Stable fingerprint for chart option invalidation (settings / theme / samples). */
export function vizSettingsFingerprint(settings) {
  try {
    return JSON.stringify(settings || {})
  } catch {
    return ''
  }
}

/** Series identity: keys, labels, units, order — not sample values. */
export function seriesIdentityFingerprint(payload) {
  const keys = Array.isArray(payload?.keys) ? payload.keys : []
  const meta = Array.isArray(payload?.meta) ? payload.meta : []
  return keys
    .map((key, i) => {
      const m = meta[i] || {}
      return `${key}:${m.label || ''}:${m.unit || ''}`
    })
    .join('|')
}

/** Prefer trend.__rev; fall back to a light visible-window hash. */
export function dataFingerprint(payload, trendStore) {
  const rev = Number(trendStore?.__rev ?? payload?.revision ?? payload?.__rev)
  if (Number.isFinite(rev) && rev > 0) return `r:${Math.trunc(rev)}`
  const xs = payload?.data?.[0]
  if (!Array.isArray(xs) || xs.length === 0) return ''
  const n = xs.length
  const tails = (payload.data || []).map((series) => {
    const v = series?.[n - 1]
    return v == null || Number.isNaN(v) ? '' : String(v)
  })
  // Include a mid-window sample so historical corrections invalidate the cache.
  const mid = xs[Math.floor(n / 2)]
  const midY = (payload.data || [])
    .slice(1)
    .map((series) => {
      const v = series?.[Math.floor(n / 2)]
      return v == null || Number.isNaN(v) ? '' : String(v)
    })
    .join(',')
  return `${n}:${xs[0]}:${mid}:${xs[n - 1]}:${tails.join(',')}:${midY}`
}

export function optionFingerprint(settings, isDark) {
  return `${isDark ? 1 : 0}:${vizSettingsFingerprint(settings)}`
}

/** Combined chart invalidation state for line/uPlot renders. */
export function chartState(comp, payload, isDark, trendStore) {
  return {
    series: seriesIdentityFingerprint(payload),
    data: dataFingerprint(payload, trendStore),
    option: optionFingerprint(comp?.settings, isDark),
  }
}

/** Bar/latest-value fingerprint including point identity, name, and unit. */
export function latestFingerprint(latest) {
  if (!Array.isArray(latest)) return ''
  return latest
    .map(
      (item) =>
        `${item?.pointId || ''}:${item?.name || ''}:${item?.unit || ''}:${item?.ok ? 1 : 0}:${item?.value ?? ''}:${item?.at || 0}`,
    )
    .join('|')
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
  // Default true keeps prior "skip nulls" behavior; false keeps breakpoints (aligns with uPlot spanGaps:false).
  const connectNulls = options.connectNulls !== false
  for (let i = 1; i < data.length; i++) {
    const label = meta[i - 1]?.label || `s${i}`
    const pts = []
    for (let j = 0; j < times.length; j++) {
      const v = data[i][j]
      const x = isCount ? j + 1 : Number(times[j]) * 1000
      if (v != null && Number.isFinite(Number(v))) {
        pts.push([x, Number(v)])
      } else if (!connectNulls) {
        pts.push([x, null])
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
