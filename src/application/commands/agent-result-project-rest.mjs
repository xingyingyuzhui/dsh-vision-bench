// @ts-check
import { AGENT_FRAMES_MAX_LIMIT, AGENT_TEXT_CAPS } from './agent-result-caps.mjs'
import { enforceBudget, pickSafetyFields } from './agent-result-project-status-read.mjs'

const ALARM_PAGE_DEFAULT = 40

/**
 * @param {any} result
 */
/**
 * @param {any} result
 */
export function projectConfig(result) {
  const projected = {
    ...pickSafetyFields(result),
    previousConfigVersion: result.previousConfigVersion,
    nextConfigVersion: result.nextConfigVersion,
    configVersion: result.configVersion,
    changedIds: result.changedIds,
    changedPointIds: result.changedPointIds,
    changedVisualizationIds: result.changedVisualizationIds,
    affectedVisualizations: result.affectedVisualizations,
    affectedAlarms: result.affectedAlarms,
    postCommitWarnings: result.postCommitWarnings,
    layout: result.layout,
    summary: result.summary,
    connectionId: result.connectionId,
    deviceId: result.deviceId,
    published: result.published,
    revoked: result.revoked,
  }
  return enforceBudget(
    projected,
    AGENT_TEXT_CAPS.threePointConfigCommitBytes,
    'config 超预算：用 points list / visualization get 分项读取',
    (p) => ({
      ...p,
      postCommitWarnings: (p.postCommitWarnings || []).slice(0, 3),
      affectedVisualizations: (p.affectedVisualizations || []).slice(0, 8),
      affectedAlarms: (p.affectedAlarms || []).slice(0, 8),
    }),
  )
}

/**
 * @param {any} args
 * @param {any} result
 */
export function projectFrames(args, result) {
  /** @type {any[]} */
  const allFrames = Array.isArray(result.frames) ? result.frames : []
  const total = Number.isFinite(Number(result.total)) ? Number(result.total) : allFrames.length
  const requested = Number(args?.limit)
  const limit = Math.max(
    1,
    Math.min(
      AGENT_FRAMES_MAX_LIMIT,
      Number.isFinite(requested) && requested > 0 ? Math.trunc(requested) : allFrames.length || 50,
    ),
  )
  const offset = Math.max(0, Number(args?.offset) || 0)
  const frames = allFrames.slice(0, limit)
  const returned = frames.length
  const nextOffset = offset + returned
  const nextCursor = nextOffset < total ? String(nextOffset) : null
  const projected = {
    ...pickSafetyFields(result),
    frames,
    total,
    returned,
    nextCursor,
    limit,
    connectionId: result.connectionId,
    deviceId: result.deviceId,
    configVersion: result.configVersion,
    frame: result.frame,
    stale: result.stale,
    warning: result.warning,
    truncated: nextCursor != null || allFrames.length > limit || undefined,
  }
  return enforceBudget(projected, AGENT_TEXT_CAPS.framesBytes, 'frames 超预算：减小 limit 或用 frameId 单查', (p) => ({
    ...p,
    frames: (p.frames || []).slice(0, 10),
    truncated: true,
    nextCursor: p.nextCursor || '10',
  }))
}

/**
 * @param {any} args
 * @param {any} result
 */
export function projectTrend(args, result) {
  const trend = result.trend && typeof result.trend === 'object' ? { ...result.trend } : {}
  /** @type {any[]} */
  const series = Array.isArray(trend.series) ? trend.series : []
  let total = 0
  let returned = 0
  const projectedSeries = series.map((/** @type {any} */ s) => {
    const count = Number(s?.count) || (Array.isArray(s?.samples) ? s.samples.length : 0)
    const samples = Array.isArray(s?.samples) ? s.samples : []
    total += count
    returned += samples.length
    return {
      pointId: s.pointId,
      name: s.name,
      connectionId: s.connectionId,
      deviceId: s.deviceId,
      unit: s.unit,
      count,
      returned: samples.length,
      samples,
    }
  })
  const limit = Number(args?.limit)
  const nextCursor =
    Number.isFinite(limit) && limit > 0 && projectedSeries.some((/** @type {any} */ s) => s.count > s.returned)
      ? 'older'
      : null
  const projected = {
    ...pickSafetyFields(result),
    trend: {
      ...trend,
      series: projectedSeries,
      total,
      returned,
      nextCursor,
      limit: Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : undefined,
    },
  }
  return enforceBudget(projected, AGENT_TEXT_CAPS.trendBytes, 'trend 超预算：减小 limit 或缩小 pointIds', (p) => ({
    ...p,
    trend: {
      ...p.trend,
      series: (p.trend?.series || []).map((/** @type {any} */ s) => ({
        ...s,
        samples: (s.samples || []).slice(0, 5),
        returned: Math.min(5, (s.samples || []).length),
      })),
      nextCursor: p.trend?.nextCursor || 'older',
    },
    truncated: true,
  }))
}

