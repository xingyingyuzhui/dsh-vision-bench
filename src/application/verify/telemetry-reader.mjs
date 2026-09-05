// @ts-check

/**
 * Telemetry reading structure.
 * @typedef {{
 *   value: any,
 *   rawValue?: any,
 *   timestamp: number,
 *   status?: string,
 * }} TelemetryReading
 */

/**
 * Creates an authoritative TelemetryReader that retrieves real-time point values
 * from memory caches and active poll services rather than static workspace layout.
 *
 * @param {{
 *   workspaceCwd?: string,
 *   liveValues?: Map<string, TelemetryReading>,
 *   workspaceLoader?: (cwd: string) => any,
 *   readPointFn?: (pointId: string) => Promise<any>,
 * }} [options]
 */
export function createTelemetryReader(options = {}) {
  const workspaceCwd = options.workspaceCwd || ''
  const liveValues = options.liveValues || new Map()
  const workspaceLoader = options.workspaceLoader || (() => null)
  const readPointFn = options.readPointFn || null

  /** @type {Map<string, Set<(reading: TelemetryReading) => void>>} */
  const listenersByPoint = new Map()

  /**
   * Reads the current live value for a Modbus or sensor point ID.
   *
   * @param {string} pointId
   * @returns {Promise<TelemetryReading | null>}
   */
  async function readPoint(pointId) {
    if (!pointId) return null

    // 1. Check live in-memory value cache first
    if (liveValues.has(pointId)) {
      const cached = liveValues.get(pointId)
      if (cached) return cached
    }

    // 2. Query dynamic read provider if registered
    if (readPointFn) {
      try {
        const dynamicVal = await readPointFn(pointId)
        if (dynamicVal !== undefined && dynamicVal !== null) {
          const reading = {
            value: typeof dynamicVal === 'object' && 'value' in dynamicVal ? dynamicVal.value : dynamicVal,
            rawValue: typeof dynamicVal === 'object' && 'rawValue' in dynamicVal ? dynamicVal.rawValue : dynamicVal,
            timestamp: Date.now(),
            status: 'ok',
          }
          liveValues.set(pointId, reading)
          return reading
        }
      } catch {
        // Fall through to workspace fallback
      }
    }

    // 3. Fallback to latest workspace values
    if (workspaceCwd) {
      const ws = workspaceLoader(workspaceCwd)
      if (ws?.modbus) {
        // Check live values dictionary first
        if (ws.modbus.values && pointId in ws.modbus.values) {
          const v = ws.modbus.values[pointId]
          const reading = {
            value: v,
            rawValue: v,
            timestamp: Date.now(),
            status: 'ok',
          }
          liveValues.set(pointId, reading)
          return reading
        }

        // Check points list
        const pt = (ws.modbus.points || []).find((/** @type {any} */ p) => p.id === pointId)
        if (pt) {
          const val = pt.value !== undefined ? pt.value : pt.rawValue
          const reading = {
            value: val,
            rawValue: pt.rawValue !== undefined ? pt.rawValue : val,
            timestamp: pt.updatedAt || Date.now(),
            status: pt.status || 'ok',
          }
          liveValues.set(pointId, reading)
          return reading
        }
      }
    }

    return null
  }

  /**
   * Subscribes to live value changes for a specific point ID.
   *
   * @param {string} pointId
   * @param {(reading: TelemetryReading) => void} listener
   * @returns {() => void} Unsubscribe function
   */
  function subscribePoint(pointId, listener) {
    if (!pointId || typeof listener !== 'function') return () => {}

    let list = listenersByPoint.get(pointId)
    if (!list) {
      list = new Set()
      listenersByPoint.set(pointId, list)
    }
    list.add(listener)

    return () => {
      const set = listenersByPoint.get(pointId)
      if (set) {
        set.delete(listener)
        if (set.size === 0) {
          listenersByPoint.delete(pointId)
        }
      }
    }
  }

  /**
   * Publishes an incoming live telemetry sample into the reader and notifies subscribers.
   *
   * @param {string} pointId
   * @param {any} value
   * @param {any} [rawValue]
   */
  function publishPointValue(pointId, value, rawValue = undefined) {
    if (!pointId) return

    /** @type {TelemetryReading} */
    const reading = {
      value,
      rawValue: rawValue !== undefined ? rawValue : value,
      timestamp: Date.now(),
      status: 'ok',
    }

    liveValues.set(pointId, reading)

    const list = listenersByPoint.get(pointId)
    if (list) {
      for (const listener of list) {
        try {
          listener(reading)
        } catch {}
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
     */
    async readMultiple(pointIds) {
      /** @type {Record<string, any>} */
      const results = {}
      await Promise.all(
        (pointIds || []).map(async (pid) => {
          const r = await readPoint(pid)
          if (r) results[pid] = r.value
        }),
      )
      return results
    },
  }
}
