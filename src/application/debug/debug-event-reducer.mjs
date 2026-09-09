// @ts-check
import { DEBUG_EVENT_TYPES } from '../../domain/debug/debug-event.mjs'
import { canTransition, transition } from '../../domain/debug/debug-state.mjs'

/**
 * Refreshes stack and locals context from backend on stop.
 * @param {any} session
 */
export async function refreshSessionContext(session) {
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
export function reduceBackendEvent(session, event) {
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
