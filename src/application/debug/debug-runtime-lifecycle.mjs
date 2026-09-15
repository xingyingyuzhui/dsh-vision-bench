// @ts-check
import { DEBUG_EVENT_TYPES, createDebugEventRing } from '../../domain/debug/debug-event.mjs'
import { canTransition, transition } from '../../domain/debug/debug-state.mjs'
import { DEBUG_ERRORS, DebugError } from '../../domain/debug/errors.mjs'
import { reduceBackendEvent } from './debug-event-reducer.mjs'
import { withDebugEventPersistence } from './debug-event-sink.mjs'

/**
 * Backend + lease lifecycle for DebugRuntime (start / stop / shutdown).
 * Mutates the shared session registry; does not own storage maps itself.
 *
 * @param {{
 *   registry: ReturnType<typeof import('./debug-session-registry.mjs').createDebugSessionRegistry>,
 *   leaseManager: import('../../domain/debug/target-lease.mjs').TargetLeaseManager,
 *   backendFactory: (backendKind: import('../../types/debug.d.ts').DebugBackendKind, ctx: any) => Promise<any>,
 *   onJournalEvent?: ((event: any) => Promise<void>) | null,
 *   home?: string,
 * }} deps
 */
export function createDebugRuntimeLifecycle(deps) {
  const { registry, leaseManager, backendFactory, onJournalEvent = null, home = '' } = deps
  const { sessions, failedSessions, notifyOwnerWaiters, purgeFailedSessions, toView, clearOwnerWaiters } = registry

  return {
    /**
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
        sessionRecord.backend = null
        purgeFailedSessions()
        failedSessions.set(debugSessionId, sessionRecord)
        sessions.delete(debugSessionId)
        throw err
      }
    },

    /**
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
     * @param {string} [reason]
     */
    async shutdown(reason = 'runtime_shutdown') {
      clearOwnerWaiters()
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
