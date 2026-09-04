// @ts-check

import { evaluateAssertion } from '../../domain/verify/assertion.mjs'
import { createVerifyResult } from '../../domain/verify/result.mjs'
import { createScenario } from '../../domain/verify/scenario.mjs'

/**
 * Creates the Verification Service for closed-loop assertion testing
 * against debug sessions and Modbus telemetry.
 *
 * @param {{
 *   debugRuntime?: any,
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
     *   debugSessionId?: string,
     *   timeoutMs?: number,
     * }} options
     * @returns {Promise<import('../../types/verify.d.ts').VerifyResult>}
     */
    async runVerification(options) {
      const startTime = Date.now()
      const { scenario: rawScenario, workspaceCwd, ownerSessionId } = options
      const scenario = createScenario(rawScenario)

      // Resolve debug session
      let debugSessionId = options.debugSessionId || ''
      if (!debugSessionId && debugRuntime && typeof debugRuntime.findSession === 'function') {
        const hit = debugRuntime.findSession((/** @type {any} */ s) => s.workspaceCwd === workspaceCwd)
        if (hit) {
          debugSessionId = hit.debugSessionId
        }
      }

      // 1. Run Setup if declared
      if (scenario.setup) {
        if (scenario.setup.delayMs && Number(scenario.setup.delayMs) > 0) {
          await new Promise((r) => setTimeout(r, Math.min(10000, Number(scenario.setup?.delayMs))))
        }
      }

      /** @type {import('../../types/verify.d.ts').AssertionResult[]} */
      const assertionResults = []

      // 2. Evaluate each assertion
      for (const spec of scenario.assertions) {
        let actualValue = undefined

        try {
          switch (spec.type) {
            case 'debug.expression': {
              if (debugRuntime && debugSessionId) {
                const res = await debugRuntime.command(
                  { debugSessionId, ownerSessionId },
                  { type: 'evaluate', expression: spec.expr },
                )
                actualValue = res?.value
              } else {
                actualValue = undefined
              }
              break
            }

            case 'modbus.point': {
              const ws = workspaceLoader(workspaceCwd)
              const points = ws?.modbus?.points || []
              const pt = points.find((/** @type {any} */ p) => p.id === spec.pointId)
              actualValue = pt ? (pt.value ?? pt.rawValue) : undefined
              break
            }

            case 'no.exception': {
              let hasException = false
              if (debugRuntime && debugSessionId) {
                const evData = debugRuntime.getEvents({ debugSessionId, ownerSessionId }, 0, 500)
                const events = evData?.events || []
                hasException = events.some(
                  (/** @type {any} */ e) =>
                    e.type === 'debug.exception' || (e.type === 'debug.paused' && e.payload?.reason === 'exception'),
                )
              }
              actualValue = hasException
              break
            }

            case 'no.alarm': {
              const ws = workspaceLoader(workspaceCwd)
              const alarms = ws?.alarms || []
              if (spec.pointId) {
                const ptAlarms = alarms.filter((/** @type {any} */ a) => a.pointId === spec.pointId && a.active)
                actualValue = ptAlarms.length
              } else {
                const active = alarms.filter((/** @type {any} */ a) => a.active)
                actualValue = active.length
              }
              break
            }

            case 'range': {
              if (spec.expr && debugRuntime && debugSessionId) {
                const res = await debugRuntime.command(
                  { debugSessionId, ownerSessionId },
                  { type: 'evaluate', expression: spec.expr },
                )
                actualValue = res?.value
              } else if (spec.pointId) {
                const ws = workspaceLoader(workspaceCwd)
                const points = ws?.modbus?.points || []
                const pt = points.find((/** @type {any} */ p) => p.id === spec.pointId)
                actualValue = pt ? (pt.value ?? pt.rawValue) : undefined
              }
              break
            }

            case 'changed': {
              if (spec.expr && debugRuntime && debugSessionId) {
                const res = await debugRuntime.command(
                  { debugSessionId, ownerSessionId },
                  { type: 'evaluate', expression: spec.expr },
                )
                actualValue = { initial: spec.value, current: res?.value }
              } else if (spec.pointId) {
                const ws = workspaceLoader(workspaceCwd)
                const points = ws?.modbus?.points || []
                const pt = points.find((/** @type {any} */ p) => p.id === spec.pointId)
                actualValue = { initial: spec.value, current: pt ? (pt.value ?? pt.rawValue) : undefined }
              }
              break
            }

            case 'stable-for-duration': {
              const duration = Math.min(2000, Math.max(50, Number(spec.durationMs) || 100))
              const samples = []
              const intervalMs = Math.max(20, Math.floor(duration / 4))

              for (let i = 0; i < 4; i++) {
                if (spec.expr && debugRuntime && debugSessionId) {
                  const res = await debugRuntime.command(
                    { debugSessionId, ownerSessionId },
                    { type: 'evaluate', expression: spec.expr },
                  )
                  samples.push(Number(res?.value))
                } else if (spec.pointId) {
                  const ws = workspaceLoader(workspaceCwd)
                  const pt = (ws?.modbus?.points || []).find((/** @type {any} */ p) => p.id === spec.pointId)
                  samples.push(Number(pt?.value ?? pt?.rawValue))
                }
                if (i < 3) await new Promise((r) => setTimeout(r, intervalMs))
              }
              actualValue = samples
              break
            }

            default:
              actualValue = undefined
          }
        } catch (err) {
          actualValue = undefined
        }

        const res = evaluateAssertion(spec, actualValue)
        assertionResults.push(res)
      }

      // 3. Collect Evidence
      const evidence = evidenceBuilder(workspaceCwd) || []

      // If debug session is active, attempt to capture a verification debug snapshot
      if (debugRuntime && debugSessionId) {
        try {
          const snapRes = await debugRuntime.command(
            { debugSessionId, ownerSessionId },
            { type: 'snapshot', reason: `verify:${scenario.id}` },
          )
          if (snapRes?.snapshot?.id) {
            evidence.push({
              kind: 'debug_snapshot',
              id: snapRes.snapshot.id,
              scenarioId: scenario.id,
              reason: snapRes.snapshot.reason,
            })
          }
        } catch {}
      }

      const durationMs = Date.now() - startTime
      const verifyResult = createVerifyResult({
        scenario,
        assertions: assertionResults,
        durationMs,
        evidence,
      })

      // 4. Record to journal timeline if callback is available
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
    },
  }
}
