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

  return {
    /**
     * Runs a verification scenario against runtime and telemetry.
     * Endpoint: `vision.verify.run`
     *
     * @param {{
     *   cwd: string,
     *   sessionId: string,
     *   scenario: import('../../types/verify.d.ts').ScenarioSpec,
     *   debugSessionId?: string,
     *   timeoutMs?: number,
     * }} params
     */
    async 'vision.verify.run'(params) {
      if (!params || !params.scenario) {
        return { ok: false, error: '缺少 scenario 场景配置' }
      }
      try {
        const result = await commandService.execute({
          workspaceCwd: params.cwd,
          ownerSessionId: params.sessionId,
          scenario: params.scenario,
          debugSessionId: params.debugSessionId,
          timeoutMs: params.timeoutMs,
        })
        return { ok: true, result }
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    },

    /**
     * Cancels an ongoing verification run.
     * Endpoint: `vision.verify.cancel`
     *
     * @param {{
     *   sessionId: string,
     *   scenarioId: string,
     * }} params
     */
    async 'vision.verify.cancel'(params) {
      const cancelled = commandService.cancel(params?.sessionId, params?.scenarioId)
      return { ok: true, cancelled }
    },

    /**
     * Gets current status or result of a verification scenario.
     * Endpoint: `vision.verify.status`
     *
     * @param {{
     *   sessionId: string,
     *   scenarioId: string,
     * }} params
     */
    async 'vision.verify.status'(params) {
      const running = commandService.isRunning(params?.sessionId, params?.scenarioId)
      const result = commandService.getResult(params?.sessionId, params?.scenarioId)
      return { ok: true, running, result: result || null }
    },
  }
}
