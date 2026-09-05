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

  /**
   * @type {Map<string, {
   *   verificationRunId: string,
   *   abortController: AbortController,
   *   startedAt: number,
   *   scenarioId: string,
   *   ownerSessionId: string,
   * }>}
   */
  const activeVerifications = new Map()

  /** @type {Map<string, string>} Mapping from `${ownerSessionId}:${scenarioId}` to current verificationRunId */
  const sessionScenarioIndex = new Map()

  /** @type {Map<string, import('../../types/verify.d.ts').VerifyResult>} */
  const pastResults = new Map()

  /**
   * Generates a unique verification run ID.
   * @returns {string}
   */
  function generateRunId() {
    return `vr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  }

  /**
   * Executes a verification scenario.
   *
   * @param {{
   *   workspaceCwd: string,
   *   ownerSessionId: string,
   *   scenario: import('../../types/verify.d.ts').ScenarioSpec,
   *   verificationRunId?: string,
   *   debugSessionId?: string,
   *   timeoutMs?: number,
   *   signal?: AbortSignal,
   *   artifactPath?: string,
   *   artifactSha256?: string,
   *   firmwareHash?: string,
   *   targetIdentity?: string,
   * }} options
   * @returns {Promise<import('../../types/verify.d.ts').VerifyResult>}
   */
  async function execute(options) {
    const { workspaceCwd, ownerSessionId, scenario } = options
    const scenarioId = scenario.id || `scenario_${Date.now()}`
    const verificationRunId = options.verificationRunId || generateRunId()
    const sessionKey = `${ownerSessionId || 'anon'}:${scenarioId}`

    const abortController = new AbortController()
    const activeEntry = {
      verificationRunId,
      abortController,
      startedAt: Date.now(),
      scenarioId,
      ownerSessionId: ownerSessionId || 'anon',
    }

    activeVerifications.set(verificationRunId, activeEntry)
    sessionScenarioIndex.set(sessionKey, verificationRunId)

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
        verificationRunId,
        scenario: { ...scenario, id: scenarioId },
        signal: abortController.signal,
      })

      pastResults.set(verificationRunId, result)
      pastResults.set(sessionKey, result)
      if (result.scenarioId && result.scenarioId !== scenarioId) {
        pastResults.set(`${ownerSessionId || 'anon'}:${result.scenarioId}`, result)
      }
      return result
    } finally {
      activeVerifications.delete(verificationRunId)
      if (sessionScenarioIndex.get(sessionKey) === verificationRunId) {
        sessionScenarioIndex.delete(sessionKey)
      }
    }
  }

  /**
   * Cancels an active verification run.
   *
   * @param {string} runIdOrOwnerSessionId
   * @param {string} [maybeScenarioId]
   * @returns {boolean} True if an active run was found and cancelled
   */
  function cancel(runIdOrOwnerSessionId, maybeScenarioId) {
    if (!runIdOrOwnerSessionId) return false

    // 1. Try by verificationRunId directly
    if (activeVerifications.has(runIdOrOwnerSessionId)) {
      const active = activeVerifications.get(runIdOrOwnerSessionId)
      if (active) {
        active.abortController.abort()
        activeVerifications.delete(runIdOrOwnerSessionId)
        const sessionKey = `${active.ownerSessionId}:${active.scenarioId}`
        if (sessionScenarioIndex.get(sessionKey) === runIdOrOwnerSessionId) {
          sessionScenarioIndex.delete(sessionKey)
        }
        return true
      }
    }

    // 2. Try by sessionKey `${ownerSessionId}:${scenarioId}`
    if (maybeScenarioId) {
      const sessionKey = `${runIdOrOwnerSessionId || 'anon'}:${maybeScenarioId}`
      const runId = sessionScenarioIndex.get(sessionKey)
      if (runId && activeVerifications.has(runId)) {
        const active = activeVerifications.get(runId)
        if (active) {
          active.abortController.abort()
          activeVerifications.delete(runId)
          sessionScenarioIndex.delete(sessionKey)
          return true
        }
      }
    }

    return false
  }

  /**
   * Retrieves the latest verify result for a given run ID or (session, scenario).
   *
   * @param {string} runIdOrOwnerSessionId
   * @param {string} [maybeScenarioId]
   * @returns {import('../../types/verify.d.ts').VerifyResult | undefined}
   */
  function getResult(runIdOrOwnerSessionId, maybeScenarioId) {
    if (!runIdOrOwnerSessionId) return undefined

    // 1. Direct lookup by verificationRunId
    if (pastResults.has(runIdOrOwnerSessionId)) {
      return pastResults.get(runIdOrOwnerSessionId)
    }

    // 2. Lookup by sessionKey `${ownerSessionId}:${scenarioId}`
    if (maybeScenarioId) {
      const sessionKey = `${runIdOrOwnerSessionId || 'anon'}:${maybeScenarioId}`
      return pastResults.get(sessionKey)
    }

    return undefined
  }

  /**
   * Checks if a verification scenario is currently executing.
   *
   * @param {string} runIdOrOwnerSessionId
   * @param {string} [maybeScenarioId]
   * @returns {boolean}
   */
  function isRunning(runIdOrOwnerSessionId, maybeScenarioId) {
    if (!runIdOrOwnerSessionId) return false

    // 1. Check by verificationRunId
    if (activeVerifications.has(runIdOrOwnerSessionId)) {
      return true
    }

    // 2. Check by sessionKey `${ownerSessionId}:${scenarioId}`
    if (maybeScenarioId) {
      const sessionKey = `${runIdOrOwnerSessionId || 'anon'}:${maybeScenarioId}`
      const runId = sessionScenarioIndex.get(sessionKey)
      return Boolean(runId && activeVerifications.has(runId))
    }

    return false
  }

  return {
    execute,
    cancel,
    getResult,
    isRunning,
  }
}
