// @ts-check

import { evaluateAssertion } from '../../domain/verify/assertion.mjs'
import { createVerifyResult } from '../../domain/verify/result.mjs'
import { createScenario } from '../../domain/verify/scenario.mjs'
import { abortableDelay, composeAbortSignals } from './abort-signals.mjs'
import { createTelemetryReader } from './telemetry-reader.mjs'
import { resolveAssertionActual } from './verify-assertion-eval.mjs'
import { isTimeoutOrAborted, withTimeoutSignal } from './verify-timeout.mjs'

/**
 * Creates the Verification Service for closed-loop assertion testing
 * against debug sessions and Modbus telemetry.
 *
 * @param {{
 *   debugRuntime?: any,
 *   telemetryReader?: any,
 *   workspaceLoader?: (cwd: string) => any,
 *   evidenceBuilder?: (cwd: string) => Array<Record<string, any>>,
 *   onJournalEvent?: ((event: any) => Promise<void>) | null,
 * }} [deps]
 */
export function createVerifyService(deps = {}) {
  const debugRuntime = deps.debugRuntime || null
  const workspaceLoader = deps.workspaceLoader || (() => null)
  const evidenceBuilder = deps.evidenceBuilder || (() => [])
  const onJournalEvent = deps.onJournalEvent || null

  return {
    /**
     * Executes a complete verification scenario against runtime and telemetry.
     *
     * @param {{
     *   scenario: import('../../types/verify.d.ts').ScenarioSpec,
     *   workspaceCwd: string,
     *   ownerSessionId: string,
     *   verificationRunId?: string,
     *   debugSessionId?: string,
     *   timeoutMs?: number,
     *   signal?: AbortSignal,
     *   telemetryReader?: any,
     *   artifactPath?: string,
     *   artifactSha256?: string,
     *   firmwareHash?: string,
     *   targetIdentity?: string,
     * }} options
     * @returns {Promise<import('../../types/verify.d.ts').VerifyResult>}
     */
    async runVerification(options) {
      const startTime = Date.now()
      const { scenario: rawScenario, workspaceCwd, ownerSessionId, signal } = options
      const scenario = createScenario(rawScenario)
      const timeoutMs = options.timeoutMs || scenario.timeoutMs || 60000

      const timeoutController = new AbortController()
      const timeoutTimer = setTimeout(() => {
        const timeoutErr = new Error('VERIFY_TIMEOUT')
        timeoutErr.name = 'TimeoutError'
        timeoutController.abort(timeoutErr)
      }, timeoutMs)
      if (timeoutTimer.unref) timeoutTimer.unref()

      const combinedSignal = composeAbortSignals([signal, timeoutController.signal])

      const telemetryReader =
        options.telemetryReader || deps.telemetryReader || createTelemetryReader({ workspaceCwd, workspaceLoader })

      let debugSessionId = options.debugSessionId || ''
      let activeSession = null
      if (debugRuntime) {
        if (debugSessionId) {
          try {
            activeSession = debugRuntime.state({ debugSessionId, ownerSessionId })
          } catch {}
        } else if (typeof debugRuntime.findSession === 'function') {
          activeSession = debugRuntime.findSession(
            (/** @type {any} */ s) =>
              s.ownerSessionId === ownerSessionId && (!workspaceCwd || s.workspaceCwd === workspaceCwd),
          )
          if (activeSession) {
            debugSessionId = activeSession.debugSessionId
          }
        }
      }

      if (timeoutController.signal.aborted) {
        clearTimeout(timeoutTimer)
        return createVerifyResult({
          verificationRunId: options.verificationRunId,
          scenario,
          status: 'timeout',
          durationMs: Date.now() - startTime,
          startAt: startTime,
          endAt: Date.now(),
        })
      }

      if (signal?.aborted) {
        clearTimeout(timeoutTimer)
        return createVerifyResult({
          verificationRunId: options.verificationRunId,
          scenario,
          status: 'cancelled',
          durationMs: Date.now() - startTime,
          startAt: startTime,
          endAt: Date.now(),
        })
      }

      /** @type {import('../../types/verify.d.ts').AssertionResult[]} */
      const assertionResults = []
      /** @type {Array<{ pointId?: string, expr?: string, timestamp: number, value: any }>} */
      const telemetrySamples = []

      /**
       * @param {'timeout' | 'cancelled' | 'error'} status
       * @param {unknown} [error]
       */
      const earlyExit = (status, error) =>
        createVerifyResult({
          verificationRunId: options.verificationRunId,
          scenario,
          status,
          durationMs: Date.now() - startTime,
          startAt: startTime,
          endAt: Date.now(),
          assertions: assertionResults,
          telemetrySamples,
          ...(error !== undefined ? { error } : {}),
        })

      try {
        if (scenario.setup) {
          if (scenario.setup.delayMs && Number(scenario.setup.delayMs) > 0) {
            const delay = Math.min(timeoutMs, Number(scenario.setup.delayMs))
            await abortableDelay(delay, combinedSignal)
          }
        }

        function checkDeadline() {
          if (timeoutController.signal.aborted || Date.now() - startTime >= timeoutMs) {
            const err = new Error('VERIFY_TIMEOUT')
            err.name = 'TimeoutError'
            throw err
          }
          if (signal?.aborted || combinedSignal.aborted) {
            const err = new Error('VERIFY_CANCELLED')
            err.name = 'AbortError'
            throw err
          }
        }

        const evalCtx = {
          debugRuntime,
          debugSessionId,
          ownerSessionId,
          workspaceCwd,
          telemetryReader,
          workspaceLoader,
          combinedSignal,
          timeoutMs,
          checkDeadline,
          telemetrySamples,
        }

        for (const spec of scenario.assertions) {
          checkDeadline()

          let actualValue = undefined
          try {
            actualValue = await resolveAssertionActual(evalCtx, spec)
          } catch (err) {
            const errorObj = /** @type {any} */ (err)
            if (timeoutController.signal.aborted || errorObj?.message === 'VERIFY_TIMEOUT') {
              return earlyExit('timeout', err)
            }
            if (
              signal?.aborted ||
              combinedSignal.aborted ||
              errorObj?.message === 'VERIFY_CANCELLED' ||
              errorObj?.name === 'AbortError'
            ) {
              return earlyExit('cancelled')
            }
            actualValue = undefined
          }

          assertionResults.push(evaluateAssertion(spec, actualValue))
        }

        const evidence = evidenceBuilder(workspaceCwd) || []

        if (debugRuntime && debugSessionId) {
          try {
            checkDeadline()
            const snapRes = await withTimeoutSignal(
              debugRuntime.command(
                { debugSessionId, ownerSessionId },
                { type: 'snapshot', reason: `verify:${scenario.id}` },
              ),
              combinedSignal,
            )
            checkDeadline()
            if (snapRes?.snapshot?.id) {
              evidence.push({
                kind: 'debug_snapshot',
                id: snapRes.snapshot.id,
                scenarioId: scenario.id,
                reason: snapRes.snapshot.reason,
              })
            }
          } catch (e) {
            if (isTimeoutOrAborted(e, combinedSignal)) {
              return earlyExit('timeout', e)
            }
          }
        }

        const durationMs = Date.now() - startTime
        if (timeoutController.signal.aborted || durationMs >= timeoutMs) {
          clearTimeout(timeoutTimer)
          return createVerifyResult({
            verificationRunId: options.verificationRunId,
            scenario,
            status: 'timeout',
            durationMs,
            startAt: startTime,
            endAt: Date.now(),
            assertions: assertionResults,
            telemetrySamples,
          })
        }
        if (signal?.aborted || combinedSignal.aborted) {
          clearTimeout(timeoutTimer)
          return createVerifyResult({
            verificationRunId: options.verificationRunId,
            scenario,
            status: 'cancelled',
            durationMs,
            startAt: startTime,
            endAt: Date.now(),
            assertions: assertionResults,
            telemetrySamples,
          })
        }

        const verifyResult = createVerifyResult({
          verificationRunId: options.verificationRunId,
          scenario,
          assertions: assertionResults,
          durationMs,
          evidence,
          artifactPath: options.artifactPath || activeSession?.artifact?.path,
          artifactSha256: options.artifactSha256 || activeSession?.artifact?.sha256,
          firmwareHash: options.firmwareHash || activeSession?.firmwareHash,
          debugSessionId,
          backend: activeSession?.backend,
          targetIdentity: options.targetIdentity || activeSession?.targetIdentity,
          startAt: startTime,
          endAt: Date.now(),
          telemetrySamples,
        })

        if (onJournalEvent) {
          await onJournalEvent({
            action: 'verify-scenario',
            ok: verifyResult.status === 'pass',
            summary: verifyResult.summary,
            cwd: workspaceCwd,
            sessionId: ownerSessionId,
            debugSessionId,
            scenarioId: scenario.id,
            status: verifyResult.status,
            passedCount: verifyResult.passedCount,
            totalCount: verifyResult.totalCount,
          }).catch(() => {})
        }

        return verifyResult
      } catch (err) {
        const errorObj = /** @type {any} */ (err)
        if (timeoutController.signal.aborted || errorObj?.message === 'VERIFY_TIMEOUT') {
          return earlyExit('timeout', err)
        }
        if (
          signal?.aborted ||
          combinedSignal.aborted ||
          errorObj?.message === 'VERIFY_CANCELLED' ||
          errorObj?.name === 'AbortError'
        ) {
          return earlyExit('cancelled')
        }
        return earlyExit('error', err)
      } finally {
        clearTimeout(timeoutTimer)
      }
    },
  }
}
