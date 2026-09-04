// @ts-check
import { createDebugEventRing } from '../../domain/debug/debug-event.mjs'

/**
 * DebugEventService manages a session's bounded event ring,
 * monotonic cursor tracking, and long-polling waiters.
 * Parity with ADR-014 & Phase 4 Section 8.1.
 */
export class DebugEventService {
  /**
   * @param {{
   *   capacity?: number,
   *   debugSessionId?: string,
   *   ownerSessionId?: string,
   *   workspaceCwd?: string,
   * }} [options]
   */
  constructor(options = {}) {
    this.capacity = options.capacity || 512
    this.debugSessionId = options.debugSessionId || ''
    this.ownerSessionId = options.ownerSessionId || ''
    this.workspaceCwd = options.workspaceCwd || ''
    this.ring = createDebugEventRing(this.capacity)
    this.closed = false
    /** @type {Set<() => void>} */
    this._closeWaiters = new Set()
  }

  /**
   * Appends an event to the ring buffer.
   * @param {Omit<import('../../types/debug.d.ts').DebugEvent, 'cursor' | 'id' | 'timestamp'> & { payload?: any }} event
   * @returns {import('../../types/debug.d.ts').DebugEvent}
   */
  append(event) {
    if (this.closed) {
      throw new Error('调试事件服务已关闭，无法写入新事件')
    }
    return this.ring.push(event)
  }

  /**
   * Retrieves events with cursor >= minCursor up to limit.
   * @param {number} [cursor=0]
   * @param {number} [limit=100]
   * @returns {{ events: import('../../types/debug.d.ts').DebugEvent[], nextCursor: number, closed: boolean }}
   */
  listAfter(cursor = 0, limit = 100) {
    const res = this.ring.getEventsSince(cursor, limit)
    return {
      events: res.events,
      nextCursor: res.nextCursor,
      closed: this.closed,
    }
  }

  /**
   * Waits for events with cursor >= minCursor via long-polling.
   * Resolves immediately if events exist, or suspends up to timeoutMs (default 20s, max 25s).
   *
   * @param {number} cursor
   * @param {{
   *   signal?: AbortSignal,
   *   timeoutMs?: number,
   *   limit?: number,
   * }} [options]
   * @returns {Promise<{ events: import('../../types/debug.d.ts').DebugEvent[], nextCursor: number, closed: boolean }>}
   */
  async waitAfter(cursor, options = {}) {
    if (this.closed) {
      return { events: [], nextCursor: cursor, closed: true }
    }

    const limit = options.limit || 100
    const immediate = this.ring.getEventsSince(cursor, limit)
    if (immediate.events.length > 0) {
      return {
        events: immediate.events,
        nextCursor: immediate.nextCursor,
        closed: this.closed,
      }
    }

    const signal = options.signal
    if (signal?.aborted) {
      return { events: [], nextCursor: cursor, closed: this.closed }
    }

    const timeoutMs = Math.min(Math.max(100, options.timeoutMs ?? 20000), 25000)

    return new Promise((resolve) => {
      /** @type {(() => void) | null} */
      let cleanup = null
      /** @type {NodeJS.Timeout | null} */
      let timer = null

      const done = (
        /** @type {{ events: import('../../types/debug.d.ts').DebugEvent[], nextCursor: number, closed: boolean }} */ result,
      ) => {
        if (cleanup) cleanup()
        resolve(result)
      }

      const onClose = () => {
        done({ events: [], nextCursor: cursor, closed: true })
      }

      const onAbort = () => {
        done({ events: [], nextCursor: cursor, closed: this.closed })
      }

      this._closeWaiters.add(onClose)
      if (signal) signal.addEventListener('abort', onAbort, { once: true })

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          done({ events: [], nextCursor: cursor, closed: this.closed })
        }, timeoutMs)
      }

      cleanup = () => {
        this._closeWaiters.delete(onClose)
        if (timer) clearTimeout(timer)
        if (signal) signal.removeEventListener('abort', onAbort)
      }

      // Delegate ring listener
      this.ring
        .waitForEvents(cursor, { signal, timeoutMs })
        .then((res) => {
          done({
            events: res.events,
            nextCursor: res.nextCursor,
            closed: this.closed,
          })
        })
        .catch(() => {
          done({ events: [], nextCursor: cursor, closed: this.closed })
        })
    })
  }

  /**
   * Closes the event service and wakes up all pending waiters with closed: true.
   */
  close() {
    if (this.closed) return
    this.closed = true
    for (const waiter of this._closeWaiters) {
      try {
        waiter()
      } catch {
        /* ignore */
      }
    }
    this._closeWaiters.clear()
  }
}

/**
 * Creates an instance of DebugEventService.
 * @param {ConstructorParameters<typeof DebugEventService>[0]} [options]
 */
export function createDebugEventService(options) {
  return new DebugEventService(options)
}
