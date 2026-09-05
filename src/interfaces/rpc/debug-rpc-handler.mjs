// @ts-check

import { defaultDebugApprovals } from '../../application/debug/debug-approval-service.mjs'
import { createDebugRuntime } from '../../application/debug/debug-runtime.mjs'
import { startDebugSession } from '../../application/debug/debug-start-service.mjs'
import { DEBUG_ERRORS, DebugError } from '../../domain/debug/errors.mjs'
import { DEBUG_COMMAND_OPS, DEBUG_RPC_ENDPOINTS } from '../../shared/debug-contract.mjs'

/**
 * Creates the Connection RPC handler for debug endpoints.
 * Parity with ADR-014 & Phase 4 Section 8.3 & Phase 6 Section 10.
 *
 * @param {{
 *   debugRuntime?: ReturnType<typeof createDebugRuntime>,
 *   approvalStore?: ReturnType<typeof import('../../application/debug/debug-approval-service.mjs').createDebugApprovalStore>,
 *   getHome?: () => string,
 * }} deps
 */
export function createDebugRpcHandler(deps) {
  const runtime = deps.debugRuntime || createDebugRuntime()
  const approvalStore = deps.approvalStore || defaultDebugApprovals

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
          const pendingApprovals = approvalStore.listPending({ cwd, sessionId })
          return {
            ok: true,
            active: Boolean(session),
            session,
            pendingApprovals,
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
            return await startDebugSession(
              {
                debugSessionId: debugSessionId || undefined,
                sessionId,
                cwd,
                source: 'user',
                backend: row.backend,
                targetSpec: row.targetSpec,
              },
              { debugRuntime: runtime, approvalStore },
            )
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
            // When no debug session is active, throttle response to prevent tight-loop polling
            const idleThrottleMs = Math.min(1000, Math.max(0, Number(row.timeoutMs) || 1000))
            if (idleThrottleMs > 0) {
              if (signal) {
                await new Promise((resolve) => {
                  if (signal.aborted) return resolve(undefined)
                  const timer = setTimeout(resolve, idleThrottleMs)
                  signal.addEventListener(
                    'abort',
                    () => {
                      clearTimeout(timer)
                      resolve(undefined)
                    },
                    { once: true },
                  )
                })
              } else {
                await new Promise((resolve) => setTimeout(resolve, idleThrottleMs))
              }
            }
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
          const op = String(row.op || '').trim()

          if (op === 'list') {
            const pending = approvalStore.listPending({ cwd, sessionId })
            return {
              ok: true,
              pending,
            }
          }

          if (op === 'reject') {
            const consumeRes = approvalStore.consume(row.requestId, { cwd, sessionId })
            return {
              ok: true,
              rejected: true,
              requestId: row.requestId,
              consumed: consumeRes.ok,
            }
          }

          if (op === 'approve') {
            const consumeRes = approvalStore.consume(row.requestId, { cwd, sessionId })
            if (!consumeRes.ok || !consumeRes.record) {
              return {
                ok: false,
                errorCode: consumeRes.errorCode,
                error: consumeRes.error,
              }
            }
            const record = consumeRes.record
            const session = await runtime.start({
              debugSessionId: row.debugSessionId || undefined,
              ownerSessionId: record.sessionId || sessionId,
              workspaceCwd: record.cwd || cwd,
              backend: /** @type {any} */ (record.backend),
              targetSpec: {
                target: record.target,
                interfaceName: record.interfaceName,
                artifactPath: record.artifactPath,
                artifactSha256: record.artifactSha256,
              },
            })

            approvalStore.grantControlLease(session.debugSessionId, {
              ownerSessionId: record.sessionId || sessionId,
              workspaceCwd: record.cwd || cwd,
              artifactSha256: record.artifactSha256,
              backend: record.backend,
              target: record.target,
            })

            return {
              ok: true,
              approved: true,
              debugSessionId: session.debugSessionId,
              session,
            }
          }

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
