export const TREND_CAP = 600
export const TREND_WINDOW_MS = 5 * 60 * 1000

export const TREND = { cwd: '', series: new Map(), meta: new Map() }

export const trendKey = (connectionId, deviceId, pointId) => String(connectionId) + ':' + String(deviceId) + ':' + String(pointId)

export const sampleTrend = (cwd, pack) => {
  if (!cwd || TREND.cwd !== cwd) {
    if (TREND.cwd !== cwd) {
      TREND.cwd = cwd
      TREND.series.clear()
      TREND.meta.clear()
    }
    if (!cwd) return
  }
  const now = Date.now()
  const pointsById = {}
  for (const p of Array.isArray(pack.points) ? pack.points : []) pointsById[p.id] = p
  const values = Array.isArray(pack.values) ? pack.values : []
  for (const rec of values) {
    const pid = rec && (rec.pointId || rec.key)
    if (!pid || !pointsById[pid]) continue
    const pt = pointsById[pid]
    const key = trendKey(pt.connectionId || '', pt.deviceId || '', pid)
    TREND.meta.set(key, {
      label: (pt.name || pid),
      unit: pt.unit || '',
      connectionId: pt.connectionId,
      deviceId: pt.deviceId,
      pointId: pid,
    })
    let list = TREND.series.get(key)
    if (!list) { list = []; TREND.series.set(key, list) }
    // quality breakpoint: bad quality writes explicit null gap for uPlot spanGaps:false
    if (rec.ok !== true) {
      list.push({ t: now, v: null })
      if (list.length > TREND_CAP) list.splice(0, list.length - TREND_CAP)
      continue
    }
    const rawV = rec.value !== null && rec.value !== undefined ? Number(rec.value) : Number(rec.raw)
    if (!Number.isFinite(rawV)) {
      list.push({ t: now, v: null })
      if (list.length > TREND_CAP) list.splice(0, list.length - TREND_CAP)
      continue
    }
    list.push({ t: now, v: rawV })
    if (list.length > TREND_CAP) list.splice(0, list.length - TREND_CAP)
  }
}

// stats for a single series window — null gaps ignored
export function computeStats(keyOrList, opts = {}) {
  let list
  if (typeof keyOrList === 'string') {
    list = TREND.series.get(keyOrList) || []
  } else if (Array.isArray(keyOrList)) {
    list = keyOrList
  } else if (keyOrList && Array.isArray(keyOrList.list)) {
    list = keyOrList.list
  } else {
    list = []
  }
  const now = opts.now != null ? Number(opts.now) : Date.now()
  const windowMs = opts.windowMs != null ? Number(opts.windowMs) : TREND_WINDOW_MS
  const cutoff = now - windowMs
  const win = list.filter((item) => item && item.t >= cutoff && item.v !== null && item.v !== undefined && Number.isFinite(Number(item.v)))
  const valid = win.length
  if (!valid) {
    return { count: list.length, valid: 0, min: null, max: null, avg: null, last: null, first: null }
  }
  let min = Number(win[0].v)
  let max = min
  let sum = 0
  for (const item of win) {
    const v = Number(item.v)
    if (v < min) min = v
    if (v > max) max = v
    sum += v
  }
  return {
    count: list.length,
    valid,
    min,
    max,
    avg: sum / valid,
    last: Number(win[win.length - 1].v),
    first: Number(win[0].v),
  }
}

export function exportRangeCsv(opts = {}) {
  const now = opts.now != null ? Number(opts.now) : Date.now()
  const windowMs = opts.windowMs != null ? Number(opts.windowMs) : TREND_WINDOW_MS
  const cutoff = now - windowMs
  const start = opts.start != null ? Number(opts.start) : cutoff
  const end = opts.end != null ? Number(opts.end) : now
  const keys = Array.isArray(opts.keys) ? opts.keys.filter((k) => TREND.series.has(k)) : Array.from(TREND.series.keys()).slice(0, 8)
  const header = ['time', 'connectionId', 'deviceId', 'pointId', 'label', 'unit', 'value']
  const rows = [header.join(',')]
  const esc = (s) => {
    const str = String(s ?? '')
    if (str.includes(',') || str.includes('"') || str.includes('\n')) return '"' + str.replace(/"/g, '""') + '"'
    return str
  }
  for (const key of keys) {
    const list = TREND.series.get(key) || []
    const meta = TREND.meta.get(key) || {}
    for (const item of list) {
      if (item.t < start || item.t > end) continue
      const iso = new Date(item.t).toISOString()
      const v = item.v === null || item.v === undefined ? '' : String(item.v)
      rows.push([iso, esc(meta.connectionId || ''), esc(meta.deviceId || ''), esc(meta.pointId || ''), esc(meta.label || key), esc(meta.unit || ''), v].join(','))
    }
  }
  return rows.join('\n')
}

export function toUplotData(opts = {}) {
  const now = opts.now != null ? Number(opts.now) : Date.now()
  const windowMs = opts.windowMs != null ? Number(opts.windowMs) : TREND_WINDOW_MS
  const cutoff = now - windowMs
  const keys = opts.keys
    ? opts.keys.filter((k) => TREND.series.has(k)).slice(0, 8)
    : Array.from(TREND.series.keys()).slice(0, 8)
  const seriesLists = keys.map((k) => (TREND.series.get(k) || []).filter((item) => item.t >= cutoff))
  const timeSet = new Set()
  for (const list of seriesLists) for (const item of list) timeSet.add(item.t)
  const times = Array.from(timeSet).sort((a, b) => a - b)
  // uPlot expects x in seconds when scale x.time=true; we keep seconds for interop but raw ms also works — use seconds to match typical uPlot examples
  const xs = times.map((t) => t / 1000)
  const data = [xs]
  for (let si = 0; si < seriesLists.length; si++) {
    const list = seriesLists[si]
    const byTime = new Map(list.map((item) => [item.t, item.v]))
    const aligned = times.map((t) => {
      if (!byTime.has(t)) return null
      const v = byTime.get(t)
      return v === null || v === undefined ? null : Number(v)
    })
    data.push(aligned)
  }
  return { data, keys, meta: keys.map((k) => TREND.meta.get(k) || {}) }
}

// data-layer proto for future uPlot view — no runtime dependency, spanGaps:false keeps null gaps as breaks
export const UPLOT_PROTO = {
  width: 560,
  height: 190,
  scales: { x: { time: true }, y: { auto: true } },
  axes: [{ scale: 'x' }, { scale: 'y' }],
  series: [{ label: 'time' }],
  spanGaps: false,
  hooks: {},
}
