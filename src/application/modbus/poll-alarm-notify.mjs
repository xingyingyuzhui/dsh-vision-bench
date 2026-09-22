// @ts-check
// Emit journal + optional Agent followups only from committed alarm transitions.
import { randomUUID } from 'node:crypto'
import { decodeValue } from '../../domain/modbus/point-math.mjs'
import { pointLabel } from '../../domain/modbus/point-model.mjs'
import { isScopePartitioned, normalizeScopeSessionId } from '../../domain/modbus/config-scope.mjs'
import { recordBenchEvent } from '../../infrastructure/store/journal-store.mjs'
import { loadWorkspace } from '../../infrastructure/store/workspace-store.mjs'
import { normalizeModbus } from './modbus-migration.mjs'
import { modbusForSession } from './workspace-session-view.mjs'
import {
  MAX_DELIVERY_ATTEMPTS,
  WATCH_TTL_MS,
  agentAlarmWatchByKey,
  beginDeliveryAttempt,
  clearAgentAlarmWatch,
  clearAlarmNotifyRegistryRuntime,
  deliverNotify,
  deliveryLedger,
  getAgentAlarmWatch,
  getDeliveryEntry,
  markDelivered,
  markExhausted,
  markQueued,
  resetAlarmNotifyTestHooks,
  setAgentAlarmWatch,
  setAlarmNotifyTestHooks,
} from './alarm-notify-registry.mjs'
import { matchingAlarmRecipients, recipientStillAuthorized, resolveAlarmEventOwnership } from './alarm-notify-match.mjs'
import {
  cancelAlarmNotifyRetries,
  clearAlarmNotifyRetryRuntime,
  enqueueAlarmNotifyRetry,
  resetAlarmNotifyRetryTestHooks,
  setAlarmNotifyRetryTestHooks,
} from './alarm-notify-retry.mjs'
import { revokeAgentAlarmSubscription } from './alarm-notify-registry.mjs'

export {
  cancelAlarmNotifyRetries,
  clearAgentAlarmWatch,
  clearAlarmNotifyRegistryRuntime,
  clearAlarmNotifyRetryRuntime,
  getAgentAlarmWatch,
  matchingAlarmRecipients,
  recipientStillAuthorized,
  resetAlarmNotifyRetryTestHooks,
  resetAlarmNotifyTestHooks,
  resolveAlarmEventOwnership,
  revokeAgentAlarmSubscription,
  setAgentAlarmWatch,
  setAlarmNotifyRetryTestHooks,
  setAlarmNotifyTestHooks,
}

/**
 * @param {any} item
 * @param {{ cwd?: string, sessionId?: string }} [ctx]
 * @returns {{ eventId: string, pointId: string, connectionId: string, eventAt: number, kind: string }}
 */
/**
 * @param {any} item
 * @param {{ cwd?: string, sessionId?: string }} [ctx]
 * @returns {{ eventId: string, pointId: string, connectionId: string, eventAt: number, kind: string }}
 */
function alarmEventMeta(item, ctx = {}) {
  const point = item?.point
  const pointId = String(point?.id || item?.pointId || item?.alarm?.pointId || '')
  const connectionId = String(
    point?.connectionId || item?.connectionId || item?.alarm?.connectionId || '',
  )
  const kind = String(item?.kind || item?.alarm?.kind || '')
  // Verifiable transition markers only (not episode firstAt/lastAt reuse).
  const explicitTransitionAt =
    Number(item?.at) || Number(item?.eventAt) || Number(item?.commitSeq) || 0
  // eventAt is THIS migration time — prefer lastAt over firstAt.
  const eventAt =
    explicitTransitionAt || Number(item?.alarm?.lastAt) || Number(item?.alarm?.firstAt) || 0
  const realEventId = item?.eventId || item?.alarm?.eventId
  let eventId
  if (realEventId) {
    eventId = String(realEventId)
  } else if (explicitTransitionAt) {
    // Fallback for old callers / synthetic tests that carry a transition time.
    eventId = `alarm:${String(ctx.cwd || '')}:${String(ctx.sessionId || '')}:${connectionId}:${pointId}:${kind}:${explicitTransitionAt}`
  } else {
    // No verifiable transition time (e.g. suppress-window re-fire reuses firstAt).
    // Mint a fresh id so distinct events are never permanently merged.
    eventId = `alarm:${randomUUID()}`
  }
  return { eventId, pointId, connectionId, eventAt, kind }
}

/**
 * Re-check live point + alarm state. Deleted / cleared → historical, not current fault.
 * When the workspace is partitioned, sessionId is required (no top-level points guess).
 *
 * @param {string} home
 * @param {string} cwd
 * @param {any} item
 * @param {string} [sessionId]
 * @returns {{ current: boolean, historical: boolean, state: string, pointExists: boolean }}
 */
