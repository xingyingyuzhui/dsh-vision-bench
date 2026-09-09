// @ts-check

export const TREND_KEEP_LOCAL = 600
export const MAX_FRAMES_PER_CONN = 500

/** @param {any} input */
export const normalizeTrendByPoint = (input) => {
  if (!input || typeof input !== 'object') return {}
  /** @type {Record<string, any>} */
  const out = {}
  for (const [pid, list] of Object.entries(input)) {
    if (!Array.isArray(list)) continue
    const clean = []
    for (const sample of list) {
      const t = Number(sample && (sample.t ?? sample[0]))
      if (!Number.isFinite(t) || t <= 0) continue
      const v = sample == null ? null : sample.v !== undefined ? sample.v : sample[1]
      clean.push([t, v === null || v === undefined ? null : Number(v)])
    }
    if (clean.length) out[pid] = clean.slice(-TREND_KEEP_LOCAL)
  }
  return out
}

/** @param {any} input */
export const normalizePolling = (input) => {
  const p = input && typeof input === 'object' ? input : {}
  const interval = Number(p.intervalMs)
  return {
    enabled: p.enabled === true,
    intervalMs: Number.isFinite(interval) && interval >= 200 && interval <= 10000 ? Math.trunc(interval) : 1000,
    lastAt: Number(p.lastAt) > 0 ? Number(p.lastAt) : 0,
    lastOk: p.lastOk !== false,
    error: typeof p.error === 'string' ? p.error.slice(0, 180) : '',
  }
}

/**
 * @param {any} input
 * @param {any[]} [connections]
 */
export const normalizePollingByConnection = (input, connections) => {
  /** @type {Record<string, any>} */
  const out = {}
  const base = connections || []
  for (const c of base) out[c.id] = normalizePolling(null)
  if (!input || typeof input !== 'object') return out
  for (const [k, v] of Object.entries(input)) {
    out[k] = normalizePolling(v)
  }
  return out
}

/**
 * @param {any} input
 * @param {any[]} [connections]
 */
export const normalizeFramesByConnection = (input, connections) => {
  /** @type {Record<string, any>} */
  const out = {}
  // NOTE (Task1/0.18.2): no pre-seeding of every connection id with []. Clear
  // semantics require the key to be ABSENT after deletion; readers use `|| []`.
  void connections
  if (!input || typeof input !== 'object') return out
  for (const [k, v] of Object.entries(input)) {
    const arr = Array.isArray(v) ? v.slice(0, MAX_FRAMES_PER_CONN) : []
    out[k] = arr
      .map((f) => {
        /** @type {any} */
        const rec = {
          t: Number(f && (f.t ?? f.at)) || Date.now(),
          label: typeof f?.label === 'string' ? String(f.label).slice(0, 200) : '',
          request: typeof f?.request === 'string' ? String(f.request).slice(0, 200) : '',
          response: typeof f?.response === 'string' ? String(f.response).slice(0, 200) : '',
          trace: Array.isArray(f?.trace)
            ? f.trace.map((/** @type {any} */ s) => String(s).slice(0, 200)).slice(0, 8)
            : [],
          deviceId: typeof f?.deviceId === 'string' ? f.deviceId : '',
          connectionId: typeof f?.connectionId === 'string' ? f.connectionId : k,
        }
        const rawId = f && (f.id || f.frameId) ? String(f.id || f.frameId).slice(0, 64) : ''
        if (rawId) {
          rec.id = rawId
          rec.frameId = String(f.frameId || rawId).slice(0, 64)
        } else if (f && typeof f.frameId === 'string') {
          rec.frameId = f.frameId.slice(0, 64)
          rec.id = rec.frameId
        }
        if (f && typeof f.transactionId === 'string') rec.transactionId = f.transactionId.slice(0, 64)
        if (f && typeof f.taskId === 'string') rec.taskId = f.taskId.slice(0, 64)
        if (f && typeof f.source === 'string') rec.source = f.source.slice(0, 16)
        if (f && typeof f.direction === 'string') rec.direction = f.direction.slice(0, 16)
        if (f && Number.isFinite(Number(f.unitId))) rec.unitId = Math.trunc(Number(f.unitId))
        if (f && Number.isFinite(Number(f.functionCode))) rec.functionCode = Math.trunc(Number(f.functionCode))
        if (f && Number.isFinite(Number(f.durationMs))) rec.durationMs = Math.trunc(Number(f.durationMs))
        if (f && typeof f.status === 'string') rec.status = f.status.slice(0, 16)
        if (f && typeof f.error === 'string') rec.error = f.error.slice(0, 200)
        if (f && typeof f.requestHex === 'string') rec.requestHex = f.requestHex.slice(0, 400)
        if (f && typeof f.responseHex === 'string') rec.responseHex = f.responseHex.slice(0, 400)
        if (f && (f.frameFormat === 'tcp-normalized' || f.frameFormat === 'rtu-adu')) rec.frameFormat = f.frameFormat
        return rec
      })
      .slice(-MAX_FRAMES_PER_CONN)
  }
  return out
}
