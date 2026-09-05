// In-memory Modbus frame ring per scope (split from bench-shared).
const FRAME_LOGS_BY_SCOPE = new Map() // scopeKey -> { byConn: {} }
const FRAME_LOG_CAP = 500

/**
 * Format uniform scope key for frame caches.
 * @param {any} scope { cwd, sessionId, isShared } or cwd string
 * @param {any} [maybeSessionId]
 * @param {boolean} [maybeIsShared]
 * @returns {string}
 */
export function formatFrameScopeKey(scope, maybeSessionId, maybeIsShared) {
  if (scope && typeof scope === 'object') {
    const cwd = String(scope.cwd || '')
    const isShared = scope.isShared === true
    const sessionId = String(scope.sessionId || '').trim()
    return isShared ? `shared:${cwd}` : `${cwd}:${sessionId || '_default'}`
  }
  const cwd = String(scope || '')
  if (typeof maybeSessionId === 'boolean') {
    return maybeSessionId ? `shared:${cwd}` : `${cwd}:_default`
  }
  const sessionId = String(maybeSessionId || '').trim()
  const isShared = maybeIsShared === true
  return isShared ? `shared:${cwd}` : `${cwd}:${sessionId || '_default'}`
}

function frameEntryFor(scopeKey) {
  let s = FRAME_LOGS_BY_SCOPE.get(scopeKey)
  if (!s) {
    s = { byConn: {} }
    FRAME_LOGS_BY_SCOPE.set(scopeKey, s)
  }
  return s
}

export function pushFramesLog(cwd, connId, logArray, options) {
  if (!cwd) return
  const isObjectScope = typeof cwd === 'object'
  const realCwd = isObjectScope ? cwd.cwd : cwd
  if (!realCwd) return
  const sid = isObjectScope ? cwd.sessionId : options?.sessionId
  const isShared = isObjectScope ? cwd.isShared === true : options?.isShared === true
  const scopeKey = formatFrameScopeKey(realCwd, sid, isShared)

  let cid = '_default'
  let list
  if (Array.isArray(connId) && logArray === undefined) {
    list = connId
  } else if (typeof connId === 'string' && Array.isArray(logArray)) {
    cid = connId || '_default'
    list = logArray
  } else if (connId == null && Array.isArray(logArray)) {
    cid = '_default'
    list = logArray
  } else if (Array.isArray(logArray)) {
    cid = String(connId || '_default')
    list = logArray
  } else if (Array.isArray(connId)) {
    list = connId
  } else {
    if (Array.isArray(connId)) {
      list = connId
    } else {
      list = []
    }
  }
  const state = frameEntryFor(scopeKey)
  if (!state.byConn[cid]) state.byConn[cid] = []
  const arr = Array.isArray(list) ? list : []
  for (const entry of arr) {
    if (!entry) continue
    const at = Number(entry.at ?? entry.t) || Date.now()
    const cidNorm = String(entry.connectionId || cid || '')
    const fid = String(
      entry.frameId || entry.id || (cidNorm ? `${cidNorm}:${at}:${String(entry.label || '').slice(0, 8)}` : `f:${at}`),
    )
    const txId = String(entry.transactionId || fid)
    state.byConn[cid].push({
      id: fid,
      frameId: fid,
      transactionId: txId,
      t: at,
      at,
      deviceName: String(entry.deviceName || ''),
      label: String(entry.label || ''),
      request: String(entry.request || ''),
      response: String(entry.response || ''),
      requestHex: String(entry.requestHex || entry.request || '').slice(0, 400),
      responseHex: String(entry.responseHex || entry.response || '').slice(0, 400),
      trace: Array.isArray(entry.trace) ? entry.trace.map((s) => String(s).slice(0, 200)).slice(0, 8) : [],
      connectionId: cidNorm,
      deviceId: String(entry.deviceId || ''),
      taskId: String(entry.taskId || ''),
      source: String(entry.source || 'user'),
      direction: String(entry.direction || 'tx'),
      unitId: Number.isFinite(Number(entry.unitId)) ? Math.trunc(Number(entry.unitId)) : 0,
      functionCode: Number.isFinite(Number(entry.functionCode ?? entry.function))
        ? Math.trunc(Number(entry.functionCode ?? entry.function))
        : 0,
      durationMs: Number.isFinite(Number(entry.durationMs)) ? Math.trunc(Number(entry.durationMs)) : 0,
      status: String(entry.status || 'ok').slice(0, 16),
      error: String(entry.error || '').slice(0, 200),
    })
  }
  if (state.byConn[cid].length > FRAME_LOG_CAP) {
    state.byConn[cid].splice(0, state.byConn[cid].length - FRAME_LOG_CAP)
  }
}

