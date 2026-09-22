// @ts-check
/**
 * Shared authorization checks for first delivery and retries.
 * Do not fork watch/focus/command rules between emit and retry.
 */
import { runningTasks } from '../../domain/modbus/journal-model.mjs'
import { normalizeScopeSessionId } from '../../domain/modbus/config-scope.mjs'
import { loadWorkspace } from '../../infrastructure/store/workspace-store.mjs'
import { pendingWrites } from './modbus-runtime-context.mjs'
import { clockNow, getAgentAlarmWatch } from './alarm-notify-registry.mjs'

/**
 * Focus session: explicit focus.sessionId wins; boundId is fallback only.
 * @param {any} workspace
 * @returns {string}
 */
export function focusRecipientSession(workspace) {
  const explicit = normalizeScopeSessionId(workspace?.focus?.sessionId)
  if (explicit) return explicit
  return normalizeScopeSessionId(workspace?.session?.boundId)
}

/**
 * @param {any} request
 * @param {any} item
 * @returns {boolean}
 */
export function focusMatchesAlarm(request, item) {
  if (!request) return false
  const pointId = String(item?.point?.id || item?.pointId || item?.alarm?.pointId || '')
  const connectionId = String(
    item?.point?.connectionId || item?.connectionId || item?.alarm?.connectionId || '',
  )
  return !!(
    (request.alarmId && (request.alarmId === pointId || request.alarmId === item?.alarm?.id)) ||
    (request.pointId && request.pointId === pointId) ||
    (request.connectionId && request.connectionId === connectionId && request.kind === 'alarm')
  )
}

/**
 * Stable focus authorization id: same session + same normalized request fields.
 * New at/version ⇒ new identity. Never Date.now() or random here.
 * @param {any} focus
 * @param {string} resolvedSessionId
 * @returns {string}
 */
export function focusAuthorizationId(focus, resolvedSessionId) {
  const req = focus?.request || {}
  return JSON.stringify([
    String(resolvedSessionId || ''),
    Number(req.at) || 0,
    String(req.version ?? ''),
    String(req.kind || ''),
    String(req.connectionId || ''),
    String(req.deviceId || ''),
    String(req.pointId || ''),
    String(req.alarmId || ''),
    String(req.frameId || ''),
    String(req.trendKey || ''),
  ])
}

/**
 * @param {string} home
 * @param {string} cwd
 * @param {any} item
 * @param {{ sessionId: string, reason: string, subscriptionId?: string, authId?: string, commandId?: string }} recipient
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
    const focus = workspace?.focus
    const req = focus?.request
    if (!req || req.by !== 'agent') return false
    const sid = focusRecipientSession(workspace)
    if (sid !== recipient.sessionId) return false
    if (!focusMatchesAlarm(req, item)) return false
    const authId = focusAuthorizationId(focus, sid)
    return !recipient.authId || recipient.authId === authId
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
