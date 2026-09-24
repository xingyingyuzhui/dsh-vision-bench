// @ts-check
import { connectOp, modbusRead, modbusWrite } from '../../modbus/index.mjs'
import { buildEvidenceRefs } from '../../modbus/index.mjs'
import { createManualRequest } from '../../../infrastructure/store/journal-store.mjs'
import { agentLocatorError } from '../agent-locator-error.mjs'
import { resolveTarget } from '../../../domain/modbus/target-resolver-service.mjs'
import { ensureWorkspaceClaimed, loadSessionViewForRead, modbusForSession } from '../../modbus/workspace-session-view.mjs'
import {
  alarmVisibleToSession,
  filterAlarmStateForSession,
} from '../../modbus/agent-runtime-visibility.mjs'
import {
  cancelAlarmNotifyRetries,
  clearAgentAlarmWatch,
  getAgentAlarmWatch,
  revokeAgentAlarmSubscription,
  setAgentAlarmWatch,
} from '../../modbus/poll-alarm-notify.mjs'
import { handleTrendCommand } from './live-trend-query.mjs'

/** @param {any} args */
function connectionIdOf(args) {
  return typeof args.connectionId === 'string'
    ? args.connectionId
    : typeof args.connId === 'string'
      ? args.connId
      : undefined
}

/**
 * @param {any} home
 * @param {any} args
 * @param {any} room
 * @param {any} origin
 * @param {any} opts
 * @returns {Promise<object | null>}
 */
