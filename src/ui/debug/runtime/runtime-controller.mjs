// @ts-check

import { postWithAbort } from '../../common/latest-request-gate.mjs'

/**
 * Controller providing RPC operations for the Debug subsystem.
 * Pure logic — does not hold DOM references.
 *
 * @param {(path: string, body?: any, timeout?: number) => Promise<any>} post
 * @param {{ cwd?: string, sessionId?: string }} scope
 */
export function createRuntimeController(post, scope) {
  const getCwd = () => scope?.cwd || ''
  const getSessionId = () => scope?.sessionId || ''

  return {
    /**
     * Fetch debug state (active session and pending approvals).
     * @param {string} [debugSessionId]
     */
    async getState(debugSessionId) {
      return post('/dsh-vision-bench/debug/state', {
        cwd: getCwd(),
        sessionId: getSessionId(),
        debugSessionId: debugSessionId || undefined,
      })
    },

    /**
     * Dispatch a debug command operation.
     * @param {string} op
     * @param {Record<string, any>} [payload]
     */
    async command(op, payload = {}) {
      return post('/dsh-vision-bench/debug/command', {
        cwd: getCwd(),
        sessionId: getSessionId(),
        op,
        ...payload,
      })
    },

    /**
     * Long-poll for debug events.
     * Supports AbortSignal for cleanly canceling polling on unmount or identity change.
     * @param {number} [cursor]
     * @param {AbortSignal} [signal]
     * @param {number} [timeoutMs]
     */
    async waitEvents(cursor = 0, signal = undefined, timeoutMs = 20000) {
      const body = {
        cwd: getCwd(),
        sessionId: getSessionId(),
        cursor: Math.max(0, Number(cursor) || 0),
        timeoutMs,
      }
      const rpcTimeout = timeoutMs + 5000
      if (signal) {
        return postWithAbort(post, '/dsh-vision-bench/debug/events/wait', body, signal, {
          timeoutMs: rpcTimeout,
          signal,
        })
      }
      return post('/dsh-vision-bench/debug/events/wait', body, rpcTimeout)
    },

    /**
     * Manage interactive debug approvals (list, approve, reject).
     * @param {string} op
     * @param {Record<string, any>} [payload]
     */
    async approval(op, payload = {}) {
      return post('/dsh-vision-bench/debug/approval', {
        cwd: getCwd(),
        sessionId: getSessionId(),
        op,
        ...payload,
      })
    },
  }
}
