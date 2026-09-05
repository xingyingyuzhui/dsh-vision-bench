// @ts-check

import { evaluateAssertion } from '../../domain/verify/assertion.mjs'
import { createVerifyResult } from '../../domain/verify/result.mjs'
import { createScenario } from '../../domain/verify/scenario.mjs'
import { abortableDelay, composeAbortSignals } from './abort-signals.mjs'
import { createTelemetryReader } from './telemetry-reader.mjs'

/**
 * Race a promise with an AbortSignal, rejecting with TimeoutError/AbortError on abort.
 * @template T
 * @param {Promise<T>} promise
 * @param {AbortSignal} [signal]
 * @returns {Promise<T>}
 */
function withTimeoutSignal(promise, signal) {
  if (!signal) return promise
  if (signal.aborted) {
    const isTimeout = signal.reason?.message === 'VERIFY_TIMEOUT' || signal.reason?.name === 'TimeoutError'
    const err = new Error(isTimeout ? 'VERIFY_TIMEOUT' : 'VERIFY_CANCELLED')
    err.name = isTimeout ? 'TimeoutError' : 'AbortError'
    return Promise.reject(err)
  }
  return new Promise((resolve, reject) => {
    let settled = false
    const onAbort = () => {
      if (settled) return
      settled = true
      const isTimeout = signal.reason?.message === 'VERIFY_TIMEOUT' || signal.reason?.name === 'TimeoutError'
      const err = new Error(isTimeout ? 'VERIFY_TIMEOUT' : 'VERIFY_CANCELLED')
      err.name = isTimeout ? 'TimeoutError' : 'AbortError'
      reject(err)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise
      .then((val) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        resolve(val)
      })
      .catch((err) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        reject(err)
      })
  })
}

/**
 * @param {unknown} err
 * @param {AbortSignal} [signal]
 * @returns {boolean}
 */
