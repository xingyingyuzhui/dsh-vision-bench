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

// One shared /state poller per cwd instead of six independent loops.
const STATE_BUS = { cwd: '', data: null, subs: new Set(), timer: 0, seq: 0 }

// Modbus frame stream per connection (framesByConnection). Ring buffer keyed by cwd+connId;
// fed by read / write / poll responses from any surface (HMI actions and the live polling loop).
// Supports overloaded legacy signature pushFramesLog(cwd, logArray) for backward compat.
const FRAME_LOGS = { cwd: '', byConn: {} }
const FRAME_LOG_CAP = 500

function ensureFrameCwd(cwd) {
  if (FRAME_LOGS.cwd !== cwd) {
    FRAME_LOGS.cwd = cwd
    FRAME_LOGS.byConn = {}
  }
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
  ensureFrameCwd(cwd)
  if (!FRAME_LOGS.byConn[cid]) FRAME_LOGS.byConn[cid] = []
  const arr = Array.isArray(list) ? list : []
  for (const entry of arr) {
    if (!entry) continue
    const at = Number(entry.t) || Date.now()
    const cidNorm = String(entry.connectionId || cid || '')
    const fid = String(entry.id || entry.frameId || (cidNorm ? (cidNorm + ':' + at + ':' + String(entry.label || '').slice(0, 8)) : ('f:' + at)))
    FRAME_LOGS.byConn[cid].push({
      id: fid,
      frameId: fid,
      t: at,
      deviceName: String(entry.deviceName || ''),
      label: String(entry.label || ''),
      request: String(entry.request || ''),
      response: String(entry.response || ''),
      trace: Array.isArray(entry.trace) ? entry.trace.map((s) => String(s).slice(0, 200)).slice(0, 8) : [],
      connectionId: cidNorm,
      deviceId: String(entry.deviceId || ''),
    })
  }
  if (FRAME_LOGS.byConn[cid].length > FRAME_LOG_CAP) {
    FRAME_LOGS.byConn[cid].splice(0, FRAME_LOGS.byConn[cid].length - FRAME_LOG_CAP)
  }
}

export function getFramesLog(cwd, connId) {
  if (FRAME_LOGS.cwd !== cwd) return []
  if (connId === undefined || connId === null || connId === '' || connId === 'all') {
    const all = []
    for (const arr of Object.values(FRAME_LOGS.byConn)) all.push(...arr)
    all.sort((a, b) => (Number(a.t) || 0) - (Number(b.t) || 0))
    // cap aggregated to 500 most recent across all conns
    if (all.length > FRAME_LOG_CAP) return all.slice(all.length - FRAME_LOG_CAP)
    return all
  }
  return FRAME_LOGS.byConn[connId] ? FRAME_LOGS.byConn[connId].slice() : []
}

export function clearFramesLog(cwd, connId) {
  if (FRAME_LOGS.cwd !== cwd) return
  if (connId === undefined || connId === null || connId === '' || connId === 'all') {
    FRAME_LOGS.byConn = {}
  } else {
    delete FRAME_LOGS.byConn[connId]
  }
}

export function framesLogCount(cwd, connId) {
  if (FRAME_LOGS.cwd !== cwd) return 0
  if (connId) return (FRAME_LOGS.byConn[connId] || []).length
  let n = 0
  for (const arr of Object.values(FRAME_LOGS.byConn)) n += arr.length
  return n
}

function busPull(post) {
  const seq = ++STATE_BUS.seq
  post('/dsh-vision-bench/state', { cwd: STATE_BUS.cwd }).then((data) => {
    if (seq !== STATE_BUS.seq) return
    STATE_BUS.data = data
    for (const sub of STATE_BUS.subs) {
      try { sub(data) } catch { /* subscriber errors stay isolated */ }
    }
  }).catch(() => { /* next tick retries */ })
}

