// Shared client widgets and helpers for every conversation view.
// Everything here is explicitly imported by its consumers — no hidden
// strip-concat scope sharing.
export { clockOf } from './bench-points.mjs'
import { statusKind } from './bench-settings.mjs'

export const POLL_MS = 2000

export function useSessionCwd(React, props) {
  const sessionId = props && props.sessionId
  return props && props.useSessions
    ? props.useSessions((s) => (s.byId && sessionId && s.byId[sessionId] && s.byId[sessionId].cwd) || '')
    : ''
}

export function emptyWorkspace() {
  return {
    keil: { project: '', target: '', artifact: 'hex' },
    modbus: {
      version: 2,
      conn: { mode: 'rtu', port: '', baudrate: 9600, bytesize: 8, parity: 'N', stopbits: 1, host: '', tcpPort: 502, slave: 1, sim: false },
      points: [],
      values: [],
      polling: { enabled: false, intervalMs: 1000, lastAt: 0, lastOk: true, error: '' },
      alarmActive: {},
    },
  }
}

export function emptyJournal() {
  return { tasks: [], running: [], timeline: [] }
}

export function pickJournal(data) {
  if (data && data.journal) return data.journal
  const workspace = data && data.workspace
  const tasks = workspace && Array.isArray(workspace.tasks) ? workspace.tasks : []
  const timeline = workspace && Array.isArray(workspace.timeline) ? workspace.timeline : []
  return {
    tasks,
    running: tasks.filter((item) => item && item.status === 'running'),
    timeline,
  }
}

export function runningOf(journal, type) {
  const list = journal && Array.isArray(journal.running) ? journal.running : []
  return list.some((item) => item && item.type === type && item.status === 'running')
}

export function runningSource(journal, type) {
  const list = journal && Array.isArray(journal.running) ? journal.running : []
  const hit = list.find((item) => item && item.type === type && item.status === 'running')
  return hit ? hit.source : ''
}

export function formatClock(at) {
  const n = Number(at)
  if (!Number.isFinite(n) || n <= 0) return ''
  try {
    return new Date(n).toLocaleTimeString(undefined, { hour12: false })
  } catch {
    return ''
  }
}

export function sourceLabel(t, source) {
  if (source === 'agent') return t('sourceAgent')
  if (source === 'system') return t('sourceSystem')
  return t('sourceUser')
}

export function statusLabel(t, status) {
  if (status === 'running') return t('statusRunning')
  if (status === 'ok') return t('statusOk')
  if (status === 'cancelled') return t('statusCancelled')
  return t('statusError')
}

export function typeLabel(t, type) {
  return type === 'read' ? t('taskRead') : t('taskBuild')
}

export function field(el, label, control) {
  return el('div', { className: 'dvb-row' },
    el('div', { className: 'dvb-label' }, el('span', null, label)),
    control)
}

export function statusBar(el, t, cwd, rows) {
  return el('div', { className: 'dvb-bar' },
    el('div', { className: 'dvb-health' }, rows.map((row) => el('span', {
      key: row.key,
      className: 'dvb-chip',
      'data-kind': statusKind(row.health),
    }, t(row.key) + ' · ' + t(statusKind(row.health))))),
    cwd
      ? el('div', { className: 'dvb-cwd' }, t('workspace') + '  ' + cwd)
      : el('div', { className: 'dvb-msg', 'data-kind': 'err' }, t('needWorkspace')))
}

