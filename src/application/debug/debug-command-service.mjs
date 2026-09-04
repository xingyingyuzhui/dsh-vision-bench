// @ts-check

import { DEBUG_ERRORS, DebugError } from '../../domain/debug/errors.mjs'
import { envelope, normalizeCommand } from '../commands/command-contract.mjs'
import { globalCommandIdempotency } from '../commands/command-idempotency-cache.mjs'
import { finalizeAgentCommandResult } from '../commands/lossless-json.mjs'
import { getSharedDebugRuntime } from './debug-runtime.mjs'

export const DEBUG_ACTIONS = new Set([
  'status',
  'start',
  'stop',
  'run',
  'pause',
  'step',
  'breakpoint',
  'watchpoint',
  'inspect',
  'evaluate',
  'snapshot',
  'reset',
])

/**
 * Executes a firmware runtime debug command originating from Agent, RPC, or Host bridge.
 * Normalizes input, checks session ownership, enforces idempotency, routes to DebugRuntime, and formats envelope.
 *
 * @param {any} input
 * @param {{ debugRuntime?: ReturnType<typeof import('./debug-runtime.mjs').createDebugRuntime> }} [deps]
 * @returns {Promise<any>}
 */
export async function executeDebugCommand(input, deps = {}) {
  const cmd = normalizeCommand(input)
  const ran = await globalCommandIdempotency.run(cmd, async () => {
    const runtime = deps.debugRuntime || getSharedDebugRuntime()
    const rawAction = String(cmd.action || cmd.payload?.action || '').trim()
    const action = rawAction.startsWith('debug.') ? rawAction.slice(6) : rawAction

    if (!DEBUG_ACTIONS.has(action)) {
      return envelope(cmd, {
        ok: false,
        errorCode: DEBUG_ERRORS.COMMAND_REJECTED,
        error: `未知的调试操作: ${rawAction || action}`,
      })
    }

    const payload = cmd.payload && typeof cmd.payload === 'object' ? cmd.payload : {}
    const cwd = String(cmd.cwd || payload.cwd || '').trim()
    const sessionId = String(cmd.sessionId || payload.sessionId || '').trim()
    const debugSessionId = String(payload.debugSessionId || /** @type {any} */ (cmd).debugSessionId || '').trim()

    /**
     * Finds active session for owner or cwd.
     */
    function findActiveSession() {
      if (debugSessionId) {
        try {
          return runtime.state({ debugSessionId, ownerSessionId: sessionId })
        } catch {
          return null
        }
      }
      if (sessionId || cwd) {
        return runtime.findSession((s) =>
          Boolean((sessionId && s.ownerSessionId === sessionId) || (cwd && s.workspaceCwd === cwd)),
        )
      }
      return null
    }

    try {
      switch (action) {
        case 'status': {
          const activeSession = findActiveSession()
          return envelope(cmd, {
            ok: true,
            action: cmd.action,
            active: Boolean(activeSession),
            session: activeSession,
          })
        }

        case 'start': {
          if (!sessionId) {
            return envelope(cmd, {
              ok: false,
              errorCode: DEBUG_ERRORS.NOT_OWNER,
              error: '启动调试必须指定 sessionId',
            })
          }
          const backendKind = /** @type {import('../../types/debug.d.ts').DebugBackendKind} */ (
            payload.backend || 'gdb-openocd'
          )
          const session = await runtime.start({
            debugSessionId: debugSessionId || undefined,
            ownerSessionId: sessionId,
            workspaceCwd: cwd,
            backend: backendKind,
            targetSpec: payload.targetSpec || payload,
          })
          return envelope(cmd, {
            ok: true,
            action: cmd.action,
            debugSessionId: session.debugSessionId,
            session,
          })
        }

        case 'stop': {
          const existing = findActiveSession()
          if (!existing && !debugSessionId) {
            return envelope(cmd, {
              ok: true,
              action: cmd.action,
              alreadyStopped: true,
            })
          }
          const targetId = debugSessionId || existing?.debugSessionId || ''
          const res = await runtime.stop({
            debugSessionId: targetId,
            ownerSessionId: sessionId,
          })
          return envelope(cmd, {
            action: cmd.action,
            ...res,
          })
        }

        default: {
          const active = findActiveSession()
          const targetId = debugSessionId || active?.debugSessionId
          if (!targetId) {
            return envelope(cmd, {
              ok: false,
              errorCode: DEBUG_ERRORS.NOT_FOUND,
              error: '未找到活动的调试会话',
            })
          }
          const scope = { debugSessionId: targetId, ownerSessionId: sessionId }

          let res
          if (action === 'run') {
            res = await runtime.command(scope, { type: 'continue' })
          } else if (action === 'pause') {
            res = await runtime.command(scope, { type: 'pause' })
          } else if (action === 'step') {
            const stepType = payload.stepType || payload.step || 'over'
            res = await runtime.command(scope, { type: 'step', stepType })
          } else if (action === 'breakpoint') {
            if (payload.op === 'remove' || payload.remove === true || (payload.breakpointId && !payload.file)) {
              res = await runtime.command(scope, {
                type: 'removeBreakpoint',
                id: payload.breakpointId || payload.id,
              })
            } else if (payload.op === 'list' || (!payload.file && !payload.line)) {
              const st = runtime.state(scope)
              res = { ok: true, breakpoints: st.breakpoints }
            } else {
              res = await runtime.command(scope, {
                type: 'addBreakpoint',
                file: payload.file,
                line: Number(payload.line),
                condition: payload.condition,
                id: payload.breakpointId || payload.id,
              })
            }
          } else if (action === 'watchpoint') {
            if (payload.op === 'remove' || payload.remove === true || (payload.watchpointId && !payload.expression)) {
              res = await runtime.command(scope, {
                type: 'removeWatchpoint',
                id: payload.watchpointId || payload.id,
              })
            } else if (payload.op === 'list' || !payload.expression) {
              const st = runtime.state(scope)
              res = { ok: true, watchpoints: st.watchpoints }
            } else {
              res = await runtime.command(scope, {
                type: 'addWatchpoint',
                expression: payload.expression,
                accessType: payload.access || payload.accessType || 'write',
                id: payload.watchpointId || payload.id,
              })
            }
          } else if (action === 'inspect') {
            res = await runtime.command(scope, { type: 'inspect', ...payload })
          } else if (action === 'evaluate') {
            res = await runtime.command(scope, {
              type: 'evaluate',
              expression: payload.expression,
              frame: payload.frame,
            })
          } else if (action === 'snapshot') {
            res = await runtime.command(scope, {
              type: 'snapshot',
              reason: payload.reason || 'manual',
            })
          } else if (action === 'reset') {
            res = await runtime.command(scope, {
              type: 'reset',
              mode: payload.mode || 'halt',
            })
          }

          return envelope(cmd, {
            ok: true,
            action: cmd.action,
            ...res,
          })
        }
      }
    } catch (err) {
      if (err instanceof DebugError) {
        return envelope(cmd, {
          ok: false,
          errorCode: err.code,
          error: err.message,
          details: err.details,
        })
      }
      return envelope(cmd, {
        ok: false,
        errorCode: 'DEBUG_ERROR',
        error: err instanceof Error ? err.message : String(err),
      })
    }
  })

  return finalizeAgentCommandResult(ran, cmd.source)
}
