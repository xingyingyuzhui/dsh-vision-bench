export const TREND_CAP = 600
export const TREND_WINDOW_MS = 5 * 60 * 1000

// Task3/0.18.3: trend buffers are per-cwd. Sampling workspace B must never wipe
// or leak into workspace A, and reads always carry an explicit cwd.
const TREND_BY_CWD = new Map() // cwd -> { series: Map, meta: Map }

export function getTrendState(cwd) {
  let s = TREND_BY_CWD.get(cwd)
  if (!s) {
    s = { series: new Map(), meta: new Map(), cwd }
    TREND_BY_CWD.set(cwd, s)
  }
  return s
}

export function clearTrendState(cwd) {
  TREND_BY_CWD.delete(cwd)
}

// Back-compat accessor used by old callers; returns the DEFAULT (empty) scope.
// New code must use getTrendState(cwd) / the cwd-explicit helpers below.
export const TREND = { cwd: '', series: new Map(), meta: new Map() }

export const trendKey = (connectionId, deviceId, pointId) =>
  String(connectionId) + ':' + String(deviceId) + ':' + String(pointId)

export const sampleTrend = (cwd, pack) => {
  if (!cwd) return
  const state = getTrendState(cwd)
  const now = Date.now()
  const pointsById = {}
  for (const p of Array.isArray(pack.points) ? pack.points : []) pointsById[p.id] = p
  const values = Array.isArray(pack.values) ? pack.values : []
  for (const rec of values) {
    const pid = rec && (rec.pointId || rec.key)
    if (!pid || !pointsById[pid]) continue
    const pt = pointsById[pid]
    const key = trendKey(pt.connectionId || '', pt.deviceId || '', pid)
    state.meta.set(key, {
      label: pt.name || pid,
      unit: pt.unit || '',
      connectionId: pt.connectionId,
      deviceId: pt.deviceId,
      pointId: pid,
    })
    let list = state.series.get(key)
    if (!list) {
      list = []
      state.series.set(key, list)
    }
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

// stats for a single series window — null gaps ignored. Explicit cwd.
export function computeStats(cwd, keyOrList, opts = {}) {
  let list
  if (typeof keyOrList === 'string') {
    list = getTrendState(cwd).series.get(keyOrList) || []
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
  const win = list.filter(
    (item) => item && item.t >= cutoff && item.v !== null && item.v !== undefined && Number.isFinite(Number(item.v)),
  )
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

export function exportRangeCsv(cwd, opts = {}) {
  const state = getTrendState(cwd)
  const now = opts.now != null ? Number(opts.now) : Date.now()
  const windowMs = opts.windowMs != null ? Number(opts.windowMs) : TREND_WINDOW_MS
  const cutoff = now - windowMs
  const start = opts.start != null ? Number(opts.start) : cutoff
  const end = opts.end != null ? Number(opts.end) : now
  const keys = Array.isArray(opts.keys)
    ? opts.keys.filter((k) => state.series.has(k))
    : Array.from(state.series.keys()).slice(0, 8)
  const header = ['time', 'connectionId', 'deviceId', 'pointId', 'label', 'unit', 'value']
  const rows = [header.join(',')]
  const esc = (s) => {
    const str = String(s ?? '')
    if (str.includes(',') || str.includes('"') || str.includes('\n')) return '"' + str.replace(/"/g, '""') + '"'
    return str
  }
  for (const key of keys) {
    const list = state.series.get(key) || []
    const meta = state.meta.get(key) || {}
    for (const item of list) {
      if (item.t < start || item.t > end) continue
      const iso = new Date(item.t).toISOString()
      const v = item.v === null || item.v === undefined ? '' : String(item.v)
      rows.push(
        [
          iso,
          esc(meta.connectionId || ''),
          esc(meta.deviceId || ''),
          esc(meta.pointId || ''),
          esc(meta.label || key),
          esc(meta.unit || ''),
          v,
        ].join(','),
      )
    }
  }
  return rows.join('\n')
}

export function toUplotData(cwd, opts = {}) {
  const state = getTrendState(cwd)
  const now = opts.now != null ? Number(opts.now) : Date.now()
  const windowMs = opts.windowMs != null ? Number(opts.windowMs) : TREND_WINDOW_MS
  const cutoff = now - windowMs
  const keys = opts.keys
    ? opts.keys.filter((k) => state.series.has(k)).slice(0, 8)
    : Array.from(state.series.keys()).slice(0, 8)
  const seriesLists = keys.map((k) => (state.series.get(k) || []).filter((item) => item.t >= cutoff))
  const timeSet = new Set()
  for (const list of seriesLists) for (const item of list) timeSet.add(item.t)
  const times = Array.from(timeSet).sort((a, b) => a - b)
  // uPlot expects x in seconds when scale x.time=true; seconds match typical uPlot examples
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
  return { data, keys, meta: keys.map((k) => state.meta.get(k) || {}) }
}

// data-layer proto for uPlot view — no runtime dependency, spanGaps:false keeps null gaps as breaks
// Task2/0.20.1: 按组件 pointIds + windowMs 构造 uPlot ALIGNED data。
// 输出 [x秒..., s1..., s2...]：合并时间戳升序去重 → 毫秒转秒 → 每点位按统一
// 时间轴补 null（通信失败本就为 null 断点）→ 所有数组等长，点位顺序稳定。
export const trendDataForComponents = (trendStore, points, componentIds = [], windowMs = TREND_WINDOW_MS) => {
  const store = trendStore && typeof trendStore === 'object' ? trendStore : {}
  const byId = new Map((Array.isArray(points) ? points : []).map((p) => [p.id, p]))
  const ids = (Array.isArray(componentIds) ? componentIds : []).slice(0, 8)
  const now = Date.now()
  const cutoff = now - (Number(windowMs) > 0 ? Number(windowMs) : TREND_WINDOW_MS)
  // 收集每个点位的窗口样本与全局时间戳集合
  const seriesByPoint = new Map()
  const timeSet = new Set()
  for (const pid of ids) {
    const pt = byId.get(pid)
    const list = Array.isArray(store[pid]) ? store[pid] : []
    const samples = []
    for (const sv of list) {
      if (!Array.isArray(sv)) continue
      const t = Number(sv[0])
      if (!Number.isFinite(t) || t <= 0 || t < cutoff) continue
      samples.push([t, sv[1] == null ? null : Number(sv[1])])
      timeSet.add(t)
    }
    seriesByPoint.set(pid, { samples, pt })
  }
  const times = [...timeSet].sort((a, b) => a - b)
  const data = []
  const keys = []
  const meta = []
  if (times.length) {
    // 时间轴统一为秒（uPlot time scale）
    data.push(times.map((t) => t / 1000))
    for (const pid of ids) {
      const entry = seriesByPoint.get(pid)
      const pt = entry && entry.pt
      const samples = entry ? entry.samples : []
      const map = new Map(samples.map((sv) => [sv[0], sv[1]]))
      data.push(times.map((t) => (map.has(t) ? map.get(t) : null)))
      keys.push(pid)
      meta.push({
        label: pt ? pt.name || String(pid) : pid,
        unit: (pt && pt.unit) || '',
        connectionId: (pt && pt.connectionId) || '',
        deviceId: (pt && pt.deviceId) || '',
      })
      // 保留点位顺序：即使某点位零样本，也保留其 key/meta 位置，仅数据全 null
    }
  } else {
    for (const pid of ids) {
      keys.push(pid)
      const pt = byId.get(pid)
      meta.push({
        label: pt ? pt.name || String(pid) : pid,
        unit: (pt && pt.unit) || '',
        connectionId: (pt && pt.connectionId) || '',
        deviceId: (pt && pt.deviceId) || '',
      })
    }
  }
  return { data, keys, meta }
}

// TaskP2/0.20.0: 组件最新值（bar/value/switch 渲染源）
export const componentLatestValues = (values, points, componentIds = []) => {
  const byId = new Map((Array.isArray(values) ? values : []).map((v) => [v.key || v.pointId, v]))
  const ptsById = new Map((Array.isArray(points) ? points : []).map((p) => [p.id, p]))
  return (Array.isArray(componentIds) ? componentIds : []).map((pid) => {
    const pt = ptsById.get(pid)
    const rec = byId.get(pid)
    return {
      pointId: pid,
      name: pt ? pt.name : pid,
      unit: (pt && pt.unit) || '',
      value: rec && rec.ok ? rec.value : null,
      ok: !!(rec && rec.ok),
      at: (rec && rec.at) || 0,
    }
  })
}
export const UPLOT_PROTO = {
  width: 560,
  height: 190,
  scales: { x: { time: true }, y: { auto: true } },
  axes: [{ scale: 'x' }, { scale: 'y' }],
  series: [{ label: 'time' }],
  spanGaps: false,
  hooks: {},
}
