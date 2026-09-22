// @ts-check
/**
 * Multi-session alarm recipient matching.
 * Explicit watches win over focus/pending-write fallbacks; one notify per session.
 */
import { runningTasks } from '../../domain/modbus/journal-model.mjs'
import { isCategoryShared, isScopePartitioned, normalizeScopeSessionId } from '../../domain/modbus/config-scope.mjs'
import { loadWorkspace } from '../../infrastructure/store/workspace-store.mjs'
import { normalizeModbus } from './modbus-migration.mjs'
import { modbusForSession } from './workspace-session-view.mjs'
import { pendingWrites, prunePendingWrites } from './modbus-runtime-context.mjs'
import {
  agentAlarmWatchByKey,
  clockNow,
  getAgentAlarmWatch,
  pruneExpiredWatches,
} from './alarm-notify-registry.mjs'

/**
 * @typedef {{
 *   sessionId: string,
 *   commandId: string,
 *   testRunId: string,
 *   reason: string,
 *   explicitWatch: boolean,
 *   subscriptionId?: string,
 *   authId?: string,
 * }} AlarmRecipient
 */

/**
 * Resolve who owns / can see a process-alarm point across sessionConfigs.
 *
 * @param {any} workspace
 * @param {{ pointId: string, connectionId: string }} target
 * @returns {{ kind: 'private' | 'shared' | 'ambiguous' | 'unknown', ownerSessionIds: string[] }}
 */
export function resolveAlarmEventOwnership(workspace, target) {
  const pointId = String(target.pointId || '')
  const connectionId = String(target.connectionId || '')
  const modbus = workspace?.modbus || {}
  const scMap = modbus.sessionConfigs && typeof modbus.sessionConfigs === 'object' ? modbus.sessionConfigs : {}
  const pointsShared = isCategoryShared(modbus.share, 'points')
  const connsShared = isCategoryShared(modbus.share, 'connections')
  /** @type {string[]} */
  const privateOwners = []
  /** @type {string[]} */
  const sharedOwners = []

  const topPoints = Array.isArray(modbus.points) ? modbus.points : []
  const topHit = pointId ? topPoints.some((/** @type {any} */ p) => p && p.id === pointId) : false
  const topConnHit = connectionId
    ? (Array.isArray(modbus.connections) ? modbus.connections : []).some((/** @type {any} */ c) => c && c.id === connectionId)
    : false

  for (const sid of Object.keys(scMap)) {
    const sc = scMap[sid]
    if (!sc || typeof sc !== 'object') continue
    const ownsPoint = pointId
      ? (Array.isArray(sc.points) ? sc.points : []).some((/** @type {any} */ p) => p && p.id === pointId)
      : false
    const ownsConn = connectionId
      ? (Array.isArray(sc.connections) ? sc.connections : []).some((/** @type {any} */ c) => c && c.id === connectionId)
      : false
    if (ownsPoint || (ownsConn && !connsShared)) privateOwners.push(sid)
    else if ((ownsPoint && pointsShared) || (ownsConn && connsShared)) sharedOwners.push(sid)
  }

  // Top-level hit with share on counts as shared visibility, not a private owner.
  if ((topHit && pointsShared) || (topConnHit && connsShared)) {
    return { kind: 'shared', ownerSessionIds: sharedOwners }
  }

  if (privateOwners.length > 1) {
    return { kind: 'ambiguous', ownerSessionIds: privateOwners }
  }
  if (privateOwners.length === 1) {
    return { kind: 'private', ownerSessionIds: privateOwners }
  }
  if (sharedOwners.length || topHit || topConnHit) {
    return { kind: 'shared', ownerSessionIds: sharedOwners }
  }
  return { kind: 'unknown', ownerSessionIds: [] }
}

/**
 * @param {any} workspace
 * @param {string} sessionId
 * @param {string} pointId
 * @param {string} connectionId
 * @returns {'yes' | 'no'}
 */