function isTimeoutOrAborted(err, signal) {
  const e = /** @type {any} */ (err)
  return Boolean(signal?.aborted || e?.name === 'TimeoutError' || e?.message === 'VERIFY_TIMEOUT')
}

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

      try {
        // 1. Run Setup if declared
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

        // 2. Evaluate each assertion
        for (const spec of scenario.assertions) {
          checkDeadline()

          let actualValue = undefined

          try {
            switch (spec.type) {
              case 'debug.expression': {
                const expr = spec.expr || spec.expression || ''
                if (debugRuntime && debugSessionId) {
                  const res = await withTimeoutSignal(
                    debugRuntime.command({ debugSessionId, ownerSessionId }, { type: 'evaluate', expression: expr }),
                    combinedSignal,
                  )
                  checkDeadline()
                  actualValue = res?.value
                  telemetrySamples.push({ expr, timestamp: Date.now(), value: actualValue })
                } else {
                  actualValue = undefined
                }
                break
              }

              case 'modbus.point': {
                const pointId = spec.pointId || spec.source?.pointId || ''
                const maxAgeMs = typeof spec.maxAgeMs === 'number' ? spec.maxAgeMs : undefined
                let reading = null
                if (telemetryReader && typeof telemetryReader.readPoint === 'function') {
                  try {
                    reading = await withTimeoutSignal(
                      telemetryReader.readPoint({ cwd: workspaceCwd, sessionId: ownerSessionId }, pointId, {
                        maxAgeMs,
                        signal: combinedSignal,
                      }),
                      combinedSignal,
                    )
                  } catch (e) {
                    if (isTimeoutOrAborted(e, combinedSignal)) throw e
                  }
                  if (!reading) {
                    try {
                      reading = await withTimeoutSignal(
                        telemetryReader.readPoint(pointId, { signal: combinedSignal }),
                        combinedSignal,
                      )
                    } catch (e) {
                      if (isTimeoutOrAborted(e, combinedSignal)) throw e
                    }
                  }
                }
                checkDeadline()
                actualValue = reading || undefined
                if (reading) {
                  const sampleVal = reading.value !== undefined ? reading.value : reading.rawValue
                  telemetrySamples.push({ pointId, timestamp: reading.timestamp || Date.now(), value: sampleVal })
                }
                break
              }

              case 'no.exception': {
                if (!debugRuntime || !debugSessionId) {
                  actualValue = { error: 'NO_DEBUG_SESSION', message: '未关联活跃调试会话，无法确认异常状态' }
                } else {
                  const evData = debugRuntime.getEvents({ debugSessionId, ownerSessionId }, 0, 500)
                  const events = evData?.events || []
                  const hasException = events.some(
                    (/** @type {any} */ e) =>
                      e.type === 'debug.exception' || (e.type === 'debug.paused' && e.payload?.reason === 'exception'),
                  )
                  actualValue = hasException
                }
                break
              }

              case 'no.alarm': {
                const pointId = spec.pointId || spec.source?.pointId
                const ws = workspaceLoader(workspaceCwd)
                const modbus = ws?.modbus || ws
                const points = Array.isArray(modbus?.points) ? modbus.points : []
                const alarmState =
                  (modbus && typeof modbus === 'object' && modbus.alarmState) ||
                  (ws && typeof ws === 'object' && ws.alarmState) ||
                  {}
                const legacyAlarms = (ws && Array.isArray(ws.alarms) ? ws.alarms : []).concat(
                  modbus && Array.isArray(modbus.alarms) ? modbus.alarms : [],
                )

                const hasAlarmSource = Boolean(
                  ws && (points.length > 0 || Object.keys(alarmState).length > 0 || legacyAlarms.length > 0),
                )

                if (pointId) {
                  const pointExists =
                    points.some((/** @type {any} */ p) => p && p.id === pointId) ||
                    alarmState[pointId] !== undefined ||
                    legacyAlarms.some((/** @type {any} */ a) => a && (a.pointId === pointId || a.id === pointId))
                  if (!hasAlarmSource) {
                    actualValue = { error: 'NO_ALARM_SOURCE', message: '工作区无有效点位或告警源' }
                  } else if (!pointExists && points.length > 0) {
                    actualValue = { error: 'NO_ALARM_SOURCE', message: `点位 [${pointId}] 不存在或未配置告警源` }
                  } else {
                    const alm = alarmState[pointId]
                    const isActiveState = alm && (alm.condition === 'active' || alm.status === 'active' || alm === true)
                    const isActiveLegacy = legacyAlarms.some(
                      (/** @type {any} */ a) =>
                        (a.pointId === pointId || a.id === pointId) && (a.active || a.condition === 'active'),
                    )
                    actualValue = isActiveState || isActiveLegacy ? 1 : 0
                  }
                } else {
                  if (!hasAlarmSource) {
                    actualValue = { error: 'NO_ALARM_SOURCE', message: '工作区无有效点位或告警源' }
                  } else {
                    const activeStateCount = Object.values(alarmState).filter(
                      (/** @type {any} */ a) => a && (a.condition === 'active' || a.status === 'active' || a === true),
                    ).length
                    const activeLegacyCount = legacyAlarms.filter(
                      (/** @type {any} */ a) => a && (a.active || a.condition === 'active'),
                    ).length
                    actualValue = activeStateCount + activeLegacyCount
                  }
                }
                break
              }

              case 'range': {
                const expr = spec.expr || spec.expression || spec.source?.expr || spec.source?.expression
                const pointId = spec.pointId || spec.source?.pointId

                if (expr && debugRuntime && debugSessionId) {
                  const res = await withTimeoutSignal(
                    debugRuntime.command({ debugSessionId, ownerSessionId }, { type: 'evaluate', expression: expr }),
                    combinedSignal,
                  )
                  checkDeadline()
                  actualValue = res?.value
                  telemetrySamples.push({ expr, timestamp: Date.now(), value: actualValue })
                } else if (pointId) {
                  let reading = null
                  try {
                    reading = await withTimeoutSignal(
                      telemetryReader.readPoint({ cwd: workspaceCwd, sessionId: ownerSessionId }, pointId, {
                        signal: combinedSignal,
                      }),
                      combinedSignal,
                    )
                  } catch (e) {
                    if (isTimeoutOrAborted(e, combinedSignal)) throw e
                  }
                  if (!reading) {
                    try {
                      reading = await withTimeoutSignal(
                        telemetryReader.readPoint(pointId, { signal: combinedSignal }),
                        combinedSignal,
                      )
                    } catch (e) {
                      if (isTimeoutOrAborted(e, combinedSignal)) throw e
                    }
                  }
                  checkDeadline()
                  actualValue = reading ? (reading.value ?? reading.rawValue) : undefined
                  if (reading) {
                    telemetrySamples.push({ pointId, timestamp: reading.timestamp || Date.now(), value: actualValue })
                  }
                }
                break
              }

              case 'changed': {
                const expr = spec.expr || spec.expression || spec.source?.expr || spec.source?.expression
                const pointId = spec.pointId || spec.source?.pointId

                if (expr && debugRuntime && debugSessionId) {
                  const res = await withTimeoutSignal(
                    debugRuntime.command({ debugSessionId, ownerSessionId }, { type: 'evaluate', expression: expr }),
                    combinedSignal,
                  )
                  checkDeadline()
                  actualValue = { initial: spec.value, current: res?.value }
                  telemetrySamples.push({ expr, timestamp: Date.now(), value: res?.value })
                } else if (pointId) {
                  let reading = null
                  try {
                    reading = await withTimeoutSignal(
                      telemetryReader.readPoint({ cwd: workspaceCwd, sessionId: ownerSessionId }, pointId, {
                        signal: combinedSignal,
                      }),
                      combinedSignal,
                    )
                  } catch (e) {
                    if (isTimeoutOrAborted(e, combinedSignal)) throw e
                  }
                  if (!reading) {
                    try {
                      reading = await withTimeoutSignal(
                        telemetryReader.readPoint(pointId, { signal: combinedSignal }),
                        combinedSignal,
                      )
                    } catch (e) {
                      if (isTimeoutOrAborted(e, combinedSignal)) throw e
                    }
                  }
                  checkDeadline()
                  const currentVal = reading ? (reading.value ?? reading.rawValue) : undefined
                  actualValue = { initial: spec.value, current: currentVal }
                  if (reading) {
                    telemetrySamples.push({ pointId, timestamp: reading.timestamp || Date.now(), value: currentVal })
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
                  checkDeadline()

                  if (expr && debugRuntime && debugSessionId) {
                    const res = await withTimeoutSignal(
                      debugRuntime.command({ debugSessionId, ownerSessionId }, { type: 'evaluate', expression: expr }),
                      combinedSignal,
                    )
                    checkDeadline()
                    const val = Number(res?.value)
                    samples.push(val)
                    telemetrySamples.push({ expr, timestamp: Date.now(), value: val })
                  } else if (pointId) {
                    let reading = null
                    try {
                      reading = await withTimeoutSignal(
                        telemetryReader.readPoint({ cwd: workspaceCwd, sessionId: ownerSessionId }, pointId, {
                          signal: combinedSignal,
                        }),
                        combinedSignal,
                      )
                    } catch (e) {
                      if (isTimeoutOrAborted(e, combinedSignal)) throw e
                    }
                    if (!reading) {
                      try {
                        reading = await withTimeoutSignal(
                          telemetryReader.readPoint(pointId, { signal: combinedSignal }),
                          combinedSignal,
                        )
                      } catch (e) {
                        if (isTimeoutOrAborted(e, combinedSignal)) throw e
                      }
                    }
                    checkDeadline()
                    const val = Number(reading?.value ?? reading?.rawValue)
                    samples.push(val)
                    telemetrySamples.push({ pointId, timestamp: reading?.timestamp || Date.now(), value: val })
                  }

                  if (Date.now() - sampleStart + intervalMs > duration) {
                    break
                  }
                  await abortableDelay(intervalMs, combinedSignal)
                  checkDeadline()
                }
                actualValue = samples
                break
              }

              default:
                actualValue = undefined
            }
          } catch (err) {
            const errorObj = /** @type {any} */ (err)
            if (timeoutController.signal.aborted || errorObj?.message === 'VERIFY_TIMEOUT') {
              return createVerifyResult({
                verificationRunId: options.verificationRunId,
                scenario,
                status: 'timeout',
                durationMs: Date.now() - startTime,
                startAt: startTime,
                endAt: Date.now(),
                assertions: assertionResults,
                telemetrySamples,
                error: err,
              })
            }
            if (
              signal?.aborted ||
              combinedSignal.aborted ||
              errorObj?.message === 'VERIFY_CANCELLED' ||
              errorObj?.name === 'AbortError'
            ) {
              return createVerifyResult({
                verificationRunId: options.verificationRunId,
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
              return createVerifyResult({
                verificationRunId: options.verificationRunId,
                scenario,
                status: 'timeout',
                durationMs: Date.now() - startTime,
                startAt: startTime,
                endAt: Date.now(),
                assertions: assertionResults,
                telemetrySamples,
                error: e,
              })
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
      } catch (err) {
        const errorObj = /** @type {any} */ (err)
        if (timeoutController.signal.aborted || errorObj?.message === 'VERIFY_TIMEOUT') {
          return createVerifyResult({
            verificationRunId: options.verificationRunId,
            scenario,
            status: 'timeout',
            durationMs: Date.now() - startTime,
            startAt: startTime,
            endAt: Date.now(),
            assertions: assertionResults,
            telemetrySamples,
            error: err,
          })
        }
        if (
          signal?.aborted ||
          combinedSignal.aborted ||
          errorObj?.message === 'VERIFY_CANCELLED' ||
          errorObj?.name === 'AbortError'
        ) {
          return createVerifyResult({
            verificationRunId: options.verificationRunId,
            scenario,
            status: 'cancelled',
            durationMs: Date.now() - startTime,
            startAt: startTime,
            endAt: Date.now(),
            assertions: assertionResults,
            telemetrySamples,
          })
        }
        return createVerifyResult({
          verificationRunId: options.verificationRunId,
          scenario,
          status: 'error',
          durationMs: Date.now() - startTime,
          startAt: startTime,
          endAt: Date.now(),
          assertions: assertionResults,
          telemetrySamples,
          error: err,
        })
      } finally {
        clearTimeout(timeoutTimer)
      }
    },
  }
}
