// @ts-check
import { connectOp, modbusRead, modbusWrite } from '../../modbus/index.mjs'
import { buildEvidenceRefs } from '../../modbus/index.mjs'
import { createManualRequest } from '../../../infrastructure/store/journal-store.mjs'
import { resolveTarget } from '../../modbus/target-resolver-service.mjs'
import {
  AGENT_TREND_DEFAULT_LIMIT,
  TREND_KEEP,
  readTrendSeries,
  readTrendSeriesFromPack,
} from '../../modbus/trend-store.mjs'
import { ensureWorkspaceClaimed, modbusForSession } from '../../modbus/workspace-session-view.mjs'
import {
  cancelAlarmNotifyRetries,
  clearAgentAlarmWatch,
  setAgentAlarmWatch,
} from '../../modbus/poll-alarm-notify.mjs'

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
    const workspace = await ensureWorkspaceClaimed(home, room.cwd, origin.sessionId)
    const pack = modbusForSession(workspace, origin.sessionId)
    const connectionId = cid || ''
    const pointIds = Array.isArray(args.pointIds)
      ? args.pointIds
      : typeof args.pointId === 'string'
        ? [args.pointId]
        : []
    const trendKey = typeof args.trendKey === 'string' ? args.trendKey : ''
    if (!connectionId && !trendKey && pack.connections.length > 1) {
      return { ok: false, action, error: '缺少 connectionId', errorCode: 'TARGET_REQUIRED' }
    }
    /** @type {string} */
    let resolvedPointId = ''
    /** @type {string} */
    let resolvedConnectionId = connectionId
    /** @type {string} */
    let resolvedDeviceId = typeof args.deviceId === 'string' ? args.deviceId : ''
    if (trendKey) {
      const rt = resolveTarget(pack, {
        connectionId: connectionId || undefined,
        deviceId: args.deviceId,
        pointId: pointIds[0],
        trendKey,
      })
      if (!rt.ok) return { ok: false, action, error: rt.error, errorCode: rt.errorCode }
      resolvedPointId = rt.pointId
      resolvedConnectionId = rt.connectionId || connectionId
      resolvedDeviceId = rt.deviceId || resolvedDeviceId
      if (pointIds.length && !pointIds.includes(resolvedPointId)) {
        return {
          ok: false,
          action,
          error: 'trendKey 与 pointIds 不一致',
          errorCode: 'TARGET_MISMATCH',
        }
      }
    } else if (pointIds.length) {
      for (const pid of pointIds) {
        const rt = resolveTarget(pack, {
          connectionId: connectionId || pack.activeConnectionId,
          deviceId: args.deviceId,
          pointId: pid,
        })
        if (!rt.ok) return { ok: false, action, error: rt.error, errorCode: rt.errorCode }
      }
    } else if (connectionId) {
      const rt = resolveTarget(pack, { connectionId })
      if (!rt.ok) return { ok: false, action, error: rt.error, errorCode: rt.errorCode }
    }
    const start = Number(args.start) || Date.now() - 5 * 60 * 1000
    const end = Number(args.end) || Date.now()
    const scopeIds = trendKey
      ? [resolvedPointId]
      : pointIds.length
        ? pointIds
        : pack.points
            .filter((/** @type {any} */ p) => !resolvedConnectionId || p.connectionId === resolvedConnectionId)
            .filter((/** @type {any} */ p) => p.trendEnabled === true || p.monitorEnabled === true)
            .slice(0, 8)
            .map((/** @type {any} */ p) => p.id)
    const rawLimit = Number(args.limit)
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.trunc(rawLimit)
        : origin.source === 'agent'
          ? AGENT_TREND_DEFAULT_LIMIT
          : TREND_KEEP
    // Metadata (name/unit/connection/device) comes from the SESSION pack.
    const series = readTrendSeriesFromPack(pack, {
      pointIds: scopeIds,
      start,
      end,
      limit,
      sharedTrend: readTrendSeries(home, room.cwd, { pointIds: scopeIds, start, end, limit }),
    })
    const total = series.reduce((/** @type {number} */ n, /** @type {any} */ s) => n + (Number(s.count) || 0), 0)
    const returned = series.reduce(
      (/** @type {number} */ n, /** @type {any} */ s) => n + (Number(s.returned) || (s.samples || []).length),
      0,
    )
    return {
      ok: true,
      action,
      trend: {
        connectionId: resolvedConnectionId || pack.activeConnectionId,
        deviceId: resolvedDeviceId,
        pointIds: series.map((/** @type {any} */ sv) => sv.pointId),
        start,
        end,
        configVersion: pack.configVersion || 1,
        limit,
        total,
        returned,
        series,
      },
    }
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
      clearAgentAlarmWatch(room.cwd, origin.sessionId)
      cancelAlarmNotifyRetries({ sessionId: origin.sessionId || undefined, cwd: room.cwd })
      return {
        ok: true,
        action,
        subscription: { cleared: true, sessionId: origin.sessionId || '' },
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
    const workspace = await ensureWorkspaceClaimed(home, room.cwd, origin.sessionId)
    const pack = modbusForSession(workspace, origin.sessionId)
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
      if (!rt.ok) return { ok: false, action, error: rt.error, errorCode: rt.errorCode }
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
    }
    /** @type {any} */
    let subscription = undefined
    // Explicit Agent opt-in to receive process-alarm followups for this session+cwd.
    if (origin.source === 'agent') {
      if (args.watch === true || args.followup === true) {
        subscription = setAgentAlarmWatch(room.cwd, {
          followup: true,
          sessionId: origin.sessionId,
          pointIds: pointId ? [pointId] : alarmId ? [alarmId] : [],
          connectionId: resolvedConnectionId,
          ttlMs: Number(args.ttlMs) > 0 ? Number(args.ttlMs) : undefined,
        })
      }
    }
    /** @type {any} */
    let alarmsOut = pack.alarmState
    if (alarmId && pack.alarmState && typeof pack.alarmState === 'object') {
      alarmsOut = pack.alarmState[alarmId] != null ? { [alarmId]: pack.alarmState[alarmId] } : {}
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