export function recheckAlarmCurrent(home, cwd, item, sessionId) {
  const sid = normalizeScopeSessionId(sessionId)
  const { pointId, connectionId } = alarmEventMeta(item, { cwd, sessionId: sid })
  const ws = loadWorkspace(home, cwd)
  const partitioned = isScopePartitioned(ws?.modbus)
  if (partitioned && !sid) {
    return { current: false, historical: true, state: 'session-required', pointExists: false }
  }
  // Partitioned: project the session's private topology. Shared (unpartitioned):
  // use the flat pack — do not project an empty private layer for a random sessionId.
  const pack = partitioned ? modbusForSession(ws, sid) : normalizeModbus(ws?.modbus)
  const pointExists = !!(pointId && (pack.points || []).some((/** @type {any} */ p) => p.id === pointId))
  const alarm =
    (pack.alarmState && (pack.alarmState[pointId] || pack.alarmState[item?.alarm?.id])) || null
  const active = !!(alarm && alarm.condition === 'active')
  if (!pointExists || !active) {
    return { current: false, historical: true, state: pointExists ? 'cleared' : 'deleted', pointExists }
  }
  if (connectionId && pack.points) {
    const pt = pack.points.find((/** @type {any} */ p) => p.id === pointId)
    if (pt && pt.connectionId && pt.connectionId !== connectionId) {
      return { current: false, historical: true, state: 'mismatched', pointExists: true }
    }
  }
  return { current: true, historical: false, state: 'active', pointExists: true }
}

/**
 * Backward-compatible single-gate helper (first recipient only).
 * Prefer matchingAlarmRecipients for multi-session fan-out.
 *
 * @param {string} home
 * @param {string} cwd
 * @param {any} item
 * @returns {{ shouldNotify: boolean, sessionId: string, commandId: string, testRunId: string, reason: string }}
 */
export function shouldNotifyAgentOfProcessAlarm(home, cwd, item) {
  const match = matchingAlarmRecipients(home, cwd, item, undefined)
  if (match.ambiguousOwner) {
    return { shouldNotify: false, sessionId: '', commandId: '', testRunId: '', reason: 'ambiguous-owner' }
  }
  const first = match.recipients[0]
  if (!first) {
    return { shouldNotify: false, sessionId: '', commandId: '', testRunId: '', reason: 'no-watch' }
  }
  return {
    shouldNotify: true,
    sessionId: first.sessionId,
    commandId: first.commandId,
    testRunId: first.testRunId,
    reason: first.reason,
  }
}

/**
 * @param {string} eventId
 * @returns {{ proceed: boolean, entry: { state: 'pending' | 'delivered', attempts: number, at: number } | null }}
 */

/**
 * @param {string} eventId
 */

/**
 * @param {any} home
 * @param {string} cwd
 * @param {string} summary
 * @param {string} detail
 * @param {any} opts
 */

/**
 * @param {any} home
 * @param {string} cwd
 * @param {{ fired?: any[], recovered?: any[] } | null | undefined} alarms
 * @param {{ sourceSessionId?: string, sourceSessionByConnection?: Record<string, string> }} [opts]
 * @returns {Promise<{ notified: number, recorded: number, failed: number, queued: number, ambiguousOwner: boolean }>}
 */
