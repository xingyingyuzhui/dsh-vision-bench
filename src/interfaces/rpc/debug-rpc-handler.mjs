// @ts-check

import { createDebugRuntime } from '../../application/debug/debug-runtime.mjs'
import { DEBUG_ERRORS, DebugError } from '../../domain/debug/errors.mjs'
import { DEBUG_COMMAND_OPS, DEBUG_RPC_ENDPOINTS } from '../../shared/debug-contract.mjs'

/**
 * Creates the Connection RPC handler for debug endpoints.
 * Parity with ADR-014 & Phase 4 Section 8.3.
 *
 * @param {{
 *   debugRuntime?: ReturnType<typeof createDebugRuntime>,
 *   getHome?: () => string,
 * }} deps
 */
export function createDebugRpcHandler(deps) {
  const runtime = deps.debugRuntime || createDebugRuntime()

  /**
   * @param {string} endpoint
   * @param {any} body
   * @param {AbortSignal} [signal]
   * @returns {Promise<any>}
   */
  return async function handleDebugRpc(endpoint, body, signal) {
    const row = body && typeof body === 'object' ? body : {}
    const cwd = String(row.cwd || '').trim()
    const sessionId = String(row.sessionId || '').trim()
    const debugSessionId = String(row.debugSessionId || '').trim()

    try {
      switch (endpoint) {
        case DEBUG_RPC_ENDPOINTS.STATE: {
          let session = null
          if (debugSessionId) {
            session = runtime.state({ debugSessionId, ownerSessionId: sessionId })
          } else if (sessionId || cwd) {
            session = runtime.findSession((s) =>
              Boolean((sessionId && s.ownerSessionId === sessionId) || (cwd && s.workspaceCwd === cwd)),
            )
          }
          return {
            ok: true,
            active: Boolean(session),
            session,
          }
        }

        case DEBUG_RPC_ENDPOINTS.COMMAND: {
          const op = String(row.op || '').trim()
          if (!op) {
            return {
              ok: false,
              errorCode: DEBUG_ERRORS.COMMAND_REJECTED,
              error: '缺少调试操作指令 (op)',
            }
          }

          if (op === DEBUG_COMMAND_OPS.START) {
            const session = await runtime.start({
              debugSessionId: debugSessionId || undefined,
              ownerSessionId: sessionId,
              workspaceCwd: cwd,
              backend: row.backend,
              targetSpec: row.targetSpec,
            })
            return {
              ok: true,
              debugSessionId: session.debugSessionId,
              session,
            }
          }

          if (op === 'stop') {
            const targetId =
              debugSessionId || runtime.findSession((s) => s.ownerSessionId === sessionId)?.debugSessionId
            if (!targetId) {
              return { ok: true, alreadyStopped: true }
            }
            const res = await runtime.stop({
              debugSessionId: targetId,
              ownerSessionId: sessionId,
            })
            return res
          }

          // Other commands require debugSessionId or an active session for the owner
          const targetId = debugSessionId || runtime.findSession((s) => s.ownerSessionId === sessionId)?.debugSessionId
          if (!targetId) {
            return {
              ok: false,
              errorCode: DEBUG_ERRORS.NOT_FOUND,
              error: '未找到活动的调试会话',
            }
          }

          const res = await runtime.command(
            { debugSessionId: targetId, ownerSessionId: sessionId },
            { type: op, ...row },
          )
          return res
        }

        case DEBUG_RPC_ENDPOINTS.EVENTS_WAIT: {
          const targetId = debugSessionId || runtime.findSession((s) => s.ownerSessionId === sessionId)?.debugSessionId
          if (!targetId) {
            return {
              ok: true,
              events: [],
              nextCursor: Number(row.cursor) || 0,
              closed: true,
            }
          }

          const cursor = Math.max(0, Number(row.cursor) || 0)
          const timeoutMs = Math.min(Math.max(100, Number(row.timeoutMs) || 20000), 25000)

          const res = await runtime.waitEvents({ debugSessionId: targetId, ownerSessionId: sessionId }, cursor, {
            signal,
            timeoutMs,
          })

          return {
            ok: true,
            events: res.events || [],
            nextCursor: res.nextCursor,
            closed: false,
          }
        }

        case DEBUG_RPC_ENDPOINTS.APPROVAL: {
          return {
            ok: true,
            approved: true,
            action: row.action,
          }
        }

        default:
          return {
            ok: false,
            errorCode: DEBUG_ERRORS.COMMAND_REJECTED,
            error: `未知调试 RPC 端点: ${endpoint}`,
          }
      }
    } catch (err) {
      if (err instanceof DebugError) {
        return {
          ok: false,
          errorCode: err.code,
          error: err.message,
          details: err.details,
        }
      }
      return {
        ok: false,
        errorCode: 'DEBUG_ERROR',
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }
}
