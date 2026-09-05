// @ts-check

import { createVerifyCommandService } from '../../application/verify/verify-command-service.mjs'

/**
 * Creates RPC handlers for closed-loop verification operations.
 *
 * @param {{
 *   verifyCommandService?: ReturnType<typeof createVerifyCommandService>,
 *   verifyService?: any,
 *   debugRuntime?: any,
 *   workspaceLoader?: (cwd: string) => any,
 * }} [deps]
 */
export function createVerifyRpcHandler(deps = {}) {
  const commandService = deps.verifyCommandService || createVerifyCommandService(deps)

  /**
   * Runs a verification scenario.
   *
   * @param {{
   *   cwd: string,
   *   sessionId: string,
   *   scenario: import('../../types/verify.d.ts').ScenarioSpec,
   *   verificationRunId?: string,
   *   debugSessionId?: string,
   *   timeoutMs?: number,
   * }} params
   */
  async function handleRun(params) {
    if (!params || !params.scenario) {
      return { ok: false, error: '缺少 scenario 场景配置' }
    }
    try {
      const result = await commandService.execute({
        workspaceCwd: params.cwd,
        ownerSessionId: params.sessionId,
        scenario: params.scenario,
        verificationRunId: params.verificationRunId,
        debugSessionId: params.debugSessionId,
        timeoutMs: params.timeoutMs,
      })
      return {
        ok: true,
        verificationRunId: result.verificationRunId,
        result,
      }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  /**
   * Cancels an ongoing verification run.
   *
   * @param {{
   *   verificationRunId?: string,
   *   runId?: string,
   *   sessionId?: string,
   *   scenarioId?: string,
   * }} params
   */
  async function handleCancel(params) {
    const runId = params?.verificationRunId || params?.runId
    const cancelled = runId
      ? commandService.cancel(runId)
      : commandService.cancel(String(params?.sessionId || ''), params?.scenarioId)
    return { ok: true, cancelled }
  }

  /**
   * Gets current status or result of a verification run.
   *
   * @param {{
   *   verificationRunId?: string,
   *   runId?: string,
   *   sessionId?: string,
   *   scenarioId?: string,
   * }} params
   */
  async function handleStatus(params) {
    const runId = params?.verificationRunId || params?.runId
    const running = runId
      ? commandService.isRunning(runId)
      : commandService.isRunning(String(params?.sessionId || ''), params?.scenarioId)
    const result = runId
      ? commandService.getResult(runId)
      : commandService.getResult(String(params?.sessionId || ''), params?.scenarioId)
    return { ok: true, running, result: result || null }
  }

  return {
    // Canonical endpoints
    'verify/run': handleRun,
    'verify/cancel': handleCancel,
    'verify/status': handleStatus,

    // Backward compatibility aliases
    'vision.verify.run': handleRun,
    'vision.verify.cancel': handleCancel,
    'vision.verify.status': handleStatus,
  }
}