export function visionCollabBar(el, t, opts) {
  const cwd = opts && opts.cwd || ''
  const workspace = opts && opts.workspace || {}
  const journal = opts && opts.journal || { tasks: [], running: [], timeline: [] }
  const pendingWrites = opts && opts.pendingWrites || opts && opts.pending || []
  const sessionId = opts && opts.sessionId || ''
  const session = workspace.session || {}
  const boundId = session.boundId || ''
  const bindState = !sessionId ? 'none' : (boundId === sessionId ? 'self' : (boundId ? 'other' : 'open'))
  const running = journal.running || []
  const pendingCount = Array.isArray(pendingWrites) ? pendingWrites.length : 0
  const manualPending = (workspace.manualRequests || []).filter((m) => m.status === 'pending').length
  const runningCount = running.length
  if (!cwd && !runningCount && !pendingCount && !manualPending) return null
  return el('div', { className: 'dvb-vision-bar' },
    el('div', { className: 'dvb-vision-chips' },
      cwd ? el('span', { className: 'dvb-chip', title: cwd }, t('workspace') + ' ' + cwd.slice(-32)) : null,
      el('span', { className: 'dvb-chip', 'data-kind': bindState === 'self' ? 'ready' : 'unbound' }, t('bindChip') + ' · ' + t('bindState_' + bindState)),
      runningCount ? el('span', { className: 'dvb-chip', 'data-kind': 'live' }, '任务 ' + runningCount) : null,
      pendingCount ? el('span', { className: 'dvb-chip', 'data-kind': 'warn' }, '待确认 ' + pendingCount) : null,
      manualPending ? el('span', { className: 'dvb-chip', 'data-kind': 'warn' }, '人工 ' + manualPending) : null,
    ),
    el('div', { className: 'dvb-vision-meta' },
      journal.tasks && journal.tasks.length ? el('span', { className: 'dvb-hint' }, t('tasks') + ' ' + journal.tasks.length) : null,
      journal.timeline && journal.timeline.length ? el('span', { className: 'dvb-hint' }, t('timeline') + ' ' + journal.timeline.length) : null,
    )
  )
}

export function journalPanel(el, t, journal) {
  const tasks = journal && Array.isArray(journal.tasks) ? journal.tasks : []
  const timeline = journal && Array.isArray(journal.timeline) ? journal.timeline : []
  if (!tasks.length && !timeline.length) return null
  return el('div', { className: 'dvb-journal' },
    tasks.length ? el('div', { className: 'dvb-journal-title' }, t('tasks')) : null,
    tasks.slice(0, 6).map((item) => el('div', {
      key: item.id,
      className: 'dvb-task',
      'data-status': item.status,
      'data-source': item.source,
    },
      el('span', { className: 'dvb-badge' }, formatClock(item.startedAt)),
      el('span', { className: 'dvb-badge', 'data-source': item.source }, sourceLabel(t, item.source)),
      el('span', null, typeLabel(t, item.type)),
      el('span', { className: 'dvb-badge' }, statusLabel(t, item.status)),
      el('span', {
        className: 'dvb-hint',
        title: [item.logFile, item.phase].concat(Array.isArray(item.errors) ? item.errors : []).filter(Boolean).join('\n'),
      }, item.summary || (item.errors && item.errors[0]) || ''),
      item.frames && (item.frames.request || item.frames.response)
        ? el('div', { className: 'dvb-frames', title: (item.frames.trace || []).join('\n') },
          item.frames.request ? el('div', null, '→ ' + item.frames.request) : null,
          item.frames.response ? el('div', null, '← ' + item.frames.response) : null)
        : null)),
    timeline.length ? el('div', { className: 'dvb-journal-title' }, t('timeline')) : null,
    timeline.slice(0, 8).map((item) => el('div', {
      key: item.id,
      className: 'dvb-event',
      'data-source': item.source,
      'data-ok': item.ok === false ? 'false' : item.ok === true ? 'true' : '',
    },
      el('span', { className: 'dvb-badge' }, formatClock(item.at)),
      el('span', { className: 'dvb-badge', 'data-source': item.source }, sourceLabel(t, item.source)),
      el('span', { className: 'dvb-hint' }, item.summary || item.kind))))
}

// ── per-cwd shared /state poller ─────────────────────────────────────────────
// Task1/0.18.3: ONE bus per workspace so sessions never broadcast to each other.
const STATE_BUSES = new Map() // cwd -> { cwd, data, subs:Set, timer, seq, post }

function busEntry(post, cwd) {
  let e = STATE_BUSES.get(cwd)
  if (!e) {
    e = { cwd, data: null, subs: new Set(), timer: 0, seq: 0, post: null }
    STATE_BUSES.set(cwd, e)
  }
  // keep the freshest post fn (hot reload must not hold a stale closure)
  if (typeof post === 'function') e.post = post
  return e
}