export async function emitCommittedAlarmTransitions(home, cwd, alarms, opts = {}) {
  if (!alarms) return { notified: 0, recorded: 0, failed: 0, queued: 0, ambiguousOwner: false }
  const fired = Array.isArray(alarms.fired) ? alarms.fired : []
  const recovered = Array.isArray(alarms.recovered) ? alarms.recovered : []
  const sourceSessionId = opts.sourceSessionId
  const sourceSessionByConnection = opts.sourceSessionByConnection || {}
  let notified = 0
  let recorded = 0
  let failed = 0
  let queued = 0
  let ambiguousOwner = false

  /**
   * Per-event source: the connection's resolved poll owner wins over batch default.
   * @param {any} item
   */
  const sourceOf = (item) => {
    const cid = String(
      item?.point?.connectionId || item?.connectionId || item?.alarm?.connectionId || '',
    )
    if (cid && Object.prototype.hasOwnProperty.call(sourceSessionByConnection, cid)) {
      return sourceSessionByConnection[cid] || undefined
    }
    return sourceSessionId
  }

  if (fired.length) {
    const procFired = fired.filter((/** @type {any} */ f) => f.point)
    const commFired = fired.filter((/** @type {any} */ f) => f.connectionId && !f.point)
    if (procFired.length) {
      // Journal once per committed transition batch — never once per recipient.
      const summaries = procFired.slice(0, 5).map((/** @type {any} */ item) => {
        const limit = item.kind === 'max' ? item.point.alarmMax : item.point.alarmMin
        return `${pointLabel(item.point)}=${decodeValue(item.point, item.raw ?? item.alarm?.value)}${item.kind === 'max' ? `>${limit}` : `<${limit}`}`
      })
      await recordBenchEvent(
        home,
        cwd,
        {
          action: 'alarm',
          ok: false,
          summary: `越限告警：${summaries.join('；')}`,
        },
        { source: 'system' },
      )
      recorded += 1

      for (const item of procFired) {
        const match = matchingAlarmRecipients(home, cwd, item, sourceOf(item))
        if (match.ambiguousOwner) {
          ambiguousOwner = true
          await recordBenchEvent(
            home,
            cwd,
            {
              action: 'alarm',
              ok: false,
              summary: `告警通知跳过：ambiguous-owner (${(match.owners || []).join(',') || 'unknown'})`,
            },
            { source: 'system' },
          )
          recorded += 1
          continue
        }
        for (const recipient of match.recipients) {
          const meta = alarmEventMeta(item, { cwd, sessionId: recipient.sessionId })
          const live = recheckAlarmCurrent(home, cwd, item, recipient.sessionId)
          // Historical (deleted/cleared) events stay in the journal only — not current faults.
          if (!live.current) continue
          const attempt = beginDeliveryAttempt(meta.eventId, recipient.sessionId)
          if (!attempt.proceed) continue
          const detail = JSON.stringify({
            eventId: meta.eventId,
            pointId: meta.pointId,
            connectionId: meta.connectionId,
            eventAt: meta.eventAt,
            commandId: recipient.commandId || undefined,
            testRunId: recipient.testRunId || undefined,
            state: live.state,
            historical: false,
          })
          const limit = item.kind === 'max' ? item.point.alarmMax : item.point.alarmMin
          const head = `${pointLabel(item.point)}=${decodeValue(item.point, item.raw ?? item.alarm?.value)}${item.kind === 'max' ? `>${limit}` : `<${limit}`}`
          const summary = `Vision 告警：${head}`
          const notifyOpts = { sessionId: recipient.sessionId }
          const delivered = await deliverNotify(home, cwd, summary, detail, notifyOpts)
          if (delivered && delivered.ok === true) {
            markDelivered(meta.eventId, recipient.sessionId)
            notified += 1
          } else {
            failed += 1
            const enq = enqueueAlarmNotifyRetry({
              eventId: meta.eventId,
              sessionId: recipient.sessionId,
              home,
              cwd,
              summary,
              detail,
              opts: notifyOpts,
              attempts: attempt.entry?.attempts || 1,
              item,
              recipient,
              sourceSessionId: sourceOf(item),
              recheck: recheckAlarmCurrent,
            })
            if (enq.queued) queued += 1
            else markExhausted(meta.eventId, recipient.sessionId)
          }
        }
      }
    }
    if (commFired.length) {
      await recordBenchEvent(
        home,
        cwd,
        {
          action: 'alarm',
          ok: false,
          summary: `通信告警：${commFired
            .slice(0, 3)
            .map((/** @type {any} */ c) => c.label || c.connectionId)
            .join('；')}`,
        },
        { source: 'system' },
      )
      recorded += 1
    }
  }

  if (recovered.length) {
    const procRec = recovered.filter((/** @type {any} */ r) => r.point)
    const commRec = recovered.filter((/** @type {any} */ r) => r.connectionId && !r.point)
    if (procRec.length) {
      await recordBenchEvent(
        home,
        cwd,
        {
          action: 'alarm-clear',
          ok: true,
          summary: `告警恢复：${procRec
            .slice(0, 5)
            .map((/** @type {any} */ item) => `${pointLabel(item.point)}=${decodeValue(item.point, item.raw ?? item.alarm?.value)}`)
            .join('；')}`,
        },
        { source: 'system' },
      )
      recorded += 1
    }
    if (commRec.length) {
      await recordBenchEvent(
        home,
        cwd,
        {
          action: 'alarm-clear',
          ok: true,
          summary: `通信恢复：${commRec
            .slice(0, 3)
            .map((/** @type {any} */ c) => c.connectionId)
            .join('；')}`,
        },
        { source: 'system' },
      )
      recorded += 1
    }
  }

  return { notified, recorded, failed, queued, ambiguousOwner }
}

/** Host dispose: cancel retries and drop in-memory notify state. */
export function disposeAlarmNotifyRuntime() {
  cancelAlarmNotifyRetries()
  clearAlarmNotifyRetryRuntime()
  clearAlarmNotifyRegistryRuntime()
}

export const _internal = {
  agentAlarmWatchByKey,
  get agentAlarmWatchByCwd() {
    return agentAlarmWatchByKey
  },
  deliveryLedger,
  alarmEventMeta,
  beginDeliveryAttempt,
  markDelivered,
  markQueued,
  markExhausted,
  getDeliveryEntry,
  matchingAlarmRecipients,
  enqueueAlarmNotifyRetry,
  disposeAlarmNotifyRuntime,
  WATCH_TTL_MS,
  MAX_DELIVERY_ATTEMPTS,
}
