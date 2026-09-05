// @ts-check

import { createVerifyService } from './verify-service.mjs'

/**
 * Creates the VerifyCommandService application service that handles
 * scenario execution, timeouts, cancellation tokens, and result tracking.
 *
 * @param {{
 *   verifyService?: any,
 *   debugRuntime?: any,
 *   workspaceLoader?: (cwd: string) => any,
 *   telemetryReader?: any,
 *   onJournalEvent?: ((event: any) => Promise<void>) | null,
 * }} [deps]
 */
export function createVerifyCommandService(deps = {}) {
  const verifyService = deps.verifyService || createVerifyService(deps)

  /** @type {Map<string, { abortController: AbortController, startedAt: number, scenarioId: string }>} */
  const activeVerifications = new Map()

  /** @type {Map<string, import('../../types/verify.d.ts').VerifyResult>} */
  const pastResults = new Map()

  /**
   * Executes a verification scenario.
   *
   * @param {{
   *   workspaceCwd: string,
   *   ownerSessionId: string,
   *   scenario: import('../../types/verify.d.ts').ScenarioSpec,
   *   debugSessionId?: string,
   *   timeoutMs?: number,
   *   signal?: AbortSignal,
   *   artifactSha256?: string,
   *   firmwareHash?: string,
   *   targetIdentity?: string,
   * }} options
   * @returns {Promise<import('../../types/verify.d.ts').VerifyResult>}
   */
  async function execute(options) {
    const { workspaceCwd, ownerSessionId, scenario } = options
    const scenarioId = scenario.id || `scenario_${Date.now()}`
    const runKey = `${ownerSessionId || 'anon'}:${scenarioId}`

    const abortController = new AbortController()
    activeVerifications.set(runKey, {
      abortController,
      startedAt: Date.now(),
      scenarioId,
    })

    // If caller provided an external AbortSignal, link it
    if (options.signal) {
      if (options.signal.aborted) {
        abortController.abort()
      } else {
        options.signal.addEventListener('abort', () => abortController.abort(), { once: true })
      }
    }

    try {
      const result = await verifyService.runVerification({
        ...options,
        scenario: { ...scenario, id: scenarioId },
        signal: abortController.signal,
      })

      pastResults.set(runKey, result)
      if (result.scenarioId && result.scenarioId !== scenarioId) {
        pastResults.set(`${ownerSessionId || 'anon'}:${result.scenarioId}`, result)
      }
      return result
    } finally {
      activeVerifications.delete(runKey)
    }
  }

  /**
   * Cancels an active verification run.
   *
   * @param {string} ownerSessionId
   * @param {string} scenarioId
   * @returns {boolean} True if an active run was found and cancelled
   */
  function cancel(ownerSessionId, scenarioId) {
    const runKey = `${ownerSessionId || 'anon'}:${scenarioId}`
    const active = activeVerifications.get(runKey)
    if (active) {
      active.abortController.abort()
      activeVerifications.delete(runKey)
      return true
    }
    return false
  }

  /**
   * Retrieves the latest verify result for a given session and scenario.
   *
   * @param {string} ownerSessionId
   * @param {string} scenarioId
   * @returns {import('../../types/verify.d.ts').VerifyResult | undefined}
   */
  function getResult(ownerSessionId, scenarioId) {
    const runKey = `${ownerSessionId || 'anon'}:${scenarioId}`
    return pastResults.get(runKey)
  }

  /**
   * Checks if a verification scenario is currently executing.
   *
   * @param {string} ownerSessionId
   * @param {string} scenarioId
   * @returns {boolean}
   */
  function isRunning(ownerSessionId, scenarioId) {
    const runKey = `${ownerSessionId || 'anon'}:${scenarioId}`
    return activeVerifications.has(runKey)
  }

  return {
    execute,
    cancel,
    getResult,
    isRunning,
  }
}