function busPull(e) {
  const seq = ++e.seq
  const post = e.post
  if (typeof post !== 'function') return
  post('/dsh-vision-bench/state', { cwd: e.cwd }).then((data) => {
    // unsubscribed (map entry gone) or a newer request superseded this one
    if (!STATE_BUSES.has(e.cwd) || seq !== e.seq) return
    e.data = data
    for (const sub of Array.from(e.subs)) {
      try { sub(data) } catch { /* subscriber errors stay isolated */ }
    }
  }).catch(() => { /* next tick retries */ })
}

export function subscribeState(post, cwd, cb) {
  if (!cwd) {
    cb(null)
    return function () {}
  }
  const e = busEntry(post, cwd)
  // register BEFORE the first pull so an extremely fast response can't miss us
  e.subs.add(cb)
  if (e.subs.size === 1) {
    e.seq++ // cancel any stale in-flight response from a previous last subscriber
    busPull(e)
    if (e.timer) clearInterval(e.timer)
    e.timer = setInterval(() => busPull(e), POLL_MS)
  } else if (e.data) {
    // later subscribers get the cached snapshot immediately
    try { cb(e.data) } catch { /* isolate */ }
  }
  return function () {
    const cur = STATE_BUSES.get(cwd)
    if (!cur || cur !== e) return
    cur.subs.delete(cb)
    if (cur.subs.size === 0) {
      clearInterval(cur.timer)
      cur.timer = 0
      cur.seq++ // in-flight responses must not deliver after final unsubscribe
      STATE_BUSES.delete(cwd)
    }
  }
}

// Modbus frame stream per connection (framesByConnection). Task2/0.18.3: ring
// buffers are keyed per-CWD; sessions never clear or read each other's frames.
// API signatures intentionally unchanged: pushFramesLog(cwd, connId, frames),
// getFramesLog(cwd, connId), clearFramesLog(cwd, connId), framesLogCount(cwd, connId).
const FRAME_LOGS_BY_CWD = new Map() // cwd -> { byConn: {} }
const FRAME_LOG_CAP = 500

function frameEntryFor(cwd) {
  let s = FRAME_LOGS_BY_CWD.get(cwd)
  if (!s) {
    s = { byConn: {} }
    FRAME_LOGS_BY_CWD.set(cwd, s)
  }
  return s
}

export function pushFramesLog(cwd, connId, logArray) {
  if (!cwd) return
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
    // fallback: treat second arg as array if no third
    if (Array.isArray(connId)) { list = connId } else { list = [] }
  }
  const state = frameEntryFor(cwd)
  if (!state.byConn[cid]) state.byConn[cid] = []
  const arr = Array.isArray(list) ? list : []
  for (const entry of arr) {
    if (!entry) continue
    const at = Number(entry.at ?? entry.t) || Date.now()
    const cidNorm = String(entry.connectionId || cid || '')
    const fid = String(entry.frameId || entry.id || (cidNorm ? (cidNorm + ':' + at + ':' + String(entry.label || '').slice(0, 8)) : ('f:' + at)))
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
      functionCode: Number.isFinite(Number(entry.functionCode ?? entry.function)) ? Math.trunc(Number(entry.functionCode ?? entry.function)) : 0,
      durationMs: Number.isFinite(Number(entry.durationMs)) ? Math.trunc(Number(entry.durationMs)) : 0,
      status: String(entry.status || 'ok').slice(0, 16),
      error: String(entry.error || '').slice(0, 200),
    })
  }
  if (state.byConn[cid].length > FRAME_LOG_CAP) {
    state.byConn[cid].splice(0, state.byConn[cid].length - FRAME_LOG_CAP)
  }
}

