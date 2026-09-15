// @ts-check
import { DEBUG_ERRORS, DebugError } from '../../domain/debug/errors.mjs'
import { sameCwd } from '../../shared/path-normalize.mjs'

const FAILED_SESSION_TTL_MS = 5 * 60 * 1000

/**
 * Session registry for DebugRuntime: active sessions, failed-start tombstones,
 * and owner waiters. Owns storage only — no backend lifecycle or lease policy.
 *
 * @returns {{
 *   sessions: Map<string, any>,
 *   failedSessions: Map<string, any>,
 *   ownerWaiters: Set<{ ownerSessionId: string, workspaceCwd: string, resolve: (session: any) => void }>,
 *   purgeFailedSessions: () => void,
 *   notifyOwnerWaiters: (session: any) => void,
 *   requireSession: (scope: { debugSessionId: string, ownerSessionId: string }) => any,
 *   toView: (session: any) => import('../../types/debug.d.ts').DebugSessionView,
 *   getFailedSession: (scope: { debugSessionId: string, ownerSessionId?: string }) => import('../../types/debug.d.ts').DebugSessionView | null,
 *   listFailedSessions: (scope?: { workspaceCwd?: string }) => import('../../types/debug.d.ts').DebugSessionView[],
 *   findOwnedSession: (scope: { ownerSessionId: string, workspaceCwd?: string, debugSessionId?: string }) => import('../../types/debug.d.ts').DebugSessionView | null,
 *   findSession: (predicate: (session: import('../../types/debug.d.ts').DebugSessionView) => boolean) => import('../../types/debug.d.ts').DebugSessionView | null,
 *   listSessions: () => import('../../types/debug.d.ts').DebugSessionView[],
 *   waitForOwnerSession: (scope: { ownerSessionId?: string, workspaceCwd?: string }, options?: { signal?: AbortSignal, timeoutMs?: number }) => Promise<any>,
 *   clearOwnerWaiters: () => void,
 * }}
 */
