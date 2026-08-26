// Agent focus / highlight / temp watch (split from bench-shared).
const FOCUS_BY_CWD = new Map() // cwd -> { request, prev, tempWatchIds, badgeOnly, evidence, subs:Set }
const FOCUS_WILDCARD = new Set() // global subscribers get (focus, cwd)

const emptyFocus = () => ({ request: null, prev: null, tempWatchIds: [], badgeOnly: false, evidence: [] })

function focusEntry(cwd) {
  if (!cwd) return null
  let e = FOCUS_BY_CWD.get(cwd)
  if (!e) {
    e = { ...emptyFocus(), subs: new Set() }
    FOCUS_BY_CWD.set(cwd, e)
  }
  return e
}

export function getFocusState(cwd) {
  const e = FOCUS_BY_CWD.get(cwd)
  if (!e) return emptyFocus()
  return {
    request: e.request,
    prev: e.prev,
    tempWatchIds: (e.tempWatchIds || []).slice(),
    badgeOnly: !!e.badgeOnly,
    evidence: (e.evidence || []).slice(),
  }
}

export function setFocusState(cwd, focus) {
  const e = focusEntry(cwd)
  if (!e) return
  if (!focus || typeof focus !== 'object') {
    Object.assign(e, emptyFocus())
  } else {
    e.request = focus.request || null
    e.prev = focus.prev || null
    e.tempWatchIds = Array.isArray(focus.tempWatchIds) ? focus.tempWatchIds.slice(0, 32) : []
    e.badgeOnly = !!focus.badgeOnly
    e.evidence = Array.isArray(focus.evidence) ? focus.evidence.slice(0, 20) : []
  }
  const snapshot = getFocusState(cwd)
  // Task2/0.18.4: identical normalized focus must not re-broadcast every
  // /state poll (drives wildcard listeners repeatedly)
  const sig = JSON.stringify([
    snapshot.request,
    snapshot.prev,
    snapshot.tempWatchIds,
    snapshot.badgeOnly,
    snapshot.evidence,
  ])
  if (e.__sig === sig) return
  e.__sig = sig
  for (const sub of Array.from(e.subs)) {
    try {
      sub(snapshot)
    } catch {}
  }
  for (const sub of Array.from(FOCUS_WILDCARD)) {
    try {
      sub(snapshot, cwd)
    } catch {}
  }
}

export function subscribeFocus(cwd, cb) {
  if (typeof cb !== 'function') return () => {}
  if (!cwd) {
    // wildcard: receives (focus, changedCwd) for every workspace
    FOCUS_WILDCARD.add(cb)
    return () => {
      FOCUS_WILDCARD.delete(cb)
    }
  }
  const e = focusEntry(cwd)
  if (!e) return () => {}
  e.subs.add(cb)
  return () => {
    e.subs.delete(cb)
  }
}

export function isFocusTarget(item, focusRequest) {
  if (!focusRequest || !item) return false
  const cid = item.connectionId || item.connId || ''
  const did = item.deviceId || ''
  const pid = item.pointId || item.id || ''
  const fid = item.frameId || item.id || ''
  if (focusRequest.connectionId && cid && focusRequest.connectionId !== cid) return false
  if (focusRequest.deviceId && did && focusRequest.deviceId !== did) return false
  if (focusRequest.pointId && pid && focusRequest.pointId !== pid) return false
  if (focusRequest.frameId && fid && focusRequest.frameId !== fid) return false
  // At least one id matches
  if (focusRequest.pointId && pid === focusRequest.pointId) return true
  if (focusRequest.frameId && fid === focusRequest.frameId) return true
  if (focusRequest.deviceId && did === focusRequest.deviceId && !focusRequest.pointId && !focusRequest.frameId)
    return true
  if (focusRequest.connectionId && cid === focusRequest.connectionId && !did && !pid && !fid) return true
  return !!(focusRequest.connectionId || focusRequest.deviceId || focusRequest.pointId || focusRequest.frameId)
}

export function focusHighlightClass(isFocused) {
  return isFocused ? ' dvb-focus-ring' : ''
}

// Temp watch group: transient UI-only monitor selection
const TEMP_WATCH = new Map() // cwd -> { ids: string[], at:number, ttlMs:number }

export function setTempWatch(cwd, ids, ttlMs = 300000) {
  if (!cwd) return []
  const list = Array.isArray(ids)
    ? ids
        .map((x) => String(x).trim())
        .filter(Boolean)
        .slice(0, 32)
    : []
  TEMP_WATCH.set(cwd, { ids: list, at: Date.now(), ttlMs })
  return list
}

export function getTempWatch(cwd) {
  const entry = TEMP_WATCH.get(cwd)
  if (!entry) return []
  if (Date.now() - entry.at > entry.ttlMs) {
    TEMP_WATCH.delete(cwd)
    return []
  }
  return entry.ids.slice()
}

export function clearTempWatch(cwd) {
  TEMP_WATCH.delete(cwd)
}

export function hasTempWatch(cwd) {
  return getTempWatch(cwd).length > 0
}

export function isForegroundTask(task) {
  if (!task || typeof task !== 'object') return false
  // Agent 的轮询/读点等背景任务 badgeOnly
  if (task.source === 'agent' && (task.type === 'read' || task.type === 'poll')) return false
  // 已标记 badgeOnly 的 focus 请求也不抢焦点
  if (task && task.badgeOnly === true) return false
  if (task && task.foreground === false) return false
  return true
}

export function shouldStealFocus(task, focusState) {
  if (focusState?.badgeOnly) return false
  if (task && task.foreground === false) return false
  if (task?.badgeOnly) return false
  return isForegroundTask(task)
}

export function shouldHighlightFocus(focusState) {
  if (!focusState || !focusState.request) return false
  if (focusState.badgeOnly) return false
  return true
}