/**
 * @param {string} id
 * @param {any} row
 */
function projectAlarmRow(id, row) {
  const alarm = row && typeof row === 'object' ? row : {}
  const current = alarm.current ?? alarm.value ?? alarm.raw
  const trigger = alarm.trigger ?? alarm.triggerValue ?? alarm.threshold
  return {
    id,
    condition: alarm.condition,
    group: alarm.group,
    pointId: alarm.pointId || id,
    connectionId: alarm.connectionId,
    deviceId: alarm.deviceId,
    current,
    value: current,
    trigger,
    threshold: trigger,
    severity: alarm.severity,
    quality: alarm.quality,
    status: alarm.status,
    firstAt: alarm.firstAt,
    lastAt: alarm.lastAt,
    occurredAt: alarm.occurredAt || alarm.at || alarm.firedAt || alarm.eventAt || alarm.firstAt,
    clearedAt: alarm.clearedAt || alarm.recoveredAt,
    recoveredAt: alarm.recoveredAt,
    frameId: alarm.frameId || '',
    transactionId: alarm.transactionId || '',
    kind: alarm.kind,
  }
}

/**
 * @param {any} args
 * @param {any} result
 */
export function projectAlarm(args, result) {
  const alarms = result.alarms && typeof result.alarms === 'object' ? result.alarms : {}
  const alarmId = typeof args?.alarmId === 'string' ? args.alarmId.trim() : ''
  const pageLimit = Math.max(1, Math.min(ALARM_PAGE_DEFAULT, Number(args?.limit) || ALARM_PAGE_DEFAULT))
  const pageOffset = Math.max(0, Number(args?.offset) || Number(args?.cursor) || 0)

  /** @type {Record<string, ReturnType<typeof projectAlarmRow>>} */
  let projectedAlarms = {}
  let total = 0
  let returned = 0
  /** @type {string | null} */
  let nextCursor = null

  if (alarmId) {
    const hit = alarms[alarmId]
    if (hit) {
      projectedAlarms = { [alarmId]: projectAlarmRow(alarmId, hit) }
      total = 1
      returned = 1
    } else {
      total = Object.keys(alarms).length
      returned = 0
    }
  } else {
    const entries = Object.entries(alarms)
    total = entries.length
    const slice = entries.slice(pageOffset, pageOffset + pageLimit)
    projectedAlarms = Object.fromEntries(slice.map(([id, row]) => [id, projectAlarmRow(id, row)]))
    returned = slice.length
    if (pageOffset + pageLimit < total) nextCursor = String(pageOffset + pageLimit)
  }

  const projected = {
    ...pickSafetyFields(result),
    connectionId: result.connectionId,
    configVersion: result.configVersion,
    alarms: projectedAlarms,
    alarmCount: total,
    total,
    returned,
    nextCursor,
    subscription: result.subscription,
  }

  return enforceBudget(projected, AGENT_TEXT_CAPS.alarmBytes, 'alarm 超预算：用 alarmId 单查或减小 limit', (p) => {
    const ids = Object.keys(p.alarms || {})
    const keep = ids.slice(0, 10)
    return {
      ...p,
      alarms: Object.fromEntries(keep.map((id) => [id, p.alarms[id]])),
      returned: keep.length,
      truncated: true,
      nextCursor: p.nextCursor || String(keep.length),
    }
  })
}

/**
 * @param {any} args
 * @param {any} result
 * @returns {any}
 */