export function createDebugSessionRegistry() {
  /** @type {Map<string, any>} */
  const sessions = new Map()
  /**
   * Tombstones for sessions whose startup failed.
   * A failed `start()` used to delete the session outright; we retain the record
   * (with its `failure` field) for a short window so diagnostics can explain why.
   * @type {Map<string, any>}
   */
  const failedSessions = new Map()
  /** @type {Set<{ ownerSessionId: string, workspaceCwd: string, resolve: (session: any) => void }>} */
  const ownerWaiters = new Set()

  function purgeFailedSessions() {
    const cutoff = Date.now() - FAILED_SESSION_TTL_MS
    for (const [id, record] of failedSessions) {
      if ((record?.updatedAt || 0) < cutoff) failedSessions.delete(id)
    }
  }

  /**
   * @param {any} session
   */
  function notifyOwnerWaiters(session) {
    for (const waiter of [...ownerWaiters]) {
      if (!waiter.ownerSessionId || waiter.ownerSessionId !== session.ownerSessionId) continue
      if (!waiter.workspaceCwd || !sameCwd(waiter.workspaceCwd, session.workspaceCwd)) continue
      ownerWaiters.delete(waiter)
      waiter.resolve(session)
    }
  }

  /**
   * @param {{ debugSessionId: string, ownerSessionId: string }} scope
   */
  function requireSession(scope) {
    const session = sessions.get(scope.debugSessionId)
    if (!session) {
      throw new DebugError(DEBUG_ERRORS.NOT_FOUND, `调试会话不存在: ${scope.debugSessionId}`, {
        debugSessionId: scope.debugSessionId,
      })
    }
    if (scope.ownerSessionId && session.ownerSessionId !== scope.ownerSessionId) {
      throw new DebugError(DEBUG_ERRORS.NOT_OWNER, '无权操作该调试会话: 会话属主不匹配', {
        debugSessionId: scope.debugSessionId,
        expectedOwner: session.ownerSessionId,
      })
    }
    return session
  }

  /**
   * @param {any} session
   * @returns {import('../../types/debug.d.ts').DebugSessionView}
   */
  function toView(session) {
    return {
      debugSessionId: session.debugSessionId,
      workspaceCwd: session.workspaceCwd,
      ownerSessionId: session.ownerSessionId,
      backend: session.backendKind,
      state: session.state,
      location: session.location,
      stack: session.stack,
      variables: session.variables,
      breakpoints: Array.from(session.breakpoints.values()),
      watchpoints: Array.from(session.watchpoints.values()),
      targetKey: session.targetKey,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      ...(session.failure ? { failure: session.failure } : {}),
      ...(session.lastNonFatalError ? { lastNonFatalError: session.lastNonFatalError } : {}),
    }
  }

  return {
    sessions,
    failedSessions,
    ownerWaiters,
    purgeFailedSessions,
    notifyOwnerWaiters,
    requireSession,
    toView,

    /**
     * @param {{ debugSessionId: string, ownerSessionId?: string }} scope
     * @returns {import('../../types/debug.d.ts').DebugSessionView | null}
     */
    getFailedSession(scope) {
      purgeFailedSessions()
      const id = String(scope?.debugSessionId || '').trim()
      if (!id) return null
      const record = failedSessions.get(id)
      if (!record) return null
      const owner = String(scope?.ownerSessionId || '').trim()
      if (owner && record.ownerSessionId !== owner) return null
      return toView(record)
    },

    /**
     * @param {{ workspaceCwd?: string }} [scope]
     * @returns {import('../../types/debug.d.ts').DebugSessionView[]}
     */
    listFailedSessions(scope = {}) {
      purgeFailedSessions()
      const cwd = String(scope?.workspaceCwd || '').trim()
      return Array.from(failedSessions.values())
        .filter((record) => !cwd || sameCwd(record.workspaceCwd, cwd))
        .map(toView)
    },

    /**
     * @param {{ ownerSessionId: string, workspaceCwd?: string, debugSessionId?: string }} scope
     * @returns {import('../../types/debug.d.ts').DebugSessionView | null}
     */
    findOwnedSession(scope) {
      if (!scope?.ownerSessionId) return null
      if (scope.debugSessionId) {
        const session = sessions.get(scope.debugSessionId)
        if (!session || session.ownerSessionId !== scope.ownerSessionId) return null
        if (session.state === 'failed') return null
        if (scope.workspaceCwd && !sameCwd(session.workspaceCwd, scope.workspaceCwd)) return null
        return toView(session)
      }
      for (const session of sessions.values()) {
        if (session.ownerSessionId !== scope.ownerSessionId) continue
        if (session.state === 'failed') continue
        if (!scope.workspaceCwd || sameCwd(session.workspaceCwd, scope.workspaceCwd)) {
          return toView(session)
        }
      }
      return null
    },

    /**
     * @param {(session: import('../../types/debug.d.ts').DebugSessionView) => boolean} predicate
     * @returns {import('../../types/debug.d.ts').DebugSessionView | null}
     */
    findSession(predicate) {
      for (const session of sessions.values()) {
        if (session.state === 'failed') continue
        const view = toView(session)
        if (predicate(view)) {
          return view
        }
      }
      return null
    },

    /**
     * @returns {import('../../types/debug.d.ts').DebugSessionView[]}
     */
    listSessions() {
      return Array.from(sessions.values())
        .filter((session) => session.state !== 'failed')
        .map(toView)
    },

    /**
     * Park until an owned debug session exists.
     * @param {{ ownerSessionId?: string, workspaceCwd?: string }} scope
     * @param {{ signal?: AbortSignal, timeoutMs?: number }} [options]
     */
    async waitForOwnerSession(scope, options = {}) {
      const ownerSessionId = String(scope.ownerSessionId || '').trim()
      const workspaceCwd = String(scope.workspaceCwd || '').trim()
      if (!ownerSessionId || !workspaceCwd) return null
      for (const session of sessions.values()) {
        if (session.ownerSessionId !== ownerSessionId) continue
        if (!sameCwd(session.workspaceCwd, workspaceCwd)) continue
        return session
      }
      const signal = options.signal
      if (signal?.aborted) return null
      const timeoutMs = Math.min(Math.max(100, options.timeoutMs ?? 20000), 25000)
      return await new Promise((resolve) => {
        /** @type {{ ownerSessionId: string, workspaceCwd: string, resolve: (session: any) => void }} */
        const waiter = {
          ownerSessionId,
          workspaceCwd,
          resolve: (session) => {
            cleanup()
            resolve(session)
          },
        }
        const cleanup = () => {
          ownerWaiters.delete(waiter)
          if (timer) clearTimeout(timer)
          if (signal) signal.removeEventListener('abort', onAbort)
        }
        const onAbort = () => {
          cleanup()
          resolve(null)
        }
        const timer = setTimeout(() => {
          cleanup()
          resolve(null)
        }, timeoutMs)
        ownerWaiters.add(waiter)
        if (signal) {
          if (signal.aborted) onAbort()
          else signal.addEventListener('abort', onAbort, { once: true })
        }
      })
    },

    clearOwnerWaiters() {
      for (const waiter of [...ownerWaiters]) {
        ownerWaiters.delete(waiter)
        waiter.resolve(null)
      }
    },
  }
}