export function getFramesLog(cwd, connId) {
  const s = FRAME_LOGS_BY_CWD.get(cwd)
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

export function clearFramesLog(cwd, connId) {
  const s = FRAME_LOGS_BY_CWD.get(cwd)
  if (!s) return
  if (connId === undefined || connId === null || connId === '' || connId === 'all') {
    s.byConn = {}
  } else {
    delete s.byConn[connId]
  }
}

export function framesLogCount(cwd, connId) {
  const s = FRAME_LOGS_BY_CWD.get(cwd)
  if (!s) return 0
  if (connId) return (s.byConn[connId] || []).length
  let n = 0
  for (const arr of Object.values(s.byConn)) n += arr.length
  return n
}

// ── Sidebar scope (follow / pinned) helpers ────────────────────────────────
// Pinned scope lives per-cwd in memory; HMI activeConnectionId/activeDeviceId is the follow source.
// All three sidebar tabs (monitor / chart / alarm / frames) use same resolver so they never diverge.
const SIDEBAR_PIN = new Map() // cwd -> { connectionId, deviceId, pinned:boolean }

export function getSidebarPin(cwd) {
  return SIDEBAR_PIN.get(cwd) || null
}
export function setSidebarPin(cwd, pin) {
  if (!pin || !pin.pinned) {
    SIDEBAR_PIN.delete(cwd)
    return null
  }
  const v = {
    connectionId: String(pin.connectionId || ''),
    deviceId: String(pin.deviceId || ''),
    pinned: true,
  }
  SIDEBAR_PIN.set(cwd, v)
  return v
}
export function clearSidebarPin(cwd) {
  SIDEBAR_PIN.delete(cwd)
}
export function resolveSidebarScope(cwd, activeConnectionId, activeDeviceId) {
  const pin = SIDEBAR_PIN.get(cwd)
  if (pin && pin.pinned && pin.connectionId) {
    return { connectionId: pin.connectionId, deviceId: pin.deviceId || '', pinned: true, follow: false }
  }
  return { connectionId: String(activeConnectionId || ''), deviceId: String(activeDeviceId || ''), pinned: false, follow: true }
}
export function filterByScope(list, scope, getIds) {
  if (!Array.isArray(list)) return []
  if (!scope || !scope.connectionId) return list
  return list.filter((item) => {
    const ids = typeof getIds === 'function' ? getIds(item) : item
    const cid = ids && (ids.connectionId || ids.connId) || ''
    const did = ids && ids.deviceId || ''
    if (cid !== scope.connectionId) return false
    if (scope.deviceId && did && did !== scope.deviceId) return false
    return true
  })
}

// ── Agent focus / highlight / temp watch / evidence (per-cwd) ───────────────
// Task2/0.18.3: sessions no longer clobber each other's focus.

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
  for (const sub of Array.from(e.subs)) {
    try { sub(snapshot) } catch {}
  }
  for (const sub of Array.from(FOCUS_WILDCARD)) {
    try { sub(snapshot, cwd) } catch {}
  }
}

