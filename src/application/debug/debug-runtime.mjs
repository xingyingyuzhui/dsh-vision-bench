// @ts-check
import { DEBUG_EVENT_TYPES, createDebugEventRing } from '../../domain/debug/debug-event.mjs'
import { canTransition, transition } from '../../domain/debug/debug-state.mjs'
import { DEBUG_ERRORS, DebugError } from '../../domain/debug/errors.mjs'
import { createDebugSnapshot } from '../../domain/debug/snapshot.mjs'
import { TargetLeaseManager } from '../../domain/debug/target-lease.mjs'

/**
 * Creates the host authoritative DebugRuntime service shell.
 * Parity with ADR-013 & Phase 2 application architecture.
 *
 * @param {{
 *   leaseManager?: TargetLeaseManager,
 *   backendFactory?: (backendKind: import('../../types/debug.d.ts').DebugBackendKind, ctx: any) => Promise<any>,
 *   onJournalEvent?: ((event: any) => Promise<void>) | null,
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
    }
  }

  /**
   * Refreshes stack and locals context from backend on stop.
   * @param {any} session
   */
  async function refreshSessionContext(session) {
    if (!session.backend) return
    try {
      const [frames, vars, regs] = await Promise.all([
        session.backend.stack ? session.backend.stack().catch(() => []) : [],
        session.backend.locals ? session.backend.locals().catch(() => []) : [],
        session.backend.registers ? session.backend.registers().catch(() => []) : [],
      ])
      if (Array.isArray(frames) && frames.length > 0) {
        session.stack = frames
        if (frames[0]) {
          session.location = {
            file: frames[0].file || '',
            line: frames[0].line || 0,
            function: frames[0].function,
            address: frames[0].address,
          }
        }
      }
      if (Array.isArray(vars)) {
        session.variables = vars
      }
      session.updatedAt = Date.now()
    } catch {
      /* best effort */
    }
  }

  /**
   * Reduces backend raw fact events into host authoritative state and domain events.
   * @param {any} session
   * @param {import('../../types/debug-backend.d.ts').DebugBackendEvent} event
   */
  function reduceBackendEvent(session, event) {
    if (!event || !event.type) return

    switch (event.type) {
      case 'backend.running': {
        if (canTransition(session.state, 'running')) {
          session.state = transition(session.state, 'running')
        } else {
          session.state = 'running'
        }
        session.updatedAt = Date.now()
        session.eventRing.push({
          debugSessionId: session.debugSessionId,
          ownerSessionId: session.ownerSessionId,
          workspaceCwd: session.workspaceCwd,
          backend: session.backendKind,
          type: DEBUG_EVENT_TYPES.RUNNING,
          payload: { threadId: event.threadId },
        })
        break
      }

      case 'backend.stopped': {
        if (canTransition(session.state, 'paused')) {
          session.state = transition(session.state, 'paused')
        } else {
          session.state = 'paused'
        }
        if (event.location) {
          session.location = event.location
        }
        session.updatedAt = Date.now()

        // Kick off context refresh
        refreshSessionContext(session).catch(() => {})

        // Check if there was a pending execution operation (step / pause)
        const pending = session.pendingExecution
        session.pendingExecution = null

        if (pending?.type === 'step') {
          session.eventRing.push({
            debugSessionId: session.debugSessionId,
            ownerSessionId: session.ownerSessionId,
            workspaceCwd: session.workspaceCwd,
            backend: session.backendKind,
            type: DEBUG_EVENT_TYPES.STEP_COMPLETE,
            payload: {
              stepType: pending.stepType || 'over',
              location: session.location,
            },
          })
          return
        }

        if (pending?.type === 'pause') {
          session.eventRing.push({
            debugSessionId: session.debugSessionId,
            ownerSessionId: session.ownerSessionId,
            workspaceCwd: session.workspaceCwd,
            backend: session.backendKind,
            type: DEBUG_EVENT_TYPES.PAUSED,
            payload: {
              reason: 'manual',
              location: session.location,
            },
          })
          return
        }

        // Determine event type based on backend stop reason
        const reason = event.reason || 'unknown'
        if (reason === 'breakpoint') {
          session.eventRing.push({
            debugSessionId: session.debugSessionId,
            ownerSessionId: session.ownerSessionId,
            workspaceCwd: session.workspaceCwd,
            backend: session.backendKind,
            type: DEBUG_EVENT_TYPES.BREAKPOINT_HIT,
            payload: {
              breakpointId: event.breakpointNumber,
              location: session.location,
              threadId: event.threadId,
            },
          })
        } else if (reason === 'watchpoint') {
          session.eventRing.push({
            debugSessionId: session.debugSessionId,
            ownerSessionId: session.ownerSessionId,
            workspaceCwd: session.workspaceCwd,
            backend: session.backendKind,
            type: DEBUG_EVENT_TYPES.WATCHPOINT_HIT,
            payload: {
              watchpointId: event.watchpointNumber,
              location: session.location,
              threadId: event.threadId,
            },
          })
        } else if (reason === 'step') {
          session.eventRing.push({
            debugSessionId: session.debugSessionId,
            ownerSessionId: session.ownerSessionId,
            workspaceCwd: session.workspaceCwd,
            backend: session.backendKind,
            type: DEBUG_EVENT_TYPES.STEP_COMPLETE,
            payload: {
              location: session.location,
            },
          })
        } else if (reason === 'exception') {
          session.eventRing.push({
            debugSessionId: session.debugSessionId,
            ownerSessionId: session.ownerSessionId,
            workspaceCwd: session.workspaceCwd,
            backend: session.backendKind,
            type: DEBUG_EVENT_TYPES.EXCEPTION,
            payload: {
              reason: 'exception',
              detail: event.nativeReason,
              location: session.location,
            },
          })
        } else {
          session.eventRing.push({
            debugSessionId: session.debugSessionId,
            ownerSessionId: session.ownerSessionId,
            workspaceCwd: session.workspaceCwd,
            backend: session.backendKind,
            type: DEBUG_EVENT_TYPES.PAUSED,
            payload: {
              reason,
              location: session.location,
              rawReason: event.nativeReason,
            },
          })
        }
        break
      }

      case 'backend.console': {
        session.eventRing.push({
          debugSessionId: session.debugSessionId,
          ownerSessionId: session.ownerSessionId,
          workspaceCwd: session.workspaceCwd,
          backend: session.backendKind,
          type: DEBUG_EVENT_TYPES.CONSOLE,
          payload: {
            stream: event.stream,
            text: event.text,
          },
        })
        break
      }

      case 'backend.exited': {
        if (event.unexpected) {
          if (canTransition(session.state, 'failed')) {
            session.state = transition(session.state, 'failed')
          } else {
            session.state = 'failed'
          }
          session.eventRing.push({
            debugSessionId: session.debugSessionId,
            ownerSessionId: session.ownerSessionId,
            workspaceCwd: session.workspaceCwd,
            backend: session.backendKind,
            type: DEBUG_EVENT_TYPES.SESSION_FAILED,
            payload: {
              error: `后端调试进程意外退出 (code: ${event.code}, signal: ${event.signal})`,
            },
          })
          session.eventRing.push({
            debugSessionId: session.debugSessionId,
            ownerSessionId: session.ownerSessionId,
            workspaceCwd: session.workspaceCwd,
            backend: session.backendKind,
            type: DEBUG_EVENT_TYPES.SESSION_STOPPED,
            payload: { code: event.code, signal: event.signal },
          })
        } else {
          if (session.state === 'stopping' || session.isStopping) {
            // Already in graceful stop sequence, do not emit duplicate SESSION_STOPPED
            break
          }
          if (canTransition(session.state, 'stopping')) {
            session.state = transition(session.state, 'stopping')
          }
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
            payload: { code: event.code, signal: event.signal },
          })
        }
        break
      }

      case 'backend.error': {
        session.eventRing.push({
          debugSessionId: session.debugSessionId,
          ownerSessionId: session.ownerSessionId,
          workspaceCwd: session.workspaceCwd,
          backend: session.backendKind,
          type: DEBUG_EVENT_TYPES.SESSION_FAILED,
          payload: { error: event.message, code: event.code },
        })
        break
      }
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

      const eventRing = createDebugEventRing(500)
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
        sessionRecord.updatedAt = Date.now()

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
        eventRing.push({
          debugSessionId,
          ownerSessionId,
          workspaceCwd,
          backend: backendKind,
          type: DEBUG_EVENT_TYPES.SESSION_FAILED,
          payload: { error: err instanceof Error ? err.message : String(err) },
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
      const cmdType = command?.type

      if (!cmdType) {
        throw new DebugError(DEBUG_ERRORS.COMMAND_REJECTED, '缺少调试命令类型')
      }

      switch (cmdType) {
        case 'continue': {
          if (session.backend?.continue) await session.backend.continue()
          if (!session.backend?.subscribe) {
            session.state = transition(session.state, 'running')
            session.eventRing.push({
              debugSessionId: session.debugSessionId,
              ownerSessionId: session.ownerSessionId,
              workspaceCwd: session.workspaceCwd,
              backend: session.backendKind,
              type: DEBUG_EVENT_TYPES.RUNNING,
            })
          }
          return { ok: true, state: session.state }
        }

        case 'pause': {
          if (session.backend?.subscribe) {
            session.pendingExecution = { type: 'pause' }
            if (session.backend.requestPause) {
              await session.backend.requestPause()
            } else if (session.backend.pause) {
              await session.backend.pause()
            }
            return { ok: true, state: session.state, pending: true }
          }
          if (session.backend?.pause) await session.backend.pause()
          session.state = transition(session.state, 'paused')
          session.eventRing.push({
            debugSessionId: session.debugSessionId,
            ownerSessionId: session.ownerSessionId,
            workspaceCwd: session.workspaceCwd,
            backend: session.backendKind,
            type: DEBUG_EVENT_TYPES.PAUSED,
          })
          return { ok: true, state: session.state }
        }

        case 'step': {
          const stepType = command.stepType || 'over'
          if (session.backend?.subscribe) {
            session.pendingExecution = { type: 'step', stepType }
            if (stepType === 'into' && session.backend.stepInto) {
              await session.backend.stepInto()
            } else if (stepType === 'out' && session.backend.stepOut) {
              await session.backend.stepOut()
            } else if (session.backend.stepOver) {
              await session.backend.stepOver()
            } else if (session.backend.step) {
              await session.backend.step(stepType)
            }
            return { ok: true, state: session.state, pending: true }
          }
          if (session.backend?.step) {
            await session.backend.step(stepType)
          }
          session.state = transition(session.state, 'paused')
          session.eventRing.push({
            debugSessionId: session.debugSessionId,
            ownerSessionId: session.ownerSessionId,
            workspaceCwd: session.workspaceCwd,
            backend: session.backendKind,
            type: DEBUG_EVENT_TYPES.STEP_COMPLETE,
            payload: { stepType },
          })
          return { ok: true, state: session.state }
        }

        case 'snapshot': {
          const wantedId = command.snapshotId || command.id
          if (command.op === 'get' || (wantedId && !command.reason)) {
            const hit = session.snapshots.find((s) => s.id === wantedId)
            if (!hit) {
              return { ok: false, errorCode: DEBUG_ERRORS.NOT_FOUND, error: `快照不存在: ${wantedId}` }
            }
            return { ok: true, snapshot: hit }
          }

          let regs = undefined
          if (session.backend?.registers) {
            try {
              regs = await session.backend.registers()
            } catch {}
          }

          const fwHash =
            command.firmwareHash ||
            session.backend?.firmwareHash ||
            session.targetSpec?.artifactSha256 ||
            session.targetSpec?.firmwareHash ||
            ''

          const snap = createDebugSnapshot({
            reason: command.reason || 'manual',
            location: session.location,
            stack: session.stack,
            locals: session.variables,
            watches: command.watches || [],
            registers: regs,
            firmwareHash: fwHash,
            backend: session.backendKind,
            breakpointId: command.breakpointId,
            watchpointId: command.watchpointId,
          })
          session.snapshots.push(snap)
          session.eventRing.push({
            debugSessionId: session.debugSessionId,
            ownerSessionId: session.ownerSessionId,
            workspaceCwd: session.workspaceCwd,
            backend: session.backendKind,
            type: DEBUG_EVENT_TYPES.SNAPSHOT_CREATED,
            payload: { snapshotId: snap.id },
          })
          if (onJournalEvent) {
            await onJournalEvent({
              action: 'snapshot-created',
              ok: true,
              summary: `调试诊断快照已创建: ${snap.id} (${snap.reason})`,
              cwd: session.workspaceCwd,
              sessionId: session.ownerSessionId,
              debugSessionId: session.debugSessionId,
              snapshotId: snap.id,
              location: snap.location,
              firmwareHash: snap.firmwareHash,
            }).catch(() => {})
          }
          return { ok: true, snapshot: snap }
        }

        case 'addBreakpoint': {
          const bpId = command.id || `bp_${Date.now()}_${session.breakpoints.size + 1}`
          const bp = {
            id: bpId,
            file: command.file,
            line: command.line,
            condition: command.condition,
            verified: true,
          }
          session.breakpoints.set(bpId, bp)
          if (session.backend?.addBreakpoint) {
            await session.backend.addBreakpoint(bp)
          }
          session.eventRing.push({
            debugSessionId: session.debugSessionId,
            ownerSessionId: session.ownerSessionId,
            workspaceCwd: session.workspaceCwd,
            backend: session.backendKind,
            type: DEBUG_EVENT_TYPES.BREAKPOINT_CREATED,
            payload: bp,
          })
          return { ok: true, breakpoint: bp }
        }

        case 'removeBreakpoint': {
          const bp = session.breakpoints.get(command.id)
          if (bp) {
            session.breakpoints.delete(command.id)
            if (session.backend?.removeBreakpoint) {
              await session.backend.removeBreakpoint(bp)
            }
            session.eventRing.push({
              debugSessionId: session.debugSessionId,
              ownerSessionId: session.ownerSessionId,
              workspaceCwd: session.workspaceCwd,
              backend: session.backendKind,
              type: DEBUG_EVENT_TYPES.BREAKPOINT_REMOVED,
              payload: { id: command.id },
            })
          }
          return { ok: true, removed: Boolean(bp) }
        }

        case 'addWatchpoint': {
          const wpId = command.id || `wp_${Date.now()}_${session.watchpoints.size + 1}`
          const wp = {
            id: wpId,
            expression: command.expression,
            accessType: command.accessType || command.access || 'write',
            verified: true,
          }
          session.watchpoints.set(wpId, wp)
          if (session.backend?.addWatchpoint) {
            await session.backend.addWatchpoint(wp)
          }
          session.eventRing.push({
            debugSessionId: session.debugSessionId,
            ownerSessionId: session.ownerSessionId,
            workspaceCwd: session.workspaceCwd,
            backend: session.backendKind,
            type: DEBUG_EVENT_TYPES.WATCHPOINT_CREATED,
            payload: wp,
          })
          return { ok: true, watchpoint: wp }
        }

        case 'removeWatchpoint': {
          const wp = session.watchpoints.get(command.id)
          if (wp) {
            session.watchpoints.delete(command.id)
            if (session.backend?.removeWatchpoint) {
              await session.backend.removeWatchpoint(wp)
            }
            session.eventRing.push({
              debugSessionId: session.debugSessionId,
              ownerSessionId: session.ownerSessionId,
              workspaceCwd: session.workspaceCwd,
              backend: session.backendKind,
              type: DEBUG_EVENT_TYPES.WATCHPOINT_REMOVED,
              payload: { id: command.id },
            })
          }
          return { ok: true, removed: Boolean(wp) }
        }

        case 'reset':
        case 'resetHalt': {
          if (session.backend?.resetHalt) {
            await session.backend.resetHalt()
          }
          session.state = transition(session.state, 'paused')
          session.eventRing.push({
            debugSessionId: session.debugSessionId,
            ownerSessionId: session.ownerSessionId,
            workspaceCwd: session.workspaceCwd,
            backend: session.backendKind,
            type: DEBUG_EVENT_TYPES.PAUSED,
            payload: { reason: 'reset' },
          })
          return { ok: true, state: session.state }
        }

        case 'evaluate': {
          let value = ''
          if (session.backend?.evaluate) {
            value = await session.backend.evaluate(command.expression)
          }
          return { ok: true, expression: command.expression, value }
        }

        case 'inspect': {
          const include = command.include || 'all'
          if (command.address || include === 'memory') {
            let memory = ''
            if (session.backend?.readMemory && command.address) {
              memory = await session.backend.readMemory(command.address, Number(command.length) || 32)
            }
            return { ok: true, memory, address: command.address }
          }
          const [stack, locals, registers] = await Promise.all([
            session.backend?.stack ? session.backend.stack().catch(() => []) : session.stack,
            session.backend?.locals ? session.backend.locals().catch(() => []) : session.variables,
            session.backend?.registers ? session.backend.registers().catch(() => []) : [],
          ])
          session.stack = stack
          session.variables = locals
          return {
            ok: true,
            location: session.location,
            stack,
            variables: locals,
            registers,
            state: session.state,
          }
        }

        default: {
          if (session.backend && typeof session.backend.command === 'function') {
            const res = await session.backend.command(command)
            return { ok: true, result: res }
          }
          throw new DebugError(DEBUG_ERRORS.COMMAND_REJECTED, `未知的调试命令类型: ${cmdType}`)
        }
      }
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
     * Finds an active session owned by ownerSessionId with optional debugSessionId and workspaceCwd.
     * @param {{ ownerSessionId: string, workspaceCwd?: string, debugSessionId?: string }} scope
     * @returns {import('../../types/debug.d.ts').DebugSessionView | null}
     */
    findOwnedSession(scope) {
      if (!scope?.ownerSessionId) return null
      if (scope.debugSessionId) {
        const session = sessions.get(scope.debugSessionId)
        if (!session || session.ownerSessionId !== scope.ownerSessionId) return null
        if (scope.workspaceCwd && session.workspaceCwd !== scope.workspaceCwd) return null
        return toView(session)
      }
      for (const session of sessions.values()) {
        if (session.ownerSessionId === scope.ownerSessionId) {
          if (!scope.workspaceCwd || session.workspaceCwd === scope.workspaceCwd) {
            return toView(session)
          }
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
      return Array.from(sessions.values()).map(toView)
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
     * Shuts down all active debug sessions and releases all leases.
     *
     * @param {string} [reason]
     */
    async shutdown(reason = 'runtime_shutdown') {
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
