// @ts-check

/**
 * @typedef {{
 *   value: any,
 *   rawValue: any,
 *   timestamp: number,
 *   source: 'poll-cache' | 'direct-read',
 *   freshnessMs: number,
 *   quality: 'good' | 'stale' | 'unknown',
 * }} LiveTelemetryReading
 */

/**
 * Creates an authoritative VerifyTelemetryAdapter that ensures readings come ONLY
 * from active polling caches or direct Modbus reads, rejecting static points defaults.
 *
 * @param {{
 *   getHome?: () => string,
 *   workspaceLoader?: (cwd: string) => any,
 *   modbusReadFn?: (home: string, cwd: string, body: any, opts?: any) => Promise<any>,
 *   liveCache?: Map<string, LiveTelemetryReading>,
 * }} [deps]
 */
export function createVerifyTelemetryAdapter(deps = {}) {
  const getHome = deps.getHome || (() => '')
  const workspaceLoader = deps.workspaceLoader || (() => null)
  const modbusReadFn = deps.modbusReadFn || null
  /** @type {Map<string, LiveTelemetryReading>} */
  const liveCache = deps.liveCache || new Map()
  /** @type {Map<string, Set<(reading: LiveTelemetryReading) => void>>} */
  const listeners = new Map()

  /**
   * Reads an authoritative point value.
   *
   * @param {{ cwd?: string, sessionId?: string } | string} scopeOrPointId
   * @param {string | { maxAgeMs?: number }} [pointIdOrOptions]
   * @param {{ maxAgeMs?: number }} [maybeOptions]
   * @returns {Promise<LiveTelemetryReading | null>}
   */
  async function readPoint(scopeOrPointId, pointIdOrOptions, maybeOptions) {
    let cwd = ''
    let sessionId = ''
    let pointId = ''
    /** @type {{ maxAgeMs?: number }} */
    let options = {}

    if (typeof scopeOrPointId === 'string') {
      pointId = scopeOrPointId
      if (pointIdOrOptions && typeof pointIdOrOptions === 'object') {
        options = pointIdOrOptions
      }
    } else if (scopeOrPointId && typeof scopeOrPointId === 'object') {
      cwd = scopeOrPointId.cwd || ''
      sessionId = scopeOrPointId.sessionId || ''
      pointId = typeof pointIdOrOptions === 'string' ? pointIdOrOptions : ''
      if (maybeOptions && typeof maybeOptions === 'object') {
        options = maybeOptions
      }
    }

    if (!pointId) return null

    const maxAgeMs = typeof options.maxAgeMs === 'number' ? options.maxAgeMs : Number.POSITIVE_INFINITY
    const cacheKey = cwd ? `${cwd}:${pointId}` : pointId
    const now = Date.now()

    // 1. Check in-memory liveCache
    if (liveCache.has(cacheKey)) {
      const cached = liveCache.get(cacheKey)
      if (cached) {
        const freshnessMs = Math.max(0, now - cached.timestamp)
        const isStale = freshnessMs > maxAgeMs
        /** @type {'good' | 'stale'} */
        const quality = isStale ? 'stale' : 'good'
        const reading = {
          ...cached,
          freshnessMs,
          quality,
        }
        return reading
      }
    }

    // 2. Check workspace live poll values (modbus.values)
    // NOTE: Strictly check `modbus.values` (which are written by live polling with timestamp `at`),
    // NEVER fall back to static `points[].value`.
    if (cwd) {
      const ws = workspaceLoader(cwd)
      if (ws?.modbus?.values) {
        let valEntry = null
        if (Array.isArray(ws.modbus.values)) {
          valEntry = ws.modbus.values.find((/** @type {any} */ v) => v && (v.pointId === pointId || v.key === pointId))
        } else if (typeof ws.modbus.values === 'object' && pointId in ws.modbus.values) {
          valEntry = ws.modbus.values[pointId]
        }

        if (valEntry && typeof valEntry === 'object' && valEntry.at) {
          const timestamp = Number(valEntry.at) || now
          const freshnessMs = Math.max(0, now - timestamp)
          const isStale = freshnessMs > maxAgeMs
          const value = valEntry.val !== undefined ? valEntry.val : valEntry.value
          const rawValue = valEntry.raw !== undefined ? valEntry.raw : (valEntry.rawValue ?? value)
          /** @type {LiveTelemetryReading} */
          const reading = {
            value,
            rawValue,
            timestamp,
            source: 'poll-cache',
            freshnessMs,
            quality: isStale ? 'stale' : 'good',
          }
          liveCache.set(cacheKey, reading)
          return reading
        }
      }
    }

    // 3. Direct Modbus read service
    if (modbusReadFn && cwd) {
      try {
        const home = getHome()
        const res = await modbusReadFn(home, cwd, { pointId, sessionId }, { sessionId })
        if (res && (res.ok || res.value !== undefined || res.rawValue !== undefined)) {
          const value = res.value !== undefined ? res.value : res.rawValue
          const rawValue = res.rawValue !== undefined ? res.rawValue : value
          /** @type {LiveTelemetryReading} */
          const reading = {
            value,
            rawValue,
            timestamp: now,
            source: 'direct-read',
            freshnessMs: 0,
            quality: 'good',
          }
          liveCache.set(cacheKey, reading)
          publishPointValue(pointId, reading, cwd)
          return reading
        }
      } catch {
        // Fall through to NO DATA
      }
    }

    // 4. NO DATA - strictly return null (no fake static fallback)
    return null
  }

  /**
   * Subscribes to live readings for a point.
   *
   * @param {{ cwd?: string, sessionId?: string } | string} scopeOrPointId
   * @param {string | ((reading: LiveTelemetryReading) => void)} pointIdOrListener
   * @param {((reading: LiveTelemetryReading) => void)} [maybeListener]
   * @returns {() => void}
   */
  function subscribePoint(scopeOrPointId, pointIdOrListener, maybeListener) {
    let pointId = ''
    let listener = null
    let cwd = ''

    if (typeof scopeOrPointId === 'string') {
      pointId = scopeOrPointId
      if (typeof pointIdOrListener === 'function') {
        listener = pointIdOrListener
      }
    } else if (scopeOrPointId && typeof scopeOrPointId === 'object') {
      cwd = scopeOrPointId.cwd || ''
      pointId = typeof pointIdOrListener === 'string' ? pointIdOrListener : ''
      if (typeof maybeListener === 'function') {
        listener = maybeListener
      }
    }

    if (!pointId || !listener) return () => {}

    const key = cwd ? `${cwd}:${pointId}` : pointId
    let set = listeners.get(key)
    if (!set) {
      set = new Set()
      listeners.set(key, set)
    }
    set.add(listener)

    return () => {
      const s = listeners.get(key)
      if (s) {
        s.delete(listener)
        if (s.size === 0) listeners.delete(key)
      }
    }
  }

  /**
   * Publishes a live telemetry sample.
   *
   * @param {string} pointId
   * @param {any} valueOrReading
   * @param {string} [cwd]
   */
  function publishPointValue(pointId, valueOrReading, cwd = '') {
    if (!pointId) return
    const key = cwd ? `${cwd}:${pointId}` : pointId
    const now = Date.now()

    /** @type {LiveTelemetryReading} */
    const reading =
      valueOrReading && typeof valueOrReading === 'object' && 'timestamp' in valueOrReading
        ? valueOrReading
        : {
            value: valueOrReading,
            rawValue: valueOrReading,
            timestamp: now,
            source: 'poll-cache',
            freshnessMs: 0,
            quality: 'good',
          }

    liveCache.set(key, reading)
    if (cwd) liveCache.set(pointId, reading)

    const dispatchKeys = [key]
    if (cwd) dispatchKeys.push(pointId)

    for (const k of dispatchKeys) {
      const set = listeners.get(k)
      if (set) {
        for (const fn of set) {
          try {
            fn(reading)
          } catch {}
        }
      }
    }
  }

  return {
    readPoint,
    subscribePoint,
    publishPointValue,
    /**
     * Reads multiple points concurrently.
     * @param {string[]} pointIds
     * @param {{ cwd?: string, sessionId?: string }} [scope]
     */
    async readMultiple(pointIds, scope) {
      /** @type {Record<string, any>} */
      const results = {}
      await Promise.all(
        (pointIds || []).map(async (pid) => {
          const r = await readPoint(scope || '', pid)
          if (r && r.quality === 'good') results[pid] = r.value
        }),
      )
      return results
    },
  }
}
