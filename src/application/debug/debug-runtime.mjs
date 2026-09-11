// @ts-check
import { DEBUG_EVENT_TYPES, createDebugEventRing } from '../../domain/debug/debug-event.mjs'
import { canTransition, transition } from '../../domain/debug/debug-state.mjs'
import { DEBUG_ERRORS, DebugError } from '../../domain/debug/errors.mjs'
import { TargetLeaseManager } from '../../domain/debug/target-lease.mjs'
import { executeDebugCommand } from './debug-command-executor.mjs'
import { reduceBackendEvent } from './debug-event-reducer.mjs'
import { withDebugEventPersistence } from './debug-event-sink.mjs'
import { sameCwd } from '../../shared/path-normalize.mjs'

/**
 * Creates the host authoritative DebugRuntime service shell.
 * Parity with ADR-013 & Phase 2 application architecture.
 *
 * @param {{
 *   leaseManager?: TargetLeaseManager,
 *   backendFactory?: (backendKind: import('../../types/debug.d.ts').DebugBackendKind, ctx: any) => Promise<any>,
 *   onJournalEvent?: ((event: any) => Promise<void>) | null,
 *   home?: string,
 * }} [deps]
 */
export function createDebugRuntime(deps = {}) {
  const leaseManager = deps.leaseManager || new TargetLeaseManager()
  const backendFactory =
    deps.backendFactory ||
    (async (kind, ctx) => {
      if (kind === 'keil-simulator') {
        const { KeilSimBackend } = await import('../../infrastructure/debug/keil/keil-sim-backend.mjs')
        return new KeilSimBackend(ctx)
      }
      if (kind === 'gdb-openocd') {
        const { GdbBackend } = await import('../../infrastructure/debug/gdb-mi/gdb-backend.mjs')
        return new GdbBackend(ctx)
      }
      throw new DebugError(DEBUG_ERRORS.BACKEND_UNAVAILABLE, `调试后端暂不可用: ${kind}`)
    })
  const onJournalEvent = deps.onJournalEvent || null
  const home = String(deps.home || '').trim()

  /** @type {Map<string, {
   *   debugSessionId: string,
   *   ownerSessionId: string,
   *   workspaceCwd: string,
   *   backendKind: import('../../types/debug.d.ts').DebugBackendKind,
   *   backend: any,
   *   lease: any,
   *   state: import('../../types/debug.d.ts').DebugRunState,
   *   eventRing: ReturnType<typeof createDebugEventRing>,
   *   location: import('../../types/debug.d.ts').SourceLocation | null,
   *   stack: import('../../types/debug.d.ts').DebugStackFrame[],
   *   variables: import('../../types/debug.d.ts').DebugVariable[],
   *   breakpoints: Map<string, import('../../types/debug.d.ts').DebugBreakpoint>,
   *   watchpoints: Map<string, import('../../types/debug.d.ts').DebugWatchpoint>,
   *   snapshots: import('../../types/debug.d.ts').DebugSnapshot[],
   *   targetKey: string,
   *   targetSpec?: Record<string, any>,
   *   unsubscribeBackend?: (() => void) | null,
   *   pendingExecution?: { type: string, [key: string]: any } | null,
   *   isStopping?: boolean,
   *   createdAt: number,
   *   updatedAt: number,
   * }>} */
  const sessions = new Map()
  /** @type {Set<{ ownerSessionId: string, workspaceCwd: string, resolve: (session: any) => void }>} */
  const ownerWaiters = new Set()

  /**
   * Tombstones for sessions whose startup failed.
   *
   * A failed `start()` used to delete the session outright, which made the
   * failure completely invisible: `status` reported `active: false` and nothing
   * anywhere recorded *why*. We retain the record (with its `failure` field) for
   * a short window so diagnostics can answer "what went wrong".
   *
   * @type {Map<string, any>}
   */
  const failedSessions = new Map()
  const FAILED_SESSION_TTL_MS = 5 * 60 * 1000

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
   * Helper to verify session ownership.
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
   * Formats a session into a public DebugSessionView.
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
    getLeaseManager() {
      return leaseManager
    },

    /**
     * Starts a new debug session.
     * Acquires exclusive target lease and initializes backend.
     *
     * @param {{
     *   debugSessionId?: string,
     *   ownerSessionId: string,
     *   workspaceCwd: string,
     *   backend?: import('../../types/debug.d.ts').DebugBackendKind,
     *   targetSpec?: Record<string, any>,
     * }} spec
     * @returns {Promise<import('../../types/debug.d.ts').DebugSessionView>}
     */
    async start(spec) {
      const debugSessionId = spec.debugSessionId || `ds_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const backendKind = spec.backend || 'gdb-openocd'
      const ownerSessionId = spec.ownerSessionId
      const workspaceCwd = spec.workspaceCwd

      if (!ownerSessionId) {
        throw new DebugError(DEBUG_ERRORS.NOT_OWNER, '启动调试必须指定 ownerSessionId')
      }

      // 1. Acquire target lease
      const lease = leaseManager.acquireLease(spec.targetSpec || {}, {
        sessionId: debugSessionId,
        ownerSessionId,
        workspaceCwd,
      })

      const eventRing = withDebugEventPersistence(createDebugEventRing(500), { home })
      const state = transition('idle', 'starting')

      eventRing.push({
        debugSessionId,
        ownerSessionId,
        workspaceCwd,
        backend: backendKind,
        type: DEBUG_EVENT_TYPES.SESSION_STARTING,
        payload: { targetKey: lease.targetKey },
      })

      /** @type {any} */
      const sessionRecord = {
        debugSessionId,
        ownerSessionId,
        workspaceCwd,
        backendKind,
        backend: null,
        lease,
        state,
        eventRing,
        location: null,
        stack: [],
        variables: [],
        breakpoints: new Map(),
        watchpoints: new Map(),
        snapshots: [],
        targetKey: lease.targetKey,
        targetSpec: spec.targetSpec || {},
        unsubscribeBackend: null,
        pendingExecution: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isStopping: false,
      }

      sessions.set(debugSessionId, sessionRecord)
      notifyOwnerWaiters(sessionRecord)

      try {
        const backend = await backendFactory(backendKind, {
          debugSessionId,
          ownerSessionId,
          workspaceCwd,
          targetSpec: spec.targetSpec,
          eventRing,
        })
        sessionRecord.backend = backend

        if (backend && typeof backend.subscribe === 'function') {
          sessionRecord.unsubscribeBackend = backend.subscribe((/** @type {any} */ backendEvent) => {
            reduceBackendEvent(sessionRecord, backendEvent)
          })
        }

        if (backend && typeof backend.start === 'function') {
          await backend.start(spec)
        }

        if (sessionRecord.state === 'starting') {
          sessionRecord.state = transition(sessionRecord.state, 'ready')
        }
        if (sessionRecord.state === 'failed') {
          // The backend reported failure through its event stream but returned
          // normally. Surface it as an error instead of letting the caller
          // believe the session came up.
          throw new DebugError(
            DEBUG_ERRORS.BACKEND_UNAVAILABLE,
            sessionRecord.failure?.message || '调试后端启动后立即失败',
          )
        }
        sessionRecord.updatedAt = Date.now()
        if (backend && typeof backend.lastNonFatalError === 'string' && backend.lastNonFatalError) {
          sessionRecord.lastNonFatalError = backend.lastNonFatalError
        }

        eventRing.push({
          debugSessionId,
          ownerSessionId,
          workspaceCwd,
          backend: backendKind,
          type: DEBUG_EVENT_TYPES.SESSION_READY,
          payload: { targetKey: lease.targetKey },
        })

        if (onJournalEvent) {
          await onJournalEvent({
            action: 'debug-start',
            ok: true,
            summary: `硬件调试已启动: ${backendKind} (${lease.targetKey})`,
            cwd: workspaceCwd,
            sessionId: ownerSessionId,
            debugSessionId,
          }).catch(() => {})
        }

        return toView(sessionRecord)
      } catch (err) {
        sessionRecord.state = 'failed'
        sessionRecord.updatedAt = Date.now()
        sessionRecord.failure = {
          message: err instanceof Error ? err.message : String(err),
          errorCode: /** @type {any} */ (err)?.errorCode || /** @type {any} */ (err)?.code || DEBUG_ERRORS.BACKEND_UNAVAILABLE,
          stack: err instanceof Error ? err.stack : undefined,
          at: Date.now(),
        }
        eventRing.push({
          debugSessionId,
          ownerSessionId,
          workspaceCwd,
          backend: backendKind,
          type: DEBUG_EVENT_TYPES.SESSION_FAILED,
          payload: {
            error: sessionRecord.failure.message,
            errorCode: sessionRecord.failure.errorCode,
          },
        })
        if (sessionRecord.unsubscribeBackend) {
          try {
            sessionRecord.unsubscribeBackend()
          } catch {}
          sessionRecord.unsubscribeBackend = null
        }
        if (sessionRecord.backend && typeof sessionRecord.backend.stop === 'function') {
          try {
            await sessionRecord.backend.stop()
          } catch {}
        }
        leaseManager.releaseLease(debugSessionId, ownerSessionId)
        // Retain a tombstone instead of dropping the record, so the failure is
        // still explainable after the fact. `sessions` stays clean so the
        // session never looks "active".
        sessionRecord.backend = null
        purgeFailedSessions()
        failedSessions.set(debugSessionId, sessionRecord)
        sessions.delete(debugSessionId)
        throw err
      }
    },

    /**
     * Stops an active debug session and releases target lease.
     *
     * @param {{ debugSessionId: string, ownerSessionId: string }} scope
     */
    async stop(scope) {
      const session = sessions.get(scope.debugSessionId)
      if (!session) {
        return { ok: true, alreadyStopped: true }
      }

      if (scope.ownerSessionId && session.ownerSessionId !== scope.ownerSessionId) {
        throw new DebugError(DEBUG_ERRORS.NOT_OWNER, '无权停止该调试会话: 会话属主不匹配', {
          debugSessionId: scope.debugSessionId,
        })
      }

      session.isStopping = true
      if (canTransition(session.state, 'stopping')) {
        session.state = transition(session.state, 'stopping')
      }

      try {
        if (session.backend && typeof session.backend.stop === 'function') {
          await session.backend.stop()
        }
      } finally {
        if (session.unsubscribeBackend) {
          try {
            session.unsubscribeBackend()
          } catch {
            /* ignore */
          }
          session.unsubscribeBackend = null
        }

        leaseManager.releaseLease(session.debugSessionId, session.ownerSessionId)

        if (canTransition(session.state, 'idle')) {
          session.state = transition(session.state, 'idle')
        } else {
          session.state = 'idle'
        }

        session.eventRing.push({
          debugSessionId: session.debugSessionId,
          ownerSessionId: session.ownerSessionId,
          workspaceCwd: session.workspaceCwd,
          backend: session.backendKind,
          type: DEBUG_EVENT_TYPES.SESSION_STOPPED,
        })

        session.eventRing.push({
          debugSessionId: session.debugSessionId,
          ownerSessionId: session.ownerSessionId,
          workspaceCwd: session.workspaceCwd,
          backend: session.backendKind,
          type: DEBUG_EVENT_TYPES.SESSION_CLOSED,
        })

        if (onJournalEvent) {
          await onJournalEvent({
            action: 'debug-stop',
            ok: true,
            summary: `硬件调试已停止: ${session.debugSessionId}`,
            cwd: session.workspaceCwd,
            sessionId: session.ownerSessionId,
            debugSessionId: session.debugSessionId,
          }).catch(() => {})
        }

        sessions.delete(session.debugSessionId)
      }

      return { ok: true, debugSessionId: scope.debugSessionId }
    },

    /**
     * Executes a debug command against the active session.
     *
     * @param {{ debugSessionId: string, ownerSessionId: string }} scope
     * @param {{ type: string, [key: string]: any }} command
     */
    async command(scope, command) {
      const session = requireSession(scope)
      return executeDebugCommand(session, command, { onJournalEvent })
    },

    /**
     * Gets the state snapshot view of a debug session.
     *
     * @param {{ debugSessionId: string, ownerSessionId?: string }} scope
     * @returns {import('../../types/debug.d.ts').DebugSessionView}
     */
    state(scope) {
      const session = requireSession({
        debugSessionId: scope.debugSessionId,
        ownerSessionId: scope.ownerSessionId || '',
      })
      return toView(session)
    },

    /**
     * Returns the tombstone of a session whose startup failed, if still within
     * the retention window. Used purely for diagnostics: a failed `start()` no
     * longer leaves the caller with nothing to inspect.
     *
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
     * Lists recent failed-session tombstones for a workspace.
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
     * Finds an active session owned by ownerSessionId with optional debugSessionId and workspaceCwd.
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
     * Finds an active session matching the predicate (internal).
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
     * Lists all active debug sessions.
     * @returns {import('../../types/debug.d.ts').DebugSessionView[]}
     */
    listSessions() {
      return Array.from(sessions.values())
        .filter((session) => session.state !== 'failed')
        .map(toView)
    },

    /**
     * Gets events strictly after cursor (event.cursor > afterCursor).
     *
     * @param {{ debugSessionId: string, ownerSessionId?: string }} scope
     * @param {number} [afterCursor=0]
     * @param {number} [limit=100]
     * @returns {{ events: import('../../types/debug.d.ts').DebugEvent[], nextCursor: number, cursorExpired: boolean }}
     */
    getEvents(scope, afterCursor = 0, limit = 100) {
      const session = requireSession({
        debugSessionId: scope.debugSessionId,
        ownerSessionId: scope.ownerSessionId || '',
      })
      return session.eventRing.getEventsAfter(afterCursor, limit)
    },

    /**
     * Waits for events with cursor > afterCursor on the session event ring.
     *
     * @param {{ debugSessionId: string, ownerSessionId?: string }} scope
     * @param {number} [afterCursor=0]
     * @param {AbortSignal | { signal?: AbortSignal, timeoutMs?: number }} [options]
     */
    async waitEvents(scope, afterCursor = 0, options = {}) {
      const session = requireSession({
        debugSessionId: scope.debugSessionId,
        ownerSessionId: scope.ownerSessionId || '',
      })
      const waitOpts = options instanceof AbortSignal ? { signal: options } : options || {}
      return await session.eventRing.waitForEventsAfter(afterCursor, waitOpts)
    },

    /**
     * Park until an owned debug session exists. Used so the Debug page can
     * discover Agent-started sessions without idle polling.
     *
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

    /**
     * Shuts down all active debug sessions and releases all leases.
     *
     * @param {string} [reason]
     */
    async shutdown(reason = 'runtime_shutdown') {
      for (const waiter of [...ownerWaiters]) {
        ownerWaiters.delete(waiter)
        waiter.resolve(null)
      }
      for (const session of sessions.values()) {
        try {
          if (session.unsubscribeBackend) {
            try {
              session.unsubscribeBackend()
            } catch {
              /* ignore */
            }
            session.unsubscribeBackend = null
          }
          if (session.backend && typeof session.backend.stop === 'function') {
            await session.backend.stop()
          }
          session.eventRing.push({
            debugSessionId: session.debugSessionId,
            ownerSessionId: session.ownerSessionId,
            workspaceCwd: session.workspaceCwd,
            backend: session.backendKind,
            type: DEBUG_EVENT_TYPES.SESSION_CLOSED,
            payload: { reason },
          })
        } catch {
          /* ignore during shutdown */
        }
      }
      sessions.clear()
      failedSessions.clear()
      leaseManager.clearAll()
    },
  }
}

/** @type {ReturnType<typeof createDebugRuntime> | null} */
let defaultSharedDebugRuntime = null

/**
 * Gets or initializes the singleton DebugRuntime for the current host lifecycle.
 * @param {Parameters<typeof createDebugRuntime>[0]} [deps]
 * @returns {ReturnType<typeof createDebugRuntime>}
 */
export function getSharedDebugRuntime(deps = {}) {
  if (!defaultSharedDebugRuntime) {
    defaultSharedDebugRuntime = createDebugRuntime(deps)
  }
  return defaultSharedDebugRuntime
}

/**
 * Sets or clears the shared DebugRuntime (used in host lifecycle or testing).
 * @param {ReturnType<typeof createDebugRuntime> | null} [runtime]
 */
export function setSharedDebugRuntime(runtime = null) {
  defaultSharedDebugRuntime = runtime
}
