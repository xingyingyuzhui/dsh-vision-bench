// @ts-check

import { withTimeoutSignal } from './verify-timeout.mjs'
import { readTelemetryPoint, sampleStableDuration } from './verify-sampling.mjs'

/**
 * Resolve the actual value for one assertion spec (sampling + domain reads).
 * Domain `evaluateAssertion` is applied by the caller.
 *
 * @param {import('./verify-sampling.mjs').VerifySampleContext & {
 *   workspaceLoader?: (cwd: string) => any,
 * }} ctx
 * @param {any} spec
 * @returns {Promise<any>}
 */
export async function resolveAssertionActual(ctx, spec) {
  const {
    debugRuntime,
    debugSessionId,
    ownerSessionId,
    workspaceCwd,
    workspaceLoader,
    combinedSignal,
    checkDeadline,
    telemetrySamples,
  } = ctx

  switch (spec.type) {
    case 'debug.expression': {
      const expr = spec.expr || spec.expression || ''
      if (debugRuntime && debugSessionId) {
        const res = await withTimeoutSignal(
          debugRuntime.command({ debugSessionId, ownerSessionId }, { type: 'evaluate', expression: expr }),
          combinedSignal,
        )
        checkDeadline()
        const actualValue = res?.value
        telemetrySamples.push({ expr, timestamp: Date.now(), value: actualValue })
        return actualValue
      }
      return undefined
    }

    case 'modbus.point': {
      const pointId = spec.pointId || spec.source?.pointId || ''
      const maxAgeMs = typeof spec.maxAgeMs === 'number' ? spec.maxAgeMs : undefined
      const reading = await readTelemetryPoint(ctx, pointId, { maxAgeMs })
      checkDeadline()
      if (reading) {
        const sampleVal = reading.value !== undefined ? reading.value : reading.rawValue
        telemetrySamples.push({ pointId, timestamp: reading.timestamp || Date.now(), value: sampleVal })
      }
      return reading || undefined
    }

    case 'no.exception': {
      if (!debugRuntime || !debugSessionId) {
        return { error: 'NO_DEBUG_SESSION', message: '未关联活跃调试会话，无法确认异常状态' }
      }
      const evData = debugRuntime.getEvents({ debugSessionId, ownerSessionId }, 0, 500)
      const events = evData?.events || []
      return events.some(
        (/** @type {any} */ e) =>
          e.type === 'debug.exception' || (e.type === 'debug.paused' && e.payload?.reason === 'exception'),
      )
    }

    case 'no.alarm': {
      const pointId = spec.pointId || spec.source?.pointId
      const ws = workspaceLoader?.(workspaceCwd)
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
          return { error: 'NO_ALARM_SOURCE', message: '工作区无有效点位或告警源' }
        }
        if (!pointExists && points.length > 0) {
          return { error: 'NO_ALARM_SOURCE', message: `点位 [${pointId}] 不存在或未配置告警源` }
        }
        const alm = alarmState[pointId]
        const isActiveState = alm && (alm.condition === 'active' || alm.status === 'active' || alm === true)
        const isActiveLegacy = legacyAlarms.some(
          (/** @type {any} */ a) =>
            (a.pointId === pointId || a.id === pointId) && (a.active || a.condition === 'active'),
        )
        return isActiveState || isActiveLegacy ? 1 : 0
      }
      if (!hasAlarmSource) {
        return { error: 'NO_ALARM_SOURCE', message: '工作区无有效点位或告警源' }
      }
      const activeStateCount = Object.values(alarmState).filter(
        (/** @type {any} */ a) => a && (a.condition === 'active' || a.status === 'active' || a === true),
      ).length
      const activeLegacyCount = legacyAlarms.filter(
        (/** @type {any} */ a) => a && (a.active || a.condition === 'active'),
      ).length
      return activeStateCount + activeLegacyCount
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
        const actualValue = res?.value
        telemetrySamples.push({ expr, timestamp: Date.now(), value: actualValue })
        return actualValue
      }
      if (pointId) {
        const reading = await readTelemetryPoint(ctx, pointId)
        checkDeadline()
        const actualValue = reading ? (reading.value ?? reading.rawValue) : undefined
        if (reading) {
          telemetrySamples.push({ pointId, timestamp: reading.timestamp || Date.now(), value: actualValue })
        }
        return actualValue
      }
      return undefined
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
        telemetrySamples.push({ expr, timestamp: Date.now(), value: res?.value })
        return { initial: spec.value, current: res?.value }
      }
      if (pointId) {
        const reading = await readTelemetryPoint(ctx, pointId)
        checkDeadline()
        const currentVal = reading ? (reading.value ?? reading.rawValue) : undefined
        if (reading) {
          telemetrySamples.push({ pointId, timestamp: reading.timestamp || Date.now(), value: currentVal })
        }
        return { initial: spec.value, current: currentVal }
      }
      return undefined
    }

    case 'stable-for-duration':
      return sampleStableDuration(ctx, spec)

    default:
      return undefined
  }
}
