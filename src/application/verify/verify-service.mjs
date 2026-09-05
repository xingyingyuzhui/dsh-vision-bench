// @ts-check

import { evaluateAssertion } from '../../domain/verify/assertion.mjs'
import { createVerifyResult } from '../../domain/verify/result.mjs'
import { createScenario } from '../../domain/verify/scenario.mjs'
import { createTelemetryReader } from './telemetry-reader.mjs'

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
     *   debugSessionId?: string,
     *   timeoutMs?: number,
     *   signal?: AbortSignal,
     *   telemetryReader?: any,
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

      const telemetryReader =
        options.telemetryReader || deps.telemetryReader || createTelemetryReader({ workspaceCwd, workspaceLoader })

      // Resolve debug session
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

      if (signal?.aborted) {
        return createVerifyResult({
          scenario,
          status: 'cancelled',
          durationMs: Date.now() - startTime,
          startAt: startTime,
          endAt: Date.now(),
        })
      }

      // 1. Run Setup if declared
      if (scenario.setup) {
        if (scenario.setup.delayMs && Number(scenario.setup.delayMs) > 0) {
          const delay = Math.min(timeoutMs, Number(scenario.setup.delayMs))
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, delay)
            if (signal) {
              signal.addEventListener(
                'abort',
                () => {
                  clearTimeout(timer)
                  reject(new Error('VERIFY_CANCELLED'))
                },
                { once: true },
              )
            }
          })
        }
      }

      /** @type {import('../../types/verify.d.ts').AssertionResult[]} */
      const assertionResults = []
      /** @type {Array<{ pointId?: string, expr?: string, timestamp: number, value: any }>} */
      const telemetrySamples = []

      // 2. Evaluate each assertion
      for (const spec of scenario.assertions) {
        if (signal?.aborted) {
          return createVerifyResult({
            scenario,
            status: 'cancelled',
            durationMs: Date.now() - startTime,
            startAt: startTime,
            endAt: Date.now(),
            assertions: assertionResults,
            telemetrySamples,
          })
        }

        let actualValue = undefined

        try {
          switch (spec.type) {
            case 'debug.expression': {
              const expr = spec.expr || spec.expression || ''
              if (debugRuntime && debugSessionId) {
                const res = await debugRuntime.command(
                  { debugSessionId, ownerSessionId },
                  { type: 'evaluate', expression: expr },
                )
                actualValue = res?.value
                telemetrySamples.push({ expr, timestamp: Date.now(), value: actualValue })
              } else {
                actualValue = undefined
              }
              break
            }

            case 'modbus.point': {
              const pointId = spec.pointId || spec.source?.pointId || ''
              const reading = await telemetryReader.readPoint(pointId)
              actualValue = reading ? (reading.value ?? reading.rawValue) : undefined
              if (reading) {
                telemetrySamples.push({ pointId, timestamp: reading.timestamp, value: actualValue })
              }
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
              const pointId = spec.pointId || spec.source?.pointId
              const ws = workspaceLoader(workspaceCwd)
              const alarms = ws?.alarms || []
              if (pointId) {
                const ptAlarms = alarms.filter((/** @type {any} */ a) => a.pointId === pointId && a.active)
                actualValue = ptAlarms.length
              } else {
                const active = alarms.filter((/** @type {any} */ a) => a.active)
                actualValue = active.length
              }
              break
            }

            case 'range': {
              const expr = spec.expr || spec.expression || spec.source?.expr || spec.source?.expression
              const pointId = spec.pointId || spec.source?.pointId

              if (expr && debugRuntime && debugSessionId) {
                const res = await debugRuntime.command(
                  { debugSessionId, ownerSessionId },
                  { type: 'evaluate', expression: expr },
                )
                actualValue = res?.value
                telemetrySamples.push({ expr, timestamp: Date.now(), value: actualValue })
              } else if (pointId) {
                const reading = await telemetryReader.readPoint(pointId)
                actualValue = reading ? (reading.value ?? reading.rawValue) : undefined
                if (reading) {
                  telemetrySamples.push({ pointId, timestamp: reading.timestamp, value: actualValue })
                }
              }
              break
            }

            case 'changed': {
              const expr = spec.expr || spec.expression || spec.source?.expr || spec.source?.expression
              const pointId = spec.pointId || spec.source?.pointId

              if (expr && debugRuntime && debugSessionId) {
                const res = await debugRuntime.command(
                  { debugSessionId, ownerSessionId },
                  { type: 'evaluate', expression: expr },
                )
                actualValue = { initial: spec.value, current: res?.value }
                telemetrySamples.push({ expr, timestamp: Date.now(), value: res?.value })
              } else if (pointId) {
                const reading = await telemetryReader.readPoint(pointId)
                const currentVal = reading ? (reading.value ?? reading.rawValue) : undefined
                actualValue = { initial: spec.value, current: currentVal }
                if (reading) {
                  telemetrySamples.push({ pointId, timestamp: reading.timestamp, value: currentVal })
                }
              }
              break
            }

            case 'stable-for-duration': {
              // Real unconstrained duration bounded by scenario timeout
              const rawDuration = Number(spec.durationMs) || 1000
              const duration = Math.min(timeoutMs, Math.max(50, rawDuration))
              const intervalMs =
                typeof spec.sampleIntervalMs === 'number'
                  ? Math.max(10, spec.sampleIntervalMs)
                  : duration >= 3000
                    ? 1000
                    : Math.max(20, Math.floor(duration / 4))

              const samples = []
              const sampleStart = Date.now()
              const expr = spec.expr || spec.expression || spec.source?.expr || spec.source?.expression
              const pointId = spec.pointId || spec.source?.pointId

              while (Date.now() - sampleStart <= duration) {
                if (signal?.aborted) {
                  throw new Error('VERIFY_CANCELLED')
                }

                if (expr && debugRuntime && debugSessionId) {
                  const res = await debugRuntime.command(
                    { debugSessionId, ownerSessionId },
                    { type: 'evaluate', expression: expr },
                  )
                  const val = Number(res?.value)
                  samples.push(val)
                  telemetrySamples.push({ expr, timestamp: Date.now(), value: val })
                } else if (pointId) {
                  const reading = await telemetryReader.readPoint(pointId)
                  const val = Number(reading?.value ?? reading?.rawValue)
                  samples.push(val)
                  telemetrySamples.push({ pointId, timestamp: Date.now(), value: val })
                }

                if (Date.now() - sampleStart + intervalMs > duration) {
                  break
                }
                await new Promise((r) => setTimeout(r, intervalMs))
              }
              actualValue = samples
              break
            }

            default:
              actualValue = undefined
          }
        } catch (err) {
          if (err instanceof Error && err.message === 'VERIFY_CANCELLED') {
            return createVerifyResult({
              scenario,
              status: 'cancelled',
              durationMs: Date.now() - startTime,
              startAt: startTime,
              endAt: Date.now(),
              assertions: assertionResults,
              telemetrySamples,
            })
          }
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
        artifactSha256: options.artifactSha256 || activeSession?.artifact?.sha256,
        firmwareHash: options.firmwareHash || activeSession?.firmwareHash,
        debugSessionId,
        targetIdentity: options.targetIdentity || activeSession?.targetIdentity,
        startAt: startTime,
        endAt: Date.now(),
        telemetrySamples,
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
