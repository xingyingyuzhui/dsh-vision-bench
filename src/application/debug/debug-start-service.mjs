// @ts-check
import { DEBUG_ERRORS, DebugError } from '../../domain/debug/errors.mjs'
import { defaultDebugApprovals } from './debug-approval-service.mjs'
import { resolveDebugLaunchSpec } from './debug-launch-spec-service.mjs'
import { getSharedDebugRuntime } from './debug-runtime.mjs'

/**
 * Starts a hardware debug session after resolving launch spec, validating approvals,
 * and acquiring target leases.
 *
 * @param {{
 *   sessionId: string,
 *   cwd?: string,
 *   source?: string,
 *   backend?: import('../../types/debug.d.ts').DebugBackendKind,
 *   targetSpec?: Record<string, any>,
 *   approved?: boolean,
 *   approvalRequestId?: string,
 *   debugSessionId?: string,
 *   [key: string]: any,
 * }} request
 * @param {{
 *   debugRuntime?: ReturnType<typeof getSharedDebugRuntime>,
 *   approvalStore?: typeof defaultDebugApprovals,
 *   specResolver?: typeof resolveDebugLaunchSpec,
 * }} [deps]
 * @returns {Promise<any>}
 */
export async function startDebugSession(request, deps = {}) {
  const runtime = deps.debugRuntime || getSharedDebugRuntime()
  const approvalStore = deps.approvalStore || defaultDebugApprovals
  const specResolver = deps.specResolver || resolveDebugLaunchSpec

  const sessionId = String(request.sessionId || '').trim()
  if (!sessionId) {
    throw new DebugError(DEBUG_ERRORS.NOT_OWNER, '启动调试必须指定 sessionId')
  }

  const cwd = String(request.cwd || process.cwd()).trim()
  const source = String(request.source || 'user').trim()

  // 1. Resolve full launch spec (auto-detects artifact, port, binaries)
  const resolved = await specResolver({
    cwd,
    sessionId,
    source,
    backend: request.backend,
    targetSpec: request.targetSpec || {},
  })

  // 2. User Approval Check for Agent
  if (source === 'agent' && !request.approved && !request.approvalRequestId) {
    const ticket = approvalStore.create({
      cwd,
      sessionId,
      source,
      backend: resolved.backend,
      target: resolved.targetSpec.target,
      interfaceName: resolved.targetSpec.interfaceName,
      artifactPath: resolved.targetSpec.artifactPath,
      artifactSha256: resolved.targetSpec.artifactSha256,
    })
    return {
      ok: false,
      errorCode: DEBUG_ERRORS.APPROVAL_REQUIRED,
      error: '真机硬件调试启动需要用户在界面批准',
      needsApproval: true,
      approval: ticket,
    }
  }

  // If approvalRequestId is provided, consume it
  if (request.approvalRequestId) {
    const consumeRes = approvalStore.consume(request.approvalRequestId, { cwd, sessionId })
    if (!consumeRes.ok) {
      return {
        ok: false,
        errorCode: consumeRes.errorCode,
        error: consumeRes.error,
      }
    }
  }

  // 3. Start session with runtime
  const session = await runtime.start({
    debugSessionId: request.debugSessionId || undefined,
    ownerSessionId: sessionId,
    workspaceCwd: cwd,
    backend: resolved.backend,
    targetSpec: resolved.targetSpec,
  })

  // 4. Grant control lease
  approvalStore.grantControlLease(session.debugSessionId, {
    ownerSessionId: sessionId,
    workspaceCwd: cwd,
    artifactSha256: resolved.targetSpec.artifactSha256,
    backend: resolved.backend,
    target: resolved.targetSpec.target,
  })

  return {
    ok: true,
    debugSessionId: session.debugSessionId,
    session,
    launchSpec: resolved,
  }
}