export function getFramesLog(scope, connId, options) {
  const isObjectScope = scope && typeof scope === 'object'
  const realCwd = isObjectScope ? scope.cwd : scope
  if (!realCwd) return []
  const sid = isObjectScope ? scope.sessionId : options?.sessionId
  const isShared = isObjectScope ? scope.isShared === true : options?.isShared === true
  const scopeKey = formatFrameScopeKey(realCwd, sid, isShared)

  const s = FRAME_LOGS_BY_SCOPE.get(scopeKey)
  if (!s) return []
  if (connId === undefined || connId === null || connId === '' || connId === 'all') {
    const all = []
    for (const arr of Object.values(s.byConn)) all.push(...arr)
    all.sort((a, b) => (Number(a.t) || 0) - (Number(b.t) || 0))
    // cap aggregated to 500 most recent across all conns
    if (all.length > FRAME_LOG_CAP) return all.slice(all.length - FRAME_LOG_CAP)
    return all
  }
  return s.byConn[connId] ? s.byConn[connId].slice() : []
}

export function clearFramesLog(scope, connId, options) {
  const isObjectScope = scope && typeof scope === 'object'
  const realCwd = isObjectScope ? scope.cwd : scope
  if (!realCwd) return
  const sid = isObjectScope ? scope.sessionId : options?.sessionId
  const hasExplicitSession = sid !== undefined && sid !== null && sid !== ''
  const isShared = isObjectScope ? scope.isShared === true : options?.isShared === true

  if (!hasExplicitSession && !isShared && typeof scope === 'string') {
    const prefix = `${scope}:`
    const sharedKey = `shared:${scope}`
    for (const key of FRAME_LOGS_BY_SCOPE.keys()) {
      if (key === scope || key === sharedKey || key.startsWith(prefix)) {
        if (connId === undefined || connId === null || connId === '' || connId === 'all') {
          FRAME_LOGS_BY_SCOPE.delete(key)
        } else {
          const s = FRAME_LOGS_BY_SCOPE.get(key)
          if (s) delete s.byConn[connId]
        }
      }
    }
    return
  }

  const key = formatFrameScopeKey(realCwd, sid, isShared)
  const s = FRAME_LOGS_BY_SCOPE.get(key)
  if (!s) return
  if (connId === undefined || connId === null || connId === '' || connId === 'all') {
    s.byConn = {}
  } else {
    delete s.byConn[connId]
  }
}

export function framesLogCount(scope, connId, options) {
  const isObjectScope = scope && typeof scope === 'object'
  const realCwd = isObjectScope ? scope.cwd : scope
  if (!realCwd) return 0
  const sid = isObjectScope ? scope.sessionId : options?.sessionId
  const isShared = isObjectScope ? scope.isShared === true : options?.isShared === true
  const scopeKey = formatFrameScopeKey(realCwd, sid, isShared)

  const s = FRAME_LOGS_BY_SCOPE.get(scopeKey)
  if (!s) return 0
  if (connId) return (s.byConn[connId] || []).length
  let n = 0
  for (const arr of Object.values(s.byConn)) n += arr.length
  return n
}

export function clearAllFramesLogs() {
  FRAME_LOGS_BY_SCOPE.clear()
}