export function subscribeFocus(cwd, cb) {
  if (typeof cb !== 'function') return function () {}
  if (!cwd) {
    // wildcard: receives (focus, changedCwd) for every workspace
    FOCUS_WILDCARD.add(cb)
    return function () { FOCUS_WILDCARD.delete(cb) }
  }
  const e = focusEntry(cwd)
  if (!e) return function () {}
  e.subs.add(cb)
  return function () { e.subs.delete(cb) }
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
  if (focusRequest.deviceId && did === focusRequest.deviceId && !focusRequest.pointId && !focusRequest.frameId) return true
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
  const list = Array.isArray(ids) ? ids.map((x) => String(x).trim()).filter(Boolean).slice(0, 32) : []
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

// Structured Agent reference for “让 Agent 分析” — stable ID + configVersion + timeRange
// Task4/0.18.2: kind decides which id field carries the target:
//   point → pointId, frame → frameId, alarm → alarmId, trend → trendKey
// trendKey must be connectionId:deviceId:pointId and backfills those ids.
export const parseTrendKey = (key) => {
  if (typeof key !== 'string') return null
  const parts = key.split(':')
  if (parts.length !== 3) return null
  const [a, b, c] = parts.map((x) => x.trim())
  if (!a || !b || !c) return null
  return { connectionId: a, deviceId: b, pointId: c }
}

export function buildAgentRef(kind, payload, opts) {
  const now = Date.now()
  const k = String(kind || 'point')
  const base = {
    kind: k,
    at: now,
    configVersion: opts && opts.configVersion != null ? Number(opts.configVersion) : 3,
  }
  if (payload && typeof payload === 'object') {
    const p = payload
    const connId = String(p.connectionId || p.connId || (opts && opts.connectionId) || '').slice(0, 64)
    base.connectionId = connId
    base.deviceId = String(p.deviceId || (opts && opts.deviceId) || '').slice(0, 64)
    base.pointId = ''
    base.frameId = ''
    base.alarmId = ''
    base.trendKey = ''
    if (k === 'trend') {
      const tk = String(p.trendKey || p.key || p.id || '').slice(0, 96)
      if (tk) {
        const parsed = parseTrendKey(tk)
        if (!parsed) throw new Error('trendKey 格式应为 connectionId:deviceId:pointId: ' + tk)
        base.connectionId = base.connectionId || parsed.connectionId
        base.deviceId = base.deviceId || parsed.deviceId
        base.pointId = parsed.pointId
        base.trendKey = tk
      }
    } else if (k === 'point') {
      base.pointId = String(p.pointId || p.id || (opts && opts.pointId) || '').slice(0, 64)
    } else if (k === 'frame') {
      base.frameId = String(p.frameId || p.id || (opts && opts.frameId) || '').slice(0, 64)
    } else if (k === 'alarm') {
      base.alarmId = String(p.alarmId || p.id || (opts && opts.alarmId) || '').slice(0, 64)
      // alarm refs keep explicit point context in its own typed field
      if (p.pointId) base.pointId = String(p.pointId).slice(0, 64)
    } else {
      // generic targets (connection/device/focus/…) carry only what was given
      base.pointId = String(p.pointId || p.id || (opts && opts.pointId) || '').slice(0, 64)
      base.frameId = String(p.frameId || (opts && opts.frameId) || '').slice(0, 64)
      base.alarmId = String(p.alarmId || (opts && opts.alarmId) || '').slice(0, 64)
      base.trendKey = String(p.trendKey || (opts && opts.trendKey) || '').slice(0, 96)
    }
    if (p.start != null || p.end != null) {
      base.timeRange = {
        start: Number(p.start ?? (opts && opts.start) ?? (now - 5 * 60 * 1000)),
        end: Number(p.end ?? (opts && opts.end) ?? now),
      }
    } else if (opts && (opts.start != null || opts.end != null)) {
      base.timeRange = { start: Number(opts.start ?? (now - 5 * 60 * 1000)), end: Number(opts.end ?? now) }
    } else {
      base.timeRange = { start: now - 5 * 60 * 1000, end: now }
    }
    // Include human label if available
    if (p.name || p.label) base.label = String(p.name || p.label).slice(0, 80)
  } else {
    base.timeRange = { start: now - 5 * 60 * 1000, end: now }
  }
  return base
}

// Task4/0.18.2: map an agent ref to the standard evidence shape
// { kind, id, connectionId, deviceId, pointId, frameId, trendKey, alarmId, at, version, timeRange }
export function evidenceFromRef(ref) {
  const r = ref || {}
  const kind = String(r.kind || 'point')
  const at = Number(r.at) > 0 ? Number(r.at) : Date.now()
  const timeRange = r.timeRange && Number.isFinite(Number(r.timeRange.start))
    ? { start: Number(r.timeRange.start), end: Number(r.timeRange.end) >= Number(r.timeRange.start) ? Number(r.timeRange.end) : Number(r.timeRange.start) }
    : { start: at - 5 * 60 * 1000, end: at }
  let pointId = '', frameId = '', trendKey = '', alarmId = ''
  if (kind === 'point') pointId = String(r.pointId || '')
  else if (kind === 'frame') frameId = String(r.frameId || '')
  else if (kind === 'alarm') alarmId = String(r.alarmId || '')
  else if (kind === 'trend') {
    trendKey = String(r.trendKey || '')
    pointId = String(r.pointId || '')
  } else pointId = String(r.pointId || '')
  const id = pointId || frameId || trendKey || alarmId || String(r.connectionId || '') || String(r.deviceId || '')
  return {
    kind,
    id,
    connectionId: String(r.connectionId || ''),
    deviceId: String(r.deviceId || ''),
    pointId,
    frameId,
    trendKey,
    alarmId,
    at,
    version: Number(r.configVersion) > 0 ? Number(r.configVersion) : 1,
    timeRange,
  }
}

// Task4/0.18.2: evidence POST must surface CONFIG_DRIFT / TARGET_MISMATCH reasons,
// never a silent .catch(() => {}). onFail receives the human reason.
export function postEvidence(post, cwd, evidence, onFail) {
  if (typeof post !== 'function' || !cwd) return Promise.resolve(null)
  const list = Array.isArray(evidence) ? evidence : (evidence ? [evidence] : [])
  if (!list.length) return Promise.resolve(null)
  return post('/dsh-vision-bench/evidence', { cwd, evidence: list }, 15000)
    .then((data) => {
      if (data && data.ok === false) {
        if (typeof onFail === 'function') {
          onFail(((data.errorCode && data.errorCode !== 'CONFIG_DRIFT' && data.errorCode !== 'TARGET_MISMATCH') ? '' : (data.errorCode ? data.errorCode + ': ' : '')) + (data.error || '证据保存失败'))
        }
      }
      return data
    })
    .catch((err) => {
      if (typeof onFail === 'function') onFail('证据保存失败: ' + String((err && err.message) || err))
      return null
    })
}

export function agentRefToText(ref) {
  const range = ref && ref.timeRange ? (' [' + new Date(ref.timeRange.start).toISOString() + ' → ' + new Date(ref.timeRange.end).toISOString() + ']') : ''
  const ids = [ref.connectionId, ref.deviceId, ref.pointId || ref.frameId || ref.alarmId || ref.trendKey].filter(Boolean).join('/')
  return '[' + (ref.kind || 'ref') + '] ' + (ids || 'unknown') + ' v' + (ref.configVersion || 3) + range
}

export function copyAgentRef(ref) {
  const text = JSON.stringify(ref, null, 2)
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
      return true
    }
  } catch {}
  return false
}