function sessionCanSeeTarget(workspace, sessionId, pointId, connectionId) {
  const sid = normalizeScopeSessionId(sessionId)
  if (!sid) return 'yes'
  const ownership = resolveAlarmEventOwnership(workspace, { pointId, connectionId })
  if (ownership.kind === 'shared') return 'yes'
  if (ownership.kind === 'private') return ownership.ownerSessionIds.includes(sid) ? 'yes' : 'no'
  if (ownership.kind === 'ambiguous') return ownership.ownerSessionIds.includes(sid) ? 'yes' : 'no'
  // unknown: allow only the source session matchers (watch already scoped)
  return 'yes'
}

/**
 * Collect every session that should receive this committed alarm transition.
 *
 * @param {string} home
 * @param {string} cwd
 * @param {any} item
 * @param {string} [sourceSessionId]
 * @returns {{
 *   recipients: AlarmRecipient[],
 *   ambiguousOwner: boolean,
 *   owners: string[],
 *   blockedReason?: string,
 * }}
 */
export function matchingAlarmRecipients(home, cwd, item, sourceSessionId) {
  pruneExpiredWatches(cwd)
  const ws = loadWorkspace(home, cwd)
  const point = item?.point
  const pointId = String(point?.id || item?.pointId || item?.alarm?.pointId || '')
  const connectionId = String(
    point?.connectionId || item?.connectionId || item?.alarm?.connectionId || '',
  )
  const source = normalizeScopeSessionId(sourceSessionId)
  const ownership = resolveAlarmEventOwnership(ws, { pointId, connectionId })

  if (ownership.kind === 'ambiguous' && !source) {
    return {
      recipients: [],
      ambiguousOwner: true,
      owners: ownership.ownerSessionIds,
      blockedReason: 'ambiguous-owner',
    }
  }
  if (ownership.kind === 'ambiguous' && source && !ownership.ownerSessionIds.includes(source)) {
    return {
      recipients: [],
      ambiguousOwner: true,
      owners: ownership.ownerSessionIds,
      blockedReason: 'ambiguous-owner',
    }
  }

  /** @type {Map<string, AlarmRecipient>} */
  const bySession = new Map()

  /**
   * @param {AlarmRecipient} rec
   */
  const offer = (rec) => {
    if (!rec.sessionId) return
    if (source) {
      // Explicit source: private/ambiguous events stay in that session only.
      // Shared points may still fan out to other seers.
      if (ownership.kind !== 'shared' && rec.sessionId !== source) return
      if (ownership.kind === 'shared' && sessionCanSeeTarget(ws, rec.sessionId, pointId, connectionId) !== 'yes') {
        return
      }
    } else if (sessionCanSeeTarget(ws, rec.sessionId, pointId, connectionId) !== 'yes') {
      return
    }
    if (ownership.kind === 'private' && !ownership.ownerSessionIds.includes(rec.sessionId)) {
      return
    }
    const prev = bySession.get(rec.sessionId)
    if (!prev) {
      bySession.set(rec.sessionId, rec)
      return
    }
    // Explicit watch wins; otherwise first reason sticks (one notify per session).
    if (rec.explicitWatch && !prev.explicitWatch) bySession.set(rec.sessionId, rec)
  }

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
    if (!pointOk || !connOk) continue
    offer({
      sessionId: watch.sessionId,
      commandId: '',
      testRunId: watch.testRunId,
      reason: 'agent-watch',
      explicitWatch: true,
      subscriptionId: watch.subscriptionId,
      authId: watch.subscriptionId,
    })
  }

  const focus = ws?.focus
  if (focus?.request?.by === 'agent') {
    const req = focus.request
    const focusSession = String(focus.sessionId || ws.session?.boundId || '')
    const related =
      (req.alarmId && (req.alarmId === pointId || req.alarmId === item?.alarm?.id)) ||
      (req.pointId && req.pointId === pointId) ||
      (req.connectionId && req.connectionId === connectionId && req.kind === 'alarm')
    if (related) {
      offer({
        sessionId: focusSession,
        commandId: '',
        testRunId: '',
        reason: 'agent-focus',
        explicitWatch: false,
        authId: `focus:${req.alarmId || req.pointId || req.connectionId || ''}`,
      })
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
    offer({
      sessionId,
      commandId: entry.id || params.commandId || '',
      testRunId: '',
      reason: 'pending-write',
      explicitWatch: false,
      authId: entry.id || params.commandId || '',
    })
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
    offer({
      sessionId: sessionId || boundId,
      commandId: task.id || '',
      testRunId: '',
      reason: 'pending-agent-task',
      explicitWatch: false,
      authId: task.id || '',
    })
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
    offer({
      sessionId: sessionId || boundId,
      commandId: req.id || '',
      testRunId: '',
      reason: 'pending-manual',
      explicitWatch: false,
      authId: req.id || '',
    })
  }

  // With a known private source, only that session and shared-seers remain.
  if (source && ownership.kind === 'private') {
    for (const sid of [...bySession.keys()]) {
      if (sid !== source && sessionCanSeeTarget(ws, sid, pointId, connectionId) !== 'yes') {
        bySession.delete(sid)
      }
    }
  }

  return {
    recipients: [...bySession.values()],
    ambiguousOwner: false,
    owners: ownership.ownerSessionIds,
  }
}

