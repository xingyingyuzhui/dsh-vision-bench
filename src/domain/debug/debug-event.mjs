// @ts-check

import { DEBUG_EVENT_TYPES } from '../../shared/debug-events.mjs'

export { DEBUG_EVENT_TYPES }
export { BACKEND_EVENT_TYPES, createBackendEvent } from './backend-event.mjs'

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
     * @returns {{ events: import('../../types/debug.d.ts').DebugEvent[], nextCursor: number, cursorExpired: boolean }}
     */
    getEventsSince(minCursor = 0, limit = 100) {
      const oldestCursor = buffer[0]?.cursor ?? nextCursor
      const cursorExpired = minCursor > 0 && minCursor < oldestCursor
      const events = buffer.filter((e) => e.cursor >= minCursor).slice(0, limit)
      return {
        events,
        nextCursor,
        cursorExpired,
      }
    },

    /**
     * Gets events strictly after cursor (e.cursor > afterCursor).
     * @param {number} [afterCursor=0]
     * @param {number} [limit=100]
     * @returns {{ events: import('../../types/debug.d.ts').DebugEvent[], nextCursor: number, cursorExpired: boolean }}
     */
    getEventsAfter(afterCursor = 0, limit = 100) {
      const oldestCursor = buffer[0]?.cursor ?? nextCursor
      const cursorExpired = afterCursor > 0 && afterCursor < oldestCursor - 1
      const events = buffer.filter((e) => e.cursor > afterCursor).slice(0, limit)
      const lastEvent = events[events.length - 1]
      return {
        events,
        nextCursor: lastEvent ? lastEvent.cursor : Math.max(afterCursor, oldestCursor - 1),
        cursorExpired,
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
     * @returns {Promise<{ events: import('../../types/debug.d.ts').DebugEvent[], nextCursor: number, cursorExpired: boolean }>}
     */
    async waitForEvents(minCursor, options = {}) {
      const oldestCursor = buffer[0]?.cursor ?? nextCursor
      const cursorExpired = minCursor > 0 && minCursor < oldestCursor
      const existing = buffer.filter((e) => e.cursor >= minCursor)
      if (existing.length > 0 || cursorExpired) {
        return {
          events: existing.slice(0, 100),
          nextCursor,
          cursorExpired,
        }
      }

      const signal = options.signal
      if (signal?.aborted) {
        return { events: [], nextCursor, cursorExpired: false }
      }

      return new Promise((resolve) => {
        let cleanup = () => {}
        /** @type {ReturnType<typeof setTimeout> | null} */
        let timer = null

        const onEvent = () => {
          const oldestCursor = buffer[0]?.cursor ?? nextCursor
          const cursorExpired = minCursor > 0 && minCursor < oldestCursor
          const matched = buffer.filter((e) => e.cursor >= minCursor)
          if (matched.length > 0 || cursorExpired) {
            cleanup()
            resolve({
              events: matched.slice(0, 100),
              nextCursor,
              cursorExpired,
            })
          }
        }

        const onAbort = () => {
          cleanup()
          resolve({ events: [], nextCursor, cursorExpired: false })
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
            resolve({ events: [], nextCursor, cursorExpired: false })
          }, timeout)
        }
      })
    },

    /**
     * Waits for events with cursor > afterCursor.
     * @param {number} afterCursor
     * @param {{ signal?: AbortSignal, timeoutMs?: number }} [options]
     * @returns {Promise<{ events: import('../../types/debug.d.ts').DebugEvent[], nextCursor: number, cursorExpired: boolean }>}
     */
    async waitForEventsAfter(afterCursor, options = {}) {
      const immediate = this.getEventsAfter(afterCursor)
      if (immediate.events.length > 0 || immediate.cursorExpired) {
        return immediate
      }

      const signal = options.signal
      if (signal?.aborted) {
        return { events: [], nextCursor: Math.max(afterCursor, nextCursor), cursorExpired: false }
      }

      return new Promise((resolve) => {
        let cleanup = () => {}
        /** @type {ReturnType<typeof setTimeout> | null} */
        let timer = null

        const onEvent = () => {
          const res = this.getEventsAfter(afterCursor)
          if (res.events.length > 0 || res.cursorExpired) {
            cleanup()
            resolve(res)
          }
        }

        const onAbort = () => {
          cleanup()
          resolve({ events: [], nextCursor: Math.max(afterCursor, nextCursor), cursorExpired: false })
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
            resolve({ events: [], nextCursor: Math.max(afterCursor, nextCursor), cursorExpired: false })
          }, timeout)
        }
      })
    },
  }
}
