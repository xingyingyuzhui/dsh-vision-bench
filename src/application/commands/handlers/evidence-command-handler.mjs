// @ts-check
import { buildEvidenceRefs, listFrames, requestFocus } from '../../../../bench-modbus-forward.mjs'
import { appendEvidence } from '../../../../bench-store.mjs'
import { ensureWorkspaceClaimed, modbusForSession } from '../../modbus/workspace-session-view.mjs'

/**
 * @param {any} home
 * @param {any} args
 * @param {any} room
 * @param {any} origin
 * @param {any} _opts
 * @returns {Promise<object | null>}
 */
export async function handleEvidenceCommand(home, args, room, origin, _opts) {
  const action = args?.action

  if (action === 'frames') {
    const cid =
      typeof args.connectionId === 'string'
        ? args.connectionId
        : typeof args.connId === 'string'
          ? args.connId
          : undefined
    const did = typeof args.deviceId === 'string' ? args.deviceId : undefined
    const fid = typeof args.frameId === 'string' ? args.frameId : typeof args.id === 'string' ? args.id : undefined
    const ran = listFrames(home, room.cwd, {
      source: origin.source,
      sessionId: origin.sessionId,
      connectionId: cid,
      connId: cid,
      deviceId: did,
      frameId: fid,
      limit: args.limit,
      offset: args.offset,
    })
    return { action, ...ran }
  }

  if (action === 'focus') {
    const target = args.target ||
      args.focus || {
        connectionId: args.connectionId || args.connId,
        deviceId: args.deviceId,
        pointId: args.pointId,
        frameId: args.frameId,
        trendKey: args.trendKey,
        alarmId: args.alarmId,
        visualizationId: args.visualizationId,
        kind: args.kind,
      }
    const ran = await requestFocus(home, room.cwd, {
      source: origin.source,
      sessionId: origin.sessionId,
      target,
      tempWatchIds: args.tempWatchIds || args.tempWatch,
      evidence: args.evidence,
      badgeOnly: args.badgeOnly,
      foreground: args.foreground,
    })
    return { action, ...ran }
  }

  if (action === 'evidence') {
    const evidence = buildEvidenceRefs(home, room.cwd)
    const workspace = await ensureWorkspaceClaimed(home, room.cwd, origin.sessionId)
    const pack = modbusForSession(workspace, origin.sessionId)
    if (Array.isArray(args.evidence) && args.evidence.length) {
      const appended = await appendEvidence(home, room.cwd, args.evidence, origin.sessionId)
      if (!appended.ok) return { ok: false, action, error: appended.error, errorCode: appended.errorCode }
    }
    return { ok: true, action, evidence, configVersion: pack.configVersion || 1 }
  }

  return null
}