// Task5/0.18.2: Session Agent input bridge. dispatchAgentRef is a PURE command:
// the bridge carries { currentDraft, setDraft, submit } and no React hook is ever
// called inside dispatch (hooks are read at component render top level only).

// Read the draft via the harness reader hook — call this at the TOP of a render,
// never inside an event handler (prevents Invalid Hook Call).
export function readInputDraft(useInput) {
  if (typeof useInput !== 'function') return ''
  try {
    const v = useInput((s) => (s && s.draft) || '')
    return typeof v === 'string' ? v : ''
  } catch {
    return ''
  }
}

// Resolve writer actions from harness props; keep reader value out of dispatch.
export function buildInputBridge(props, currentDraft) {
  const actions = (props && props.inputActions) || (props && props.session && props.session.inputActions) || null
  return {
    currentDraft: typeof currentDraft === 'string' ? currentDraft : '',
    setDraft: actions && typeof actions.setDraft === 'function' ? actions.setDraft : null,
    submit: actions && typeof actions.submit === 'function' ? actions.submit : null,
  }
}

export function dispatchAgentRef(ref, bridge, opts) {
  const t = JSON.stringify(ref, null, 2)
  const b = bridge || {}
  const hasWriter = typeof b.setDraft === 'function'
  if (hasWriter) {
    try {
      // 追加规则：不覆盖用户已有文本，换行后接序列化引用
      const cur = typeof b.currentDraft === 'string' ? b.currentDraft : ''
      const next = cur ? cur + '\n' + t : t
      b.setDraft(next)
      if (opts && opts.send && typeof b.submit === 'function') {
        try {
          b.submit()
          return { mode: 'sent', ok: true, status: '已发送', text: t }
        } catch {}
      }
      return { mode: 'input', ok: true, status: '已加入输入框', text: t }
    } catch {}
  }
  // 无写接口 → 剪贴板回退
  const ok = copyAgentRef(ref)
  return { mode: ok ? 'copied' : 'failed', ok, status: ok ? '仅复制' : '处理失败', text: t, fallback: true }
}
export const hasHarnessInput = (p) => !!(p && (
  (p.inputActions && typeof p.inputActions.setDraft === 'function')
  || (p.session && p.session.inputActions && typeof p.session.inputActions.setDraft === 'function')
))
// Badge vs抢焦点：后台任务仅角标，不自动切换 Tab
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
  if (focusState && focusState.badgeOnly) return false
  if (task && task.foreground === false) return false
  if (task && task.badgeOnly) return false
  return isForegroundTask(task)
}

export function shouldHighlightFocus(focusState) {
  if (!focusState || !focusState.request) return false
  if (focusState.badgeOnly) return false
  return true
}

export function lineKind(line) {
  if (/(assert|panic|fault|hardfault|error|错误|失败|exception)/i.test(line)) return 'err'
  if (/(warn|警告)/i.test(line)) return 'warn'
  return ''
}
