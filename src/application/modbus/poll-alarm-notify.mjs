// @ts-check
// Emit journal + optional Agent followups only from committed alarm transitions.
import { decodeValue } from '../../domain/modbus/point-math.mjs'
import { pointLabel } from '../../domain/modbus/point-model.mjs'
import { runningTasks } from '../../domain/modbus/journal-model.mjs'
import { isScopePartitioned, normalizeScopeSessionId } from '../../domain/modbus/config-scope.mjs'
import { recordBenchEvent } from '../../infrastructure/store/journal-store.mjs'
import { loadWorkspace } from '../../infrastructure/store/workspace-store.mjs'
import { normalizeModbus } from './modbus-migration.mjs'
import { modbusForSession } from './workspace-session-view.mjs'
import { pendingWrites, prunePendingWrites } from './modbus-runtime-context.mjs'
import {
  MAX_DELIVERY_ATTEMPTS,
  WATCH_TTL_MS,
  agentAlarmWatchByKey,
  beginDeliveryAttempt,
  clearAgentAlarmWatch,
  clockNow,
  deliverNotify,
  deliveryLedger,
  getAgentAlarmWatch,
  markDelivered,
  pruneExpiredWatches,
  resetAlarmNotifyTestHooks,
  setAgentAlarmWatch,
  setAlarmNotifyTestHooks,
} from './alarm-notify-registry.mjs'

