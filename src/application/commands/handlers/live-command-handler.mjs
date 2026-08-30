// @ts-check
import { normalizeModbus } from '../../../../bench-devices.mjs'
import { connectOp, modbusRead, modbusWrite } from '../../../../bench-modbus-forward.mjs'
import { buildEvidenceRefs } from '../../../../bench-modbus-forward.mjs'
import { createManualRequest, loadWorkspace } from '../../../../bench-store.mjs'
import { resolveTarget } from '../../../../bench-targets.mjs'
import { readTrendSeries } from '../../../../bench-trend-store.mjs'

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
      { signal },
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
      },
      opts,
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
      },
      opts,
    )
    return { action, ...ran }
  }

  if (action === 'trend') {
    const pack = normalizeModbus(loadWorkspace(home, room.cwd).modbus)
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
    if (trendKey) {
      const rt = resolveTarget(pack, { connectionId, deviceId: args.deviceId, pointId: pointIds[0], trendKey })
      if (!rt.ok) return { ok: false, action, error: rt.error, errorCode: rt.errorCode }
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
    const scopeIds = pointIds.length
      ? pointIds
      : pack.points
          .filter((/** @type {any} */ p) => !connectionId || p.connectionId === connectionId)
          .filter((/** @type {any} */ p) => p.trendEnabled === true)
          .slice(0, 8)
          .map((/** @type {any} */ p) => p.id)
    const series = readTrendSeries(home, room.cwd, { pointIds: scopeIds, start, end })
    return {
      ok: true,
      action,
      trend: {
        connectionId: connectionId || pack.activeConnectionId,
        pointIds: series.map((/** @type {any} */ sv) => sv.pointId),
        start,
        end,
        configVersion: pack.configVersion || 1,
        series,
      },
    }
  }

  if (action === 'alarm') {
    const pack = normalizeModbus(loadWorkspace(home, room.cwd).modbus)
    const connectionId = cid || ''
    const deviceId = did || ''
    const pointId = typeof args.pointId === 'string' ? args.pointId : ''
    const alarmId = typeof args.alarmId === 'string' ? args.alarmId : ''
    if (alarmId || connectionId || deviceId || pointId) {
      const rt = resolveTarget(pack, {
        connectionId: connectionId || (alarmId ? undefined : pack.activeConnectionId),
        deviceId,
        pointId,
        alarmId,
      })
      if (!rt.ok) return { ok: false, action, error: rt.error, errorCode: rt.errorCode }
    } else if (alarmId && !pack.alarmState[alarmId]) {
      return { ok: false, action, error: `告警不存在: ${alarmId}`, errorCode: 'POINT_NOT_FOUND' }
    }
    return {
      ok: true,
      action,
      alarms: pack.alarmState,
      connectionId: connectionId || pack.activeConnectionId,
      configVersion: pack.configVersion || 1,
      evidence: buildEvidenceRefs(home, room.cwd),
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
      { signal },
    )
    return { action, ...ran }
  }

  return null
}
