// @ts-check
import { resolveTarget } from '../../../domain/modbus/target-resolver-service.mjs'
import { agentLocatorError } from '../agent-locator-error.mjs'
import {
  AGENT_TREND_DEFAULT_LIMIT,
  TREND_KEEP,
  readTrendSeries,
  readTrendSeriesFromPack,
} from '../../modbus/trend-store.mjs'
import { ensureWorkspaceClaimed, loadSessionViewForRead, modbusForSession } from '../../modbus/workspace-session-view.mjs'
import { buildAgentTrendSeries, scopeTrendSeriesForSession } from '../../modbus/agent-runtime-visibility.mjs'

/**
 * @param {any} home
 * @param {any} args
 * @param {any} room
 * @param {any} origin
 * @param {string} connectionId
 * @returns {Promise<object>}
 */
export async function handleTrendCommand(home, args, room, origin, connectionId) {
  const action = 'trend'
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
  const start =
    args.start != null && Number.isFinite(Number(args.start))
      ? Number(args.start)
      : Date.now() - 5 * 60 * 1000
  const end = args.end != null && Number.isFinite(Number(args.end)) ? Number(args.end) : Date.now()
  const rawLimit = Number(args.limit)
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.trunc(rawLimit)
      : origin.source === 'agent'
        ? AGENT_TREND_DEFAULT_LIMIT
        : TREND_KEEP

  if (trendKey) {
    const rt = resolveTarget(pack, {
      connectionId: connectionId || undefined,
      deviceId: args.deviceId,
      pointId: pointIds[0],
      trendKey,
    })
    if (!rt.ok) return agentLocatorError(action, rt, connectionId)
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
  } else if (pointIds.length && origin.source === 'agent') {
    const series = buildAgentTrendSeries({
      layeredModbus: workspace.modbus,
      sessionId: origin.sessionId,
      pack,
      pointIds: pointIds.map(String),
      resolveOne: (pid) =>
        resolveTarget(pack, {
          connectionId: connectionId || pack.activeConnectionId,
          deviceId: args.deviceId,
          pointId: pid,
        }),
      readSeries: (resolvedIds) =>
        readTrendSeriesFromPack(pack, {
          pointIds: resolvedIds,
          start,
          end,
          limit,
          sharedTrend: readTrendSeries(home, room.cwd, { pointIds: resolvedIds, start, end, limit }),
        }),
    })
    return packTrendResult(action, pack, resolvedConnectionId, resolvedDeviceId, start, end, limit, series)
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
  const scopeIds = trendKey
    ? [resolvedPointId]
    : pointIds.length
      ? pointIds
      : pack.points
          .filter((/** @type {any} */ p) => !resolvedConnectionId || p.connectionId === resolvedConnectionId)
          .filter((/** @type {any} */ p) => p.trendEnabled === true || p.monitorEnabled === true)
          .slice(0, 8)
          .map((/** @type {any} */ p) => p.id)
  const seriesRaw = readTrendSeriesFromPack(pack, {
    pointIds: scopeIds,
    start,
    end,
    limit,
    sharedTrend: readTrendSeries(home, room.cwd, { pointIds: scopeIds, start, end, limit }),
  })
  const series =
    origin.source === 'agent'
      ? scopeTrendSeriesForSession(workspace.modbus, origin.sessionId, seriesRaw, pack.points)
      : seriesRaw
  return packTrendResult(action, pack, resolvedConnectionId, resolvedDeviceId, start, end, limit, series)
}

/**
 * @param {string} action
 * @param {any} pack
 * @param {string} resolvedConnectionId
 * @param {string} resolvedDeviceId
 * @param {number} start
 * @param {number} end
 * @param {number} limit
 * @param {any[]} series
 */
function packTrendResult(action, pack, resolvedConnectionId, resolvedDeviceId, start, end, limit, series) {
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
