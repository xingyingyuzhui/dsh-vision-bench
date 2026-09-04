// @ts-check

export const DEBUG_EVENT_TYPES = {
  SESSION_STARTING: 'debug.session.starting',
  SESSION_READY: 'debug.session.ready',
  SESSION_STOPPED: 'debug.session.stopped',
  SESSION_FAILED: 'debug.session.failed',
  SESSION_CLOSED: 'debug.session.closed',
  RUNNING: 'debug.running',
  PAUSED: 'debug.paused',
  STEP_COMPLETE: 'debug.step.complete',
  BREAKPOINT_CREATED: 'debug.breakpoint.created',
  BREAKPOINT_REMOVED: 'debug.breakpoint.removed',
  BREAKPOINT_HIT: 'debug.breakpoint.hit',
  WATCHPOINT_CREATED: 'debug.watchpoint.created',
  WATCHPOINT_REMOVED: 'debug.watchpoint.removed',
  WATCHPOINT_HIT: 'debug.watchpoint.hit',
  SNAPSHOT_CREATED: 'debug.snapshot.created',
  EXCEPTION: 'debug.exception',
  CONSOLE: 'debug.console',
}

/**
 * Creates a normalized DebugEvent object.
 *
 * @param {Omit<import('../../types/debug.d.ts').DebugEvent, 'id' | 'timestamp'> & { id?: string, timestamp?: number }} data
 * @returns {import('../../types/debug.d.ts').DebugEvent}
 */
export function createDebugEvent(data) {
  return {
    id: data.id || `ev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    cursor: typeof data.cursor === 'number' ? data.cursor : 0,
    debugSessionId: data.debugSessionId,
    workspaceCwd: data.workspaceCwd,
    ownerSessionId: data.ownerSessionId,
    timestamp: data.timestamp || Date.now(),
    type: data.type,
    backend: data.backend,
    payload: data.payload || {},
  }
}

/**
 * Creates a circular event buffer with cursor-based long polling.
 *
 * @param {number} [capacity=500]
 */
export function createDebugEventRing(capacity = 500) {
  /** @type {import('../../types/debug.d.ts').DebugEvent[]} */
  const buffer = []
  let nextCursor = 1
  /** @type {Set<() => void>} */
  const listeners = new Set()

  return {
    /**
     * Appends an event to the ring buffer and notifies listeners.
     * @param {Omit<import('../../types/debug.d.ts').DebugEvent, 'cursor' | 'id' | 'timestamp'> & { payload?: any }} item
     * @returns {import('../../types/debug.d.ts').DebugEvent}
     */
    push(item) {
      const cursor = nextCursor++
      const event = createDebugEvent({
        ...item,
        cursor,
      })
      buffer.push(event)
      if (buffer.length > capacity) {
        buffer.shift()
      }
      for (const notify of listeners) {
        notify()
      }
      return event
    },

    /**
     * Gets events with cursor >= minCursor up to limit.
     * @param {number} [minCursor=0]
     * @param {number} [limit=100]
     * @returns {{ events: import('../../types/debug.d.ts').DebugEvent[], nextCursor: number }}
     */
    getEventsSince(minCursor = 0, limit = 100) {
      const events = buffer.filter((e) => e.cursor >= minCursor).slice(0, limit)
      return {
        events,
        nextCursor,
      }
    },

    /**
     * Current cursor position.
     * @returns {number}
     */
    getCurrentCursor() {
      return nextCursor
    },

    /**
     * Waits for events with cursor >= minCursor.
     * @param {number} minCursor
     * @param {{ signal?: AbortSignal, timeoutMs?: number }} [options]
     * @returns {Promise<{ events: import('../../types/debug.d.ts').DebugEvent[], nextCursor: number }>}
     */
    async waitForEvents(minCursor, options = {}) {
      const existing = buffer.filter((e) => e.cursor >= minCursor)
      if (existing.length > 0) {
        return {
          events: existing.slice(0, 100),
          nextCursor,
        }
      }

      const signal = options.signal
      if (signal?.aborted) {
        return { events: [], nextCursor }
      }

      return new Promise((resolve) => {
        let cleanup = () => {}
        /** @type {ReturnType<typeof setTimeout> | null} */
        let timer = null

        const onEvent = () => {
          const matched = buffer.filter((e) => e.cursor >= minCursor)
          if (matched.length > 0) {
            cleanup()
            resolve({
              events: matched.slice(0, 100),
              nextCursor,
            })
          }
        }

        const onAbort = () => {
          cleanup()
          resolve({ events: [], nextCursor })
        }

        cleanup = () => {
          listeners.delete(onEvent)
          if (timer) clearTimeout(timer)
          if (signal) signal.removeEventListener('abort', onAbort)
        }

        listeners.add(onEvent)
        if (signal) signal.addEventListener('abort', onAbort, { once: true })

        const timeout = options.timeoutMs ?? 25000
        if (timeout > 0) {
          timer = setTimeout(() => {
            cleanup()
            resolve({ events: [], nextCursor })
          }, timeout)
        }
      })
    },
  }
}