export async function handleLiveCommand(home, args, room, origin, opts) {
  const action = args?.action
  const signal = opts?.signal
  const cid = connectionIdOf(args)
  const did = typeof args.deviceId === 'string' ? args.deviceId : undefined

  if (action === 'write') {
    const fn = Number(args.function)
    const values = Array.isArray(args.values) ? args.values : args.value !== undefined ? [args.value] : undefined
    const ran = await modbusWrite(
      home,
      room.cwd,
      {
        source: origin.source,
        sessionId: origin.sessionId,
        connectionId: cid,
        connId: cid,
        deviceId: did,
        function: fn,
        address: args.address,
        values,
        pointId: typeof args.pointId === 'string' ? args.pointId : undefined,
      },
      { signal, sessionId: origin.sessionId },
    )
    return { action, ...ran }
  }

  if (action === 'manual') {
    const text = typeof args.text === 'string' ? args.text.trim() : ''
    if (!text) return { ok: false, action, error: 'text 必填：描述需要用户完成的现场操作' }
    const ran = await createManualRequest(home, room.cwd, {
      text,
      sessionId: origin.sessionId,
      source: origin.source,
    })
    if (!ran.ok) return { ok: false, action, error: ran.error }
    return {
      ok: true,
      action,
      requestId: ran.request.id,
      note: '已创建人工操作请求，等待用户在界面上完成；完成后会以通知回到本会话',
    }
  }

  if (action === 'openConnection' || action === 'closeConnection') {
    const ran = await connectOp(
      home,
      room.cwd,
      {
        connectionId: cid,
        connId: cid,
        deviceId: args.deviceId,
        open: action === 'openConnection',
        close: action === 'closeConnection',
        sessionId: origin.sessionId,
      },
      { ...opts, sessionId: origin.sessionId },
    )
    return { action, ...ran }
  }

  if (action === 'connect') {
    const patchKeys = [
      'mode',
      'port',
      'baudrate',
      'bytesize',
      'parity',
      'stopbits',
      'host',
      'tcpPort',
      'sim',
      'slave',
      'unitId',
    ]
    const hasConfig = patchKeys.some((key) => args[key] !== undefined)
    if (hasConfig && args.close !== true) {
      return {
        ok: false,
        action,
        errorCode: 'USE_CONFIGURE_CONNECTION',
        error: '修改连接配置请用 configureConnection，打开请用 openConnection',
      }
    }
    const ran = await connectOp(
      home,
      room.cwd,
      {
        connectionId: cid,
        connId: cid,
        deviceId: did,
        open: args.close !== true,
        close: args.close === true,
        sessionId: origin.sessionId,
      },
      { ...opts, sessionId: origin.sessionId },
    )
    return { action, ...ran }
  }

  if (action === 'trend') {
    return handleTrendCommand(home, args, room, origin, cid || '')
  }

  if (action === 'alarm') {
    // Unsubscribe is session-local and must not require resolveTarget / alarm list.
    if (origin.source === 'agent' && (args.watch === false || args.followup === false)) {
      if (args.watch !== undefined && args.followup !== undefined && Boolean(args.watch) !== Boolean(args.followup)) {
        return {
          ok: false,
          action,
          errorCode: 'FIELD_CONFLICT',
          error: 'watch 与 followup 语义不一致',
        }
      }
      const sid = String(origin.sessionId || '')
      if (!sid) {
        return {
          ok: false,
          action,
          errorCode: 'SESSION_REQUIRED',
          error: '退订必须携带非空 sessionId',
        }
      }
      // Revoke identity first, then cancel tasks bound to that subscription.
      const prev = revokeAgentAlarmSubscription(room.cwd, sid)
      cancelAlarmNotifyRetries({
        sessionId: sid,
        cwd: room.cwd,
        subscriptionId: prev?.subscriptionId,
      })
      return {
        ok: true,
        action,
        subscription: {
          cleared: true,
          sessionId: sid,
          subscriptionId: prev?.subscriptionId,
        },
      }
    }
    if (args.watch !== undefined && args.followup !== undefined && Boolean(args.watch) !== Boolean(args.followup)) {
      return {
        ok: false,
        action,
        errorCode: 'FIELD_CONFLICT',
        error: 'watch 与 followup 语义不一致',
      }
    }
    /** @type {any} */
    let workspace
    /** @type {any} */
    let pack
    if (origin.source === 'agent') {
      const view = loadSessionViewForRead(home, room.cwd, origin.sessionId)
      workspace = view.workspace
      pack = view.pack
    } else {
      workspace = await ensureWorkspaceClaimed(home, room.cwd, origin.sessionId)
      pack = modbusForSession(workspace, origin.sessionId)
    }
    const connectionId = cid || ''
    const deviceId = did || ''
    const pointId = typeof args.pointId === 'string' ? args.pointId : ''
    const alarmId = typeof args.alarmId === 'string' ? args.alarmId : ''
    let resolvedConnectionId = connectionId
    if (alarmId || connectionId || deviceId || pointId) {
      const rt = resolveTarget(pack, {
        connectionId: connectionId || undefined,
        deviceId,
        pointId,
        alarmId,
      })
      if (!rt.ok) return agentLocatorError(action, rt, connectionId)
      if (rt.connectionId) resolvedConnectionId = rt.connectionId
    }
    if (alarmId) {
      const hit =
        pack.alarmState?.[alarmId] ||
        Object.values(pack.alarmState || {}).find(
          (/** @type {any} */ a) => a && (a.id === alarmId || a.pointId === alarmId),
        )
      if (!hit) {
        return { ok: false, action, error: `告警不存在: ${alarmId}`, errorCode: 'POINT_NOT_FOUND' }
      }
      if (
        origin.source === 'agent' &&
        !alarmVisibleToSession(workspace.modbus, origin.sessionId, pack, alarmId, hit)
      ) {
        return { ok: false, action, error: `告警不可见: ${alarmId}`, errorCode: 'POINT_NOT_FOUND' }
      }
    }
    /** @type {any} */
    let subscription = undefined
    // Explicit Agent opt-in to receive process-alarm followups for this session+cwd.
    if (origin.source === 'agent') {
      if (args.watch === true || args.followup === true) {
        const sid = String(origin.sessionId || '')
        // Target change mints a new subscriptionId — drop tasks bound to the old one.
        const prev = sid ? getAgentAlarmWatch(room.cwd, sid) : null
        subscription = setAgentAlarmWatch(room.cwd, {
          followup: true,
          sessionId: origin.sessionId,
          pointIds: pointId ? [pointId] : alarmId ? [alarmId] : [],
          connectionId: resolvedConnectionId,
          ttlMs: Number(args.ttlMs) > 0 ? Number(args.ttlMs) : undefined,
        })
        if (prev?.subscriptionId && subscription?.subscriptionId !== prev.subscriptionId) {
          cancelAlarmNotifyRetries({
            sessionId: sid,
            cwd: room.cwd,
            subscriptionId: prev.subscriptionId,
          })
        }
      }
    }
    /** @type {any} */
    let alarmsOut = pack.alarmState
    if (origin.source === 'agent') {
      alarmsOut = filterAlarmStateForSession(workspace.modbus, origin.sessionId, pack, pack.alarmState)
    }
    if (alarmId && alarmsOut && typeof alarmsOut === 'object') {
      alarmsOut = alarmsOut[alarmId] != null ? { [alarmId]: alarmsOut[alarmId] } : {}
    }
    return {
      ok: true,
      action,
      alarms: alarmsOut,
      connectionId: resolvedConnectionId || pack.activeConnectionId,
      configVersion: pack.configVersion || 1,
      evidence: buildEvidenceRefs(home, room.cwd),
      subscription,
    }
  }

  if (action === 'read') {
    const table = args.pointId == null && args.address == null && args.function == null
    const ran = await modbusRead(
      home,
      room.cwd,
      {
        source: origin.source,
        sessionId: origin.sessionId,
        connectionId: cid,
        connId: cid,
        deviceId: did,
        all: table,
        pointId: args.pointId,
        function: args.function,
        address: args.address,
        count: args.count,
      },
      { signal, sessionId: origin.sessionId },
    )
    return { action, ...ran }
  }

  return null
}