export function subscribeState(post, cwd, cb) {
  if (!cwd) {
    cb(null)
    return function () {}
  }
  if (STATE_BUS.cwd !== cwd) {
    STATE_BUS.cwd = cwd
    STATE_BUS.data = null
    clearInterval(STATE_BUS.timer)
    busPull(post)
    STATE_BUS.timer = setInterval(() => busPull(post), POLL_MS)
  }
  if (STATE_BUS.data) cb(STATE_BUS.data)
  STATE_BUS.subs.add(cb)
  return function () {
    STATE_BUS.subs.delete(cb)
  }
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

// ── Agent focus / highlight / temp watch / evidence ────────────────────────

const FOCUS_STATE = { cwd: '', request: null, prev: null, tempWatchIds: [], badgeOnly: false, evidence: [], subs: new Set() }

export function getFocusState(cwd) {
  if (FOCUS_STATE.cwd !== cwd) return { request: null, prev: null, tempWatchIds: [], badgeOnly: false, evidence: [] }
  return { request: FOCUS_STATE.request, prev: FOCUS_STATE.prev, tempWatchIds: FOCUS_STATE.tempWatchIds.slice(), badgeOnly: !!FOCUS_STATE.badgeOnly, evidence: FOCUS_STATE.evidence.slice() }
}

export function setFocusState(cwd, focus) {
  FOCUS_STATE.cwd = cwd || ''
  if (!focus || typeof focus !== 'object') {
    FOCUS_STATE.request = null
    FOCUS_STATE.prev = null
    FOCUS_STATE.tempWatchIds = []
    FOCUS_STATE.badgeOnly = false
    FOCUS_STATE.evidence = []
  } else {
    FOCUS_STATE.request = focus.request || null
    FOCUS_STATE.prev = focus.prev || null
    FOCUS_STATE.tempWatchIds = Array.isArray(focus.tempWatchIds) ? focus.tempWatchIds.slice(0, 32) : []
    FOCUS_STATE.badgeOnly = !!focus.badgeOnly
    FOCUS_STATE.evidence = Array.isArray(focus.evidence) ? focus.evidence.slice(0, 20) : []
  }
  for (const sub of FOCUS_STATE.subs) {
    try { sub(getFocusState(cwd)) } catch {}
  }
}

export function subscribeFocus(cwd, cb) {
  if (typeof cb !== 'function') return function () {}
  FOCUS_STATE.subs.add(cb)
  return function () { FOCUS_STATE.subs.delete(cb) }
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
export function buildAgentRef(kind, payload, opts) {
  const now = Date.now()
  const base = {
    kind: String(kind || 'point'),
    at: now,
    configVersion: opts && opts.configVersion != null ? Number(opts.configVersion) : 3,
  }
  if (payload && typeof payload === 'object') {
    base.connectionId = String(payload.connectionId || payload.connId || opts?.connectionId || '').slice(0, 64)
    base.deviceId = String(payload.deviceId || opts?.deviceId || '').slice(0, 64)
    base.pointId = String(payload.pointId || payload.id || opts?.pointId || '').slice(0, 64)
    base.frameId = String(payload.frameId || opts?.frameId || '').slice(0, 64)
    base.alarmId = String(payload.alarmId || opts?.alarmId || '').slice(0, 64)
    if (payload.start != null || payload.end != null) {
      base.timeRange = {
        start: Number(payload.start ?? opts?.start ?? (now - 5 * 60 * 1000)),
        end: Number(payload.end ?? opts?.end ?? now),
      }
    } else if (opts && (opts.start != null || opts.end != null)) {
      base.timeRange = { start: Number(opts.start ?? (now - 5 * 60 * 1000)), end: Number(opts.end ?? now) }
    }
    // Include human label if available
    if (payload.name || payload.label) base.label = String(payload.name || payload.label).slice(0, 80)
  }
  return base
}

export function agentRefToText(ref) {
  const range = ref && ref.timeRange ? (' [' + new Date(ref.timeRange.start).toISOString() + ' → ' + new Date(ref.timeRange.end).toISOString() + ']') : ''
  const ids = [ref.connectionId, ref.deviceId, ref.pointId || ref.frameId || ref.alarmId].filter(Boolean).join('/')
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

// Badge vs抢焦点：后台任务仅角标，不自动切换 Tab
export function isForegroundTask(task) {
  if (!task || typeof task !== 'object') return false
  // Agent 的轮询/读点等背景任务 badgeOnly
  if (task.source === 'agent' && (task.type === 'read' || task.type === 'poll')) return false
  // 已标记 badgeOnly 的 focus 请求也不抢焦点
  return true
}

export function shouldStealFocus(task, focusState) {
  if (focusState && focusState.badgeOnly) return false
  return isForegroundTask(task)
}

export function lineKind(line) {
  if (/(assert|panic|fault|hardfault|error|错误|失败|exception)/i.test(line)) return 'err'
  if (/(warn|警告)/i.test(line)) return 'warn'
  return ''
}
