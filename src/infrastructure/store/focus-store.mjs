export const emptyFocusState = () => ({
  sessionId: '',
  request: null,
  prev: null,
  tempWatchIds: [],
  badgeOnly: false,
  evidence: [],
})

const focusText = (v) => (typeof v === 'string' ? v.trim().slice(0, 64) : '')

export const normalizeFocusRequest = (input) => {
  if (!input || typeof input !== 'object') return null
  const connectionId = focusText(input.connectionId || input.connId)
  const deviceId = focusText(input.deviceId)
  const pointId = focusText(input.pointId)
  const frameId = focusText(input.frameId)
  const trendKey = focusText(input.trendKey)
  const alarmId = focusText(input.alarmId)
  const visualizationId = focusText(input.visualizationId)
  const snapshotId = focusText(input.snapshotId)
  const debugSessionId = focusText(input.debugSessionId)
  const kind = typeof input.kind === 'string' ? input.kind.slice(0, 32) : ''
  const at = Number(input.at) > 0 ? Number(input.at) : Date.now()
  const by = input.by === 'agent' ? 'agent' : 'user'
  const version = Number(input.version) > 0 ? Number(input.version) : 0
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

export const normalizeFocusState = (input) => {
  const out = emptyFocusState()
  if (!input || typeof input !== 'object') return out
  const req = normalizeFocusRequest(input.request || input)
  const prev = normalizeFocusRequest(input.prev)
  out.sessionId = typeof input.sessionId === 'string' ? input.sessionId.trim().slice(0, 128) : ''
  out.request = req
  out.prev = prev
  if (Array.isArray(input.tempWatchIds)) {
    out.tempWatchIds = input.tempWatchIds
      .map((v) => focusText(v))
      .filter(Boolean)
      .slice(0, 32)
  } else if (Array.isArray(input.tempWatch)) {
    out.tempWatchIds = input.tempWatch
      .map((v) => focusText(v))
      .filter(Boolean)
      .slice(0, 32)
  }
  out.badgeOnly = input.badgeOnly === true
  if (Array.isArray(input.evidence)) {
    out.evidence = input.evidence
      .slice(0, 20)
      .map((e) => {
        if (!e || typeof e !== 'object') return null
        const kind = typeof e.kind === 'string' ? e.kind.slice(0, 32) : ''
        const at = Number(e.at) > 0 ? Number(e.at) : Date.now()
        const pointId = focusText(e.pointId || (kind === 'point' ? e.id : ''))
        const frameId = focusText(e.frameId || (kind === 'frame' ? e.id : ''))
        const alarmId = focusText(e.alarmId || (kind === 'alarm' ? e.id : ''))
        const trendKey = focusText(e.trendKey || (kind === 'trend' ? e.id : ''))
        const visualizationId = focusText(e.visualizationId || (kind === 'visualization' ? e.id : ''))
        const snapshotId = focusText(e.snapshotId || (kind === 'debug_snapshot' ? e.id : ''))
        const debugSessionId = focusText(e.debugSessionId)
        const reason = typeof e.reason === 'string' ? e.reason.slice(0, 120) : ''
        const file = typeof e.file === 'string' ? e.file.slice(0, 256) : ''
        const line = Number(e.line) || 0
        const firmwareHash = typeof e.firmwareHash === 'string' ? e.firmwareHash.slice(0, 64) : ''
        const componentType = typeof e.componentType === 'string' ? e.componentType.slice(0, 16) : ''
        const pointIds = Array.isArray(e.pointIds)
          ? e.pointIds
              .map((x) => focusText(x))
              .filter(Boolean)
              .slice(0, 16)
          : []
        const rawRange = e?.timeRange
        const rangeStart = Number(rawRange?.start)
        const rangeEnd = Number(rawRange?.end)
        const timeRange =
          Number.isFinite(rangeStart) && rangeStart > 0 && Number.isFinite(rangeEnd) && rangeEnd >= rangeStart
            ? { start: rangeStart, end: rangeEnd }
            : { start: at - 5 * 60 * 1000, end: at }
        const row = {
          kind,
          id: focusText(e.id || snapshotId || visualizationId || pointId || frameId || trendKey || alarmId),
          connectionId: focusText(e.connectionId || e.connId),
          deviceId: focusText(e.deviceId),
          pointId,
          frameId,
          trendKey,
          alarmId,
          at,
          version: Number(e.version) > 0 ? Number(e.version) : 0,
          timeRange,
        }
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
