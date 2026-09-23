// @ts-check

/**
 * @typedef {{
 *   connectionId: string,
 *   deviceId: string,
 *   pointId: string,
 *   frameId: string,
 *   trendKey: string,
 *   alarmId: string,
 *   visualizationId?: string,
 *   snapshotId?: string,
 *   debugSessionId?: string,
 *   kind: string,
 *   at: number,
 *   by?: string,
 *   version: number,
 * }} FocusRequest
 * @typedef {FocusRequest & {
 *   id: string,
 *   timeRange: { start: number, end: number },
 *   componentType?: string,
 *   pointIds?: string[],
 *   reason?: string,
 *   file?: string,
 *   line?: number,
 *   firmwareHash?: string,
 * }} FocusEvidence
 * @typedef {{
 *   sessionId: string,
 *   request: FocusRequest | null,
 *   prev: FocusRequest | null,
 *   tempWatchIds: string[],
 *   badgeOnly: boolean,
 *   evidence: Array<FocusEvidence | null>,
 * }} FocusState
 */

/** @returns {FocusState} */
export const emptyFocusState = () => ({
  sessionId: '',
  request: null,
  prev: null,
  tempWatchIds: [],
  badgeOnly: false,
  evidence: [],
})

/** @param {unknown} v */
const focusText = (v) => (typeof v === 'string' ? v.trim().slice(0, 64) : '')

/** @param {unknown} input @returns {FocusRequest | null} */
export const normalizeFocusRequest = (input) => {
  if (!input || typeof input !== 'object') return null
  const src = /** @type {Record<string, unknown>} */ (input)
  const connectionId = focusText(src.connectionId || src.connId)
  const deviceId = focusText(src.deviceId)
  const pointId = focusText(src.pointId)
  const frameId = focusText(src.frameId)
  const trendKey = focusText(src.trendKey)
  const alarmId = focusText(src.alarmId)
  const visualizationId = focusText(src.visualizationId)
  const snapshotId = focusText(src.snapshotId)
  const debugSessionId = focusText(src.debugSessionId)
  const kind = typeof src.kind === 'string' ? src.kind.slice(0, 32) : ''
  const at = Number(src.at) > 0 ? Number(src.at) : Date.now()
  const by = src.by === 'agent' ? 'agent' : 'user'
  const version = Number(src.version) > 0 ? Number(src.version) : 0
  const hasTarget =
    connectionId ||
    deviceId ||
    pointId ||
    frameId ||
    trendKey ||
    alarmId ||
    visualizationId ||
    snapshotId ||
    debugSessionId
  if (!hasTarget) return null
  return {
    connectionId,
    deviceId,
    pointId,
    frameId,
    trendKey,
    alarmId,
    visualizationId,
    snapshotId,
    debugSessionId,
    kind,
    at,
    by,
    version,
  }
}

/** @param {unknown} input */
export const normalizeFocusState = (input) => {
  const out = emptyFocusState()
  if (!input || typeof input !== 'object') return out
  const src = /** @type {Record<string, unknown>} */ (input)
  const req = normalizeFocusRequest(src.request || input)
  const prev = normalizeFocusRequest(src.prev)
  out.sessionId = typeof src.sessionId === 'string' ? src.sessionId.trim().slice(0, 128) : ''
  out.request = req
  out.prev = prev
  if (Array.isArray(src.tempWatchIds)) {
    out.tempWatchIds = src.tempWatchIds
      .map((/** @type {unknown} */ v) => focusText(v))
      .filter(Boolean)
      .slice(0, 32)
  } else if (Array.isArray(src.tempWatch)) {
    out.tempWatchIds = src.tempWatch
      .map((/** @type {unknown} */ v) => focusText(v))
      .filter(Boolean)
      .slice(0, 32)
  }
  out.badgeOnly = src.badgeOnly === true
  if (Array.isArray(src.evidence)) {
    out.evidence = src.evidence
      .slice(0, 20)
      .map((/** @type {unknown} */ e) => {
        if (!e || typeof e !== 'object') return null
        const rowSrc = /** @type {Record<string, unknown>} */ (e)
        const kind = typeof rowSrc.kind === 'string' ? rowSrc.kind.slice(0, 32) : ''
        const at = Number(rowSrc.at) > 0 ? Number(rowSrc.at) : Date.now()
        const pointId = focusText(rowSrc.pointId || (kind === 'point' ? rowSrc.id : ''))
        const frameId = focusText(rowSrc.frameId || (kind === 'frame' ? rowSrc.id : ''))
        const alarmId = focusText(rowSrc.alarmId || (kind === 'alarm' ? rowSrc.id : ''))
        const trendKey = focusText(rowSrc.trendKey || (kind === 'trend' ? rowSrc.id : ''))
        const visualizationId = focusText(rowSrc.visualizationId || (kind === 'visualization' ? rowSrc.id : ''))
        const snapshotId = focusText(rowSrc.snapshotId || (kind === 'debug_snapshot' ? rowSrc.id : ''))
        const debugSessionId = focusText(rowSrc.debugSessionId)
        const reason = typeof rowSrc.reason === 'string' ? rowSrc.reason.slice(0, 120) : ''
        const file = typeof rowSrc.file === 'string' ? rowSrc.file.slice(0, 256) : ''
        const line = Number(rowSrc.line) || 0
        const firmwareHash = typeof rowSrc.firmwareHash === 'string' ? rowSrc.firmwareHash.slice(0, 64) : ''
        const componentType = typeof rowSrc.componentType === 'string' ? rowSrc.componentType.slice(0, 16) : ''
        const pointIds = Array.isArray(rowSrc.pointIds)
          ? rowSrc.pointIds
              .map((/** @type {unknown} */ x) => focusText(x))
              .filter(Boolean)
              .slice(0, 16)
          : []
        const rawRange = /** @type {{ start?: unknown, end?: unknown } | null | undefined} */ (rowSrc.timeRange)
        const rangeStart = Number(rawRange?.start)
        const rangeEnd = Number(rawRange?.end)
        const timeRange =
          Number.isFinite(rangeStart) && rangeStart > 0 && Number.isFinite(rangeEnd) && rangeEnd >= rangeStart
            ? { start: rangeStart, end: rangeEnd }
            : { start: at - 5 * 60 * 1000, end: at }
        const row = /** @type {FocusEvidence} */ ({
          kind,
          id: focusText(rowSrc.id || snapshotId || visualizationId || pointId || frameId || trendKey || alarmId),
          connectionId: focusText(rowSrc.connectionId || rowSrc.connId),
          deviceId: focusText(rowSrc.deviceId),
          pointId,
          frameId,
          trendKey,
          alarmId,
          at,
          version: Number(rowSrc.version) > 0 ? Number(rowSrc.version) : 0,
          timeRange,
        })
        if (kind === 'visualization' || visualizationId) {
          row.visualizationId = visualizationId
          row.componentType = componentType
          row.pointIds = pointIds
        }
        if (kind === 'debug_snapshot' || snapshotId) {
          row.snapshotId = snapshotId
          row.debugSessionId = debugSessionId
          row.reason = reason
          row.file = file
          row.line = line
          row.firmwareHash = firmwareHash
        }
        return row
      })
      .filter(Boolean)
  }
  return out
}
