// @ts-check
import { existsSync } from 'node:fs'
import { defaultDebugApprovals } from '../../application/debug/debug-approval-service.mjs'
import { createDebugRuntime } from '../../application/debug/debug-runtime.mjs'
import { findOwnedDebugSession } from '../../application/debug/debug-session-scope.mjs'
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
          try {
            session = findOwnedDebugSession(runtime, {
              ownerSessionId: sessionId,
              workspaceCwd: cwd,
              debugSessionId,
            })
          } catch (err) {
            if (err instanceof DebugError && err.code === DEBUG_ERRORS.NOT_FOUND) {
              session = null
            } else {
              throw err
            }
          }
          const pendingApprovals = approvalStore.listPending({ cwd, sessionId })
          return {
            ok: true,
            active: Boolean(session && session.state !== 'idle' && session.state !== 'failed'),
            session: session || null,
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
            const session = findOwnedDebugSession(runtime, {
              ownerSessionId: sessionId,
              workspaceCwd: cwd,
              debugSessionId,
            })
            const targetId = session?.debugSessionId
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
          const session = findOwnedDebugSession(runtime, {
            ownerSessionId: sessionId,
            workspaceCwd: cwd,
            debugSessionId,
          })
          const targetId = session?.debugSessionId
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
          if (!sessionId) {
            return {
              ok: true,
              events: [],
              nextCursor: Number(row.cursor) || 0,
              closed: false,
              woke: false,
              identityRequired: true,
            }
          }
          const session = findOwnedDebugSession(runtime, {
            ownerSessionId: sessionId,
            workspaceCwd: cwd,
            debugSessionId,
          })
          const targetId = session?.debugSessionId
          if (!targetId) {
            if (!cwd) {
              return {
                ok: true,
                events: [],
                nextCursor: Number(row.cursor) || 0,
                closed: false,
                woke: false,
                identityRequired: true,
              }
            }
            const timeoutMs = Math.min(Math.max(100, Number(row.timeoutMs) || 20000), 25000)
            const woken =
              typeof runtime.waitForOwnerSession === 'function'
                ? await runtime.waitForOwnerSession(
                    { ownerSessionId: sessionId, workspaceCwd: cwd },
                    { signal, timeoutMs },
                  )
                : null
            if (!woken) {
              return {
                ok: true,
                events: [],
                nextCursor: Number(row.cursor) || 0,
                closed: false,
                woke: false,
              }
            }
            return {
              ok: true,
              events: [],
              nextCursor: Number(row.cursor) || 0,
              closed: false,
              woke: true,
              debugSessionId: woken.debugSessionId,
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
            const rejectRes = approvalStore.reject(row.requestId, { cwd, sessionId })
            if (!rejectRes.ok) {
              return {
                ok: false,
                errorCode: rejectRes.errorCode,
                error: rejectRes.error,
              }
            }
            return {
              ok: true,
              rejected: true,
              requestId: row.requestId,
              consumed: true,
            }
          }

          if (op === 'approve') {
            const approveRes = approvalStore.approve(row.requestId, { cwd, sessionId })
            if (!approveRes.ok) {
              return {
                ok: false,
                errorCode: approveRes.errorCode,
                error: approveRes.error,
              }
            }
            const record = approveRes.record
            if (!record) {
              return {
                ok: false,
                errorCode: DEBUG_ERRORS.APPROVAL_NOT_FOUND,
                error: '审批记录不存在',
              }
            }

            const artifactExists = Boolean(record.artifactPath && existsSync(record.artifactPath))
            const { artifactSha256: _oldSha, ...baseTargetSpec } = record.launchSpec?.targetSpec || {}
            const launchTargetSpec = {
              ...baseTargetSpec,
              target: record.target,
              interfaceName: record.interfaceName,
              artifactPath: record.artifactPath,
              ...(!artifactExists && record.artifactSha256 ? { artifactSha256: record.artifactSha256 } : {}),
            }

            const startRes = await startDebugSession(
              {
                cwd: record.cwd || cwd,
                sessionId: record.sessionId || sessionId,
                source: 'user',
                backend: /** @type {import('../../types/debug.d.ts').DebugBackendKind} */ (record.backend),
                approvalRequestId: row.requestId,
                debugSessionId: row.debugSessionId || undefined,
                targetSpec: launchTargetSpec,
              },
              { debugRuntime: runtime, approvalStore },
            )
            if (!startRes.ok) {
              return startRes
            }
            return {
              ok: true,
              approved: true,
              debugSessionId: startRes.debugSessionId,
              session: startRes.session,
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