/**
 * Shrink to the per-recipient live check. Used by emit + retry.
 *
 * @param {string} home
 * @param {string} cwd
 * @param {any} item
 * @param {AlarmRecipient} recipient
 * @param {(home: string, cwd: string, item: any, sessionId?: string) => any} recheckAlarmCurrent
 * @returns {boolean}
 */
export function recipientStillLive(home, cwd, item, recipient, recheckAlarmCurrent) {
  const live = recheckAlarmCurrent(home, cwd, item, recipient.sessionId)
  return !!(live && live.current)
}

/**
 * Re-validate the ORIGINAL authorization reason. A retry must not silently
 * switch to another reason for the same session after the old watch/command dies.
 *
 * @param {string} home
 * @param {string} cwd
 * @param {any} item
 * @param {AlarmRecipient} recipient
 * @returns {boolean}
 */
export function recipientStillAuthorized(home, cwd, item, recipient) {
  if (!recipient?.sessionId) return false
  const workspace = loadWorkspace(home, cwd)
  const pointId = String(item?.point?.id || item?.pointId || item?.alarm?.pointId || '')
  const connectionId = String(
    item?.point?.connectionId || item?.connectionId || item?.alarm?.connectionId || '',
  )

  if (recipient.reason === 'agent-watch') {
    const watch = getAgentAlarmWatch(cwd, recipient.sessionId)
    if (!watch || !watch.followup) return false
    if (Number(watch.expiresAt) > 0 && Number(watch.expiresAt) <= clockNow()) return false
    if (recipient.subscriptionId && watch.subscriptionId !== recipient.subscriptionId) return false
    const pointOk = !watch.pointIds.size || watch.pointIds.has(pointId)
    const connOk = !watch.connectionId || watch.connectionId === connectionId
    return pointOk && connOk
  }

  if (recipient.reason === 'agent-focus') {
    const req = workspace?.focus?.request
    if (!req || req.by !== 'agent') return false
    return !!(
      (req.alarmId && (req.alarmId === pointId || req.alarmId === item?.alarm?.id)) ||
      (req.pointId && req.pointId === pointId) ||
      (req.connectionId && req.connectionId === connectionId && req.kind === 'alarm')
    )
  }

  if (
    recipient.reason === 'pending-write' ||
    recipient.reason === 'pending-agent-task' ||
    recipient.reason === 'pending-manual'
  ) {
    const authId = String(recipient.authId || recipient.commandId || '')
    if (!authId) return false
    if (recipient.reason === 'pending-write') {
      return (
        pendingWrites.has(authId) ||
        [...pendingWrites.values()].some((e) => (e.id || e.params?.commandId) === authId)
      )
    }
    if (recipient.reason === 'pending-agent-task') {
      return runningTasks(workspace?.tasks).some((/** @type {any} */ t) => t.id === authId)
    }
    return (workspace?.manualRequests || []).some((/** @type {any} */ r) => r.id === authId)
  }

  return false
}

export const _internal = {
  resolveAlarmEventOwnership,
  sessionCanSeeTarget,
  normalizeModbus,
  modbusForSession,
  isScopePartitioned,
}