export {
  clearAgentAlarmWatch,
  getAgentAlarmWatch,
  resetAlarmNotifyTestHooks,
  setAgentAlarmWatch,
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
  const transitionAt =
    Number(item?.at) ||
    Number(item?.eventAt) ||
    Number(item?.commitSeq) ||
    Number(item?.alarm?.firstAt) ||
    Number(item?.alarm?.lastAt) ||
    0
  const realEventId = item?.eventId || item?.alarm?.eventId
  const eventId = realEventId
    ? String(realEventId)
    : `alarm:${String(ctx.cwd || '')}:${String(ctx.sessionId || '')}:${connectionId}:${pointId}:${kind}:${transitionAt}`
  return { eventId, pointId, connectionId, eventAt: transitionAt, kind }
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
 * @param {string} home
 * @param {string} cwd
 * @param {any} item
 * @returns {{ shouldNotify: boolean, sessionId: string, commandId: string, testRunId: string, reason: string }}
 */
export function shouldNotifyAgentOfProcessAlarm(home, cwd, item) {
  pruneExpiredWatches(cwd)
  const meta = alarmEventMeta(item, { cwd })
  const { pointId, connectionId } = meta

  const prefix = `${String(cwd || '')}::`
  for (const [key, watch] of agentAlarmWatchByKey) {
    if (!key.startsWith(prefix)) continue
    if (!watch?.followup) continue
    if (Number(watch.expiresAt) > 0 && Number(watch.expiresAt) <= clockNow()) {
      agentAlarmWatchByKey.delete(key)
      continue
    }
    const pointOk = !watch.pointIds.size || watch.pointIds.has(pointId)
    const connOk = !watch.connectionId || watch.connectionId === connectionId
    if (pointOk && connOk) {
      return {
        shouldNotify: true,
        sessionId: watch.sessionId,
        commandId: '',
        testRunId: watch.testRunId,
        reason: 'agent-watch',
      }
    }
  }

  const ws = loadWorkspace(home, cwd)
  const focus = ws?.focus
  if (focus?.request?.by === 'agent') {
    const req = focus.request
    const focusSession = String(focus.sessionId || ws.session?.boundId || '')
    const related =
      (req.alarmId && (req.alarmId === pointId || req.alarmId === item?.alarm?.id)) ||
      (req.pointId && req.pointId === pointId) ||
      (req.connectionId && req.connectionId === connectionId && req.kind === 'alarm')
    if (related) {
      return {
        shouldNotify: true,
        sessionId: focusSession,
        commandId: '',
        testRunId: '',
        reason: 'agent-focus',
      }
    }
  }

  const boundId = ws?.session?.boundId || ''
  prunePendingWrites()
  for (const entry of pendingWrites.values()) {
    if (entry.cwd !== cwd) continue
    const params = entry.params || {}
    if (params.source !== 'agent') continue
    const sessionId = String(params.sessionId || boundId || '')
    const related =
      (params.pointId && params.pointId === pointId) ||
      (params.connectionId && params.connectionId === connectionId)
    if (!related) continue
    return {
      shouldNotify: true,
      sessionId,
      commandId: entry.id || params.commandId || '',
      testRunId: '',
      reason: 'pending-write',
    }
  }

  const running = runningTasks(ws?.tasks).filter((/** @type {any} */ t) => t.source === 'agent')
  for (const task of running) {
    if (!['read', 'write', 'poll', 'manual'].includes(String(task.type || ''))) continue
    const sessionId = String(task.sessionId || '')
    const related =
      (task.pointId && task.pointId === pointId) ||
      (task.connectionId && task.connectionId === connectionId) ||
      (Array.isArray(task.pointIds) && task.pointIds.includes(pointId))
    if (!related) continue
    if (!sessionId && !boundId) continue
    return {
      shouldNotify: true,
      sessionId: sessionId || boundId,
      commandId: task.id || '',
      testRunId: '',
      reason: 'pending-agent-task',
    }
  }

  const manuals = Array.isArray(ws?.manualRequests) ? ws.manualRequests : []
  for (const req of manuals) {
    if (req?.source !== 'agent') continue
    if (req.status && req.status !== 'open' && req.status !== 'pending') continue
    const sessionId = String(req.sessionId || '')
    const related =
      (req.pointId && req.pointId === pointId) ||
      (req.connectionId && req.connectionId === connectionId)
    if (!related) continue
    if (!sessionId && !boundId) continue
    return {
      shouldNotify: true,
      sessionId: sessionId || boundId,
      commandId: req.id || '',
      testRunId: '',
      reason: 'pending-manual',
    }
  }

  return { shouldNotify: false, sessionId: '', commandId: '', testRunId: '', reason: 'no-watch' }
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
 * @returns {Promise<{ notified: number, recorded: number, failed: number }>}
 */
export async function emitCommittedAlarmTransitions(home, cwd, alarms) {
  if (!alarms) return { notified: 0, recorded: 0, failed: 0 }
  const fired = Array.isArray(alarms.fired) ? alarms.fired : []
  const recovered = Array.isArray(alarms.recovered) ? alarms.recovered : []
  let notified = 0
  let recorded = 0
  let failed = 0

  if (fired.length) {
    const procFired = fired.filter((/** @type {any} */ f) => f.point)
    const commFired = fired.filter((/** @type {any} */ f) => f.connectionId && !f.point)
    if (procFired.length) {
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
        const gate = shouldNotifyAgentOfProcessAlarm(home, cwd, item)
        if (!gate.shouldNotify) continue
        const meta = alarmEventMeta(item, { cwd, sessionId: gate.sessionId })
        const live = recheckAlarmCurrent(home, cwd, item, gate.sessionId)
        // Historical (deleted/cleared) events stay in the journal only — not current faults.
        if (!live.current) continue
        const attempt = beginDeliveryAttempt(meta.eventId)
        if (!attempt.proceed) continue
        const detail = JSON.stringify({
          eventId: meta.eventId,
          pointId: meta.pointId,
          connectionId: meta.connectionId,
          eventAt: meta.eventAt,
          commandId: gate.commandId || undefined,
          testRunId: gate.testRunId || undefined,
          state: live.state,
          historical: false,
        })
        const limit = item.kind === 'max' ? item.point.alarmMax : item.point.alarmMin
        const head = `${pointLabel(item.point)}=${decodeValue(item.point, item.raw ?? item.alarm?.value)}${item.kind === 'max' ? `>${limit}` : `<${limit}`}`
        const delivered = await deliverNotify(home, cwd, `Vision 告警：${head}`, detail, {
          sessionId: gate.sessionId,
        })
        if (delivered && delivered.ok === true) {
          markDelivered(meta.eventId)
          notified += 1
        } else {
          failed += 1
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

  return { notified, recorded, failed }
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
  WATCH_TTL_MS,
  MAX_DELIVERY_ATTEMPTS,
}
