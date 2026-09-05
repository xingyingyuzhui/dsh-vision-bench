// @ts-check

import { DEBUG_ERRORS, DebugError } from '../../domain/debug/errors.mjs'
import { envelope, normalizeCommand } from '../commands/command-contract.mjs'
import { globalCommandIdempotency } from '../commands/command-idempotency-cache.mjs'
import { finalizeAgentCommandResult } from '../commands/lossless-json.mjs'
import { createVerifyCommandService } from '../verify/verify-command-service.mjs'
import { defaultDebugApprovals } from './debug-approval-service.mjs'
import { getSharedDebugRuntime } from './debug-runtime.mjs'
import { findOwnedDebugSession } from './debug-session-scope.mjs'
import { startDebugSession } from './debug-start-service.mjs'

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
  'verify',
])

/**
 * Executes a firmware runtime debug command originating from Agent, RPC, or Host bridge.
 * Normalizes input, checks session ownership, enforces idempotency, routes to DebugRuntime, and formats envelope.
 *
 * @param {any} input
 * @param {{
 *   debugRuntime?: ReturnType<typeof import('./debug-runtime.mjs').createDebugRuntime>,
 *   approvalStore?: ReturnType<typeof import('./debug-approval-service.mjs').createDebugApprovalStore>,
 *   verifyCommandService?: any,
 *   workspaceLoader?: any,
 * }} [deps]
 * @returns {Promise<any>}
 */
export async function executeDebugCommand(input, deps = {}) {
  const cmd = normalizeCommand(input)
  const ran = await globalCommandIdempotency.run(cmd, async () => {
    const runtime = deps.debugRuntime || getSharedDebugRuntime()
    const approvalStore = deps.approvalStore || defaultDebugApprovals
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
     * Finds active session strictly owned by the calling sessionId.
     */
    function findOwnedSession() {
      return findOwnedDebugSession(runtime, {
        ownerSessionId: sessionId,
        workspaceCwd: cwd,
        debugSessionId,
      })
    }

    try {
      switch (action) {
        case 'status': {
          const activeSession = findOwnedSession()
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

          const startRes = await startDebugSession(
            {
              sessionId,
              cwd,
              source: cmd.source,
              backend: /** @type {import('../../types/debug.d.ts').DebugBackendKind | undefined} */ (payload.backend),
              targetSpec: payload.targetSpec || payload,
              approved: payload.approved !== undefined ? Boolean(payload.approved) : undefined,
              approvalRequestId: payload.approvalRequestId ? String(payload.approvalRequestId) : undefined,
              debugSessionId,
            },
            {
              debugRuntime: runtime,
              approvalStore,
            },
          )

          return envelope(cmd, {
            action: cmd.action,
            ...startRes,
          })
        }

        case 'stop': {
          const existing = findOwnedSession()
          if (!existing && !debugSessionId) {
            return envelope(cmd, {
              ok: true,
              action: cmd.action,
              alreadyStopped: true,
            })
          }
          const targetId = debugSessionId || existing?.debugSessionId || ''
          approvalStore.revokeControlLease(targetId)

          const res = await runtime.stop({
            debugSessionId: targetId,
            ownerSessionId: sessionId,
          })
          return envelope(cmd, {
            action: cmd.action,
            ...res,
          })
        }

        case 'verify': {
          const verifyCmdService =
            deps.verifyCommandService ||
            createVerifyCommandService({
              debugRuntime: runtime,
              workspaceLoader: deps.workspaceLoader,
            })
          const scenario = payload.scenario || {
            id: payload.scenarioId || `scenario_${Date.now()}`,
            name: payload.scenarioName || 'Debug Target Verification',
            assertions: payload.assertions || [],
            timeoutMs: payload.timeoutMs,
          }
          const activeSession = findOwnedSession()
          const verifyRes = await verifyCmdService.execute({
            workspaceCwd: cwd,
            ownerSessionId: sessionId,
            scenario,
            debugSessionId: activeSession?.debugSessionId,
            timeoutMs: payload.timeoutMs,
            signal: cmd.signal,
          })
          return envelope(cmd, {
            ok: verifyRes.status === 'pass',
            action: cmd.action,
            verifyResult: verifyRes,
            status: verifyRes.status,
            summary: verifyRes.summary,
            passedCount: verifyRes.passedCount,
            totalCount: verifyRes.totalCount,
          })
        }

        default: {
          const active = findOwnedSession()
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
            const rawRes = /** @type {any} */ (await runtime.command(scope, { type: 'inspect', ...payload }))
            const st = runtime.state(scope)
            const stack = (rawRes?.stack || st?.stack || []).slice(0, 5)
            const locals = (rawRes?.locals || st?.variables || []).slice(0, 10)
            const lastSnap = st?.snapshots?.[st.snapshots.length - 1]
            res = {
              ok: true,
              location: rawRes?.location || st?.location || null,
              reason: rawRes?.reason || st?.stopReason || 'inspect',
              stackTop: stack,
              relevantVariables: locals,
              snapshotId: lastSnap?.id || undefined,
              stack: rawRes?.stack || stack,
              variables: rawRes?.variables || rawRes?.locals || locals,
              registers: rawRes?.registers || [],
            }
          } else if (action === 'evaluate') {
            res = await runtime.command(scope, {
              type: 'evaluate',
              expression: payload.expression,
              frame: payload.frame,
            })
          } else if (action === 'snapshot') {
            const isGet = payload.op === 'get' || Boolean(payload.snapshotId && !payload.reason)
            if (isGet) {
              res = await runtime.command(scope, {
                type: 'snapshot',
                op: 'get',
                snapshotId: payload.snapshotId || payload.id,
              })
            } else {
              const createRes = await runtime.command(scope, {
                type: 'snapshot',
                reason: payload.reason || 'manual',
                watches: payload.watches,
              })
              if (!createRes.ok || !createRes.snapshot) {
                res = createRes
              } else {
                const snap = createRes.snapshot
                res = {
                  ok: true,
                  snapshotId: snap.id,
                  reason: snap.reason,
                  location: snap.location,
                  stackTop: (snap.stack || []).slice(0, 5),
                  relevantVariables: (snap.locals || []).slice(0, 10),
                  firmwareHash: snap.firmwareHash,
                  createdAt: snap.createdAt,
                  snapshot: snap,
                }
              }
            }
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
