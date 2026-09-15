// @ts-check

import { abortableDelay } from './abort-signals.mjs'
import { isTimeoutOrAborted, withTimeoutSignal } from './verify-timeout.mjs'

/**
 * @typedef {{
 *   debugRuntime?: any,
 *   debugSessionId?: string,
 *   ownerSessionId: string,
 *   workspaceCwd: string,
 *   telemetryReader?: any,
 *   combinedSignal: AbortSignal,
 *   timeoutMs: number,
 *   checkDeadline: () => void,
 *   telemetrySamples: Array<{ pointId?: string, expr?: string, timestamp: number, value: any }>,
 * }} VerifySampleContext
 */

/**
 * @param {VerifySampleContext} ctx
 * @param {string} pointId
 * @param {{ maxAgeMs?: number }} [opts]
 */
export async function readTelemetryPoint(ctx, pointId, opts = {}) {
  const { telemetryReader, workspaceCwd, ownerSessionId, combinedSignal } = ctx
  if (!telemetryReader || typeof telemetryReader.readPoint !== 'function') return null
  let reading = null
  try {
    reading = await withTimeoutSignal(
      telemetryReader.readPoint({ cwd: workspaceCwd, sessionId: ownerSessionId }, pointId, {
        ...opts,
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
  return reading
}

/**
 * Sample a point or expression repeatedly for `stable-for-duration` assertions.
 * @param {VerifySampleContext} ctx
 * @param {any} spec
 * @returns {Promise<number[]>}
 */
export async function sampleStableDuration(ctx, spec) {
  const {
    debugRuntime,
    debugSessionId,
    ownerSessionId,
    combinedSignal,
    timeoutMs,
    checkDeadline,
    telemetrySamples,
  } = ctx
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
      const reading = await readTelemetryPoint(ctx, pointId)
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
  return samples
}
