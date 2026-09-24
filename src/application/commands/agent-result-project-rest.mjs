// @ts-check
import { AGENT_FRAMES_MAX_LIMIT, AGENT_TEXT_CAPS, utf8ByteLength } from './agent-result-caps.mjs'
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
  // `offset` is live-list pagination counted from the newest end (see listFrames);
  // it does NOT guarantee snapshot consistency during concurrent collection.
  const page = allFrames.slice(0, limit)
  const cap = AGENT_TEXT_CAPS.framesBytes

  /**
   * @param {any[]} frames
   * @param {number} returned
   * @param {string | null} nextCursor
   * @param {boolean | undefined} truncated
   * @param {Record<string, unknown>} [extra]
   */
  const build = (frames, returned, nextCursor, truncated, extra) => ({
    ...pickSafetyFields(result),
    ...extra,
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
    truncated,
  })

  if (page.length === 0) {
    const nextCursor = offset < total ? String(offset) : null
    return build([], 0, nextCursor, nextCursor != null || undefined)
  }

  // Keep the tail continuous k so `offset+k` points at the next older batch.
  // Metadata is derived from k: returned === frames.length always.
  for (let k = page.length; k >= 1; k--) {
    const frames = page.slice(-k)
    const nextOffset = offset + k
    const nextCursor = nextOffset < total ? String(nextOffset) : null
    const truncated = nextCursor != null || page.length > k || undefined
    const projected = build(frames, k, nextCursor, truncated)
    if (utf8ByteLength(projected) <= cap) return projected
  }

  // Even one frame exceeds budget: surface frameId + target + overrun (not an empty ok page).
  const culprit = page[page.length - 1]
  const frameId = (culprit && (culprit.frameId || culprit.id)) || ''
  const skipOffset = offset + 1
  const nextCursor = skipOffset < total ? String(skipOffset) : null
  const stub = [{ frameId, id: frameId, overrun: true }]
  const extra = {
    frameId,
    overrun: true,
    hint: '单条报文超预算：用 frameId 单查',
  }
  const projected = build(stub, stub.length, nextCursor, true, extra)
  if (utf8ByteLength(projected) <= cap) return projected

  return {
    ...pickSafetyFields(result),
    connectionId: result.connectionId,
    deviceId: result.deviceId,
    configVersion: result.configVersion,
    total,
    limit,
    frames: [],
    returned: 0,
    nextCursor: skipOffset < total ? String(skipOffset) : null,
    truncated: true,
    frameId,
    overrun: true,
    hint: '单条报文超预算：用 frameId 单查',
  }
}

/**
 * Build one series with a continuous newest suffix of `keep` samples.
 * keep=0 is explicit empty — `slice(-0)` would return the entire array.
 * @param {any} series
 * @param {number} keep
 */
function buildSeriesPage(series, keep) {
  const all = Array.isArray(series.samples) ? series.samples : []
  const k = Number.isFinite(keep) && keep > 0 ? Math.trunc(keep) : 0
  const samples = k > 0 ? all.slice(-k) : []
  const count = Number(series.count) || all.length
  return {
    pointId: series.pointId,
    name: series.name,
    connectionId: series.connectionId,
    deviceId: series.deviceId,
    unit: series.unit,
    count,
    returned: samples.length,
    samples,
    hasMore: count > samples.length,
    oldestReturnedAt: samples.length ? Number(samples[0][0]) || 0 : null,
    ...(series.dataStatus ? { dataStatus: series.dataStatus } : {}),
  }
}

/**
 * @param {any[]} projectedSeries
 * @param {number | undefined} limit
 * @param {any} trend
 * @param {any} result
 */
function assembleTrendResult(projectedSeries, limit, trend, result) {
  const total = projectedSeries.reduce((n, s) => n + (Number(s.count) || 0), 0)
  const returned = projectedSeries.reduce((n, s) => n + s.samples.length, 0)
  return {
    ...pickSafetyFields(result),
    trend: {
      ...trend,
      series: projectedSeries,
      total,
      returned,
      // Not a Host-parsed cursor: agents page with pointIds + end=oldestReturnedAt-1.
      nextCursor: null,
      limit: Number.isFinite(limit) && Number(limit) > 0 ? Math.trunc(Number(limit)) : undefined,
    },
  }
}

/**
 * @param {any} args
 * @param {any} result
 */
export function projectTrend(args, result) {
  const trend = result.trend && typeof result.trend === 'object' ? { ...result.trend } : {}
  /** @type {any[]} */
  const series = Array.isArray(trend.series) ? trend.series : []
  const argsLimit = Number(args?.limit)
  const hostLimit = Number(trend.limit)
  const effectiveLimit = Number.isFinite(argsLimit) && argsLimit > 0
    ? Math.trunc(argsLimit)
    : Number.isFinite(hostLimit) && hostLimit > 0
      ? Math.trunc(hostLimit)
      : undefined
  const cap = AGENT_TEXT_CAPS.trendBytes
  // Full candidate page first (newest continuous window as provided).
  const full = series.map((/** @type {any} */ s) => {
    const count = Number(s?.count) || (Array.isArray(s?.samples) ? s.samples.length : 0)
    const samples = Array.isArray(s?.samples) ? s.samples : []
    return { ...s, count, samples }
  })
  const maxKeep = Math.max(0, ...full.map((s) => s.samples.length))
  // Non-empty input must keep at least one newest sample per non-empty series —
  // keep=0 is only legal when the source data is truly empty.
  const minKeep = maxKeep > 0 ? 1 : 0
  for (let keep = maxKeep; keep >= minKeep; keep--) {
    const projectedSeries = full.map((s) => buildSeriesPage(s, keep))
    const page = assembleTrendResult(projectedSeries, effectiveLimit, trend, result)
    const candidate = projectedSeries.some((s) => s.hasMore) ? { ...page, truncated: true } : page
    if (utf8ByteLength(candidate) <= cap) return candidate
  }
  // Metadata + one newest sample per non-empty series still does not fit:
  // degraded overrun result (allowed to exceed normal cap) — never a fake empty ok page.
  const one = full.map((s) => buildSeriesPage(s, s.samples.length ? 1 : 0))
  return {
    ...assembleTrendResult(one, effectiveLimit, trend, result),
    truncated: true,
    overrun: true,
    hint: 'trend 超预算：缩小 pointIds 或精简元数据（至少保留每条序列最新样本）',
  }
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

