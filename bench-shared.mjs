// Shared client widgets and helpers for every conversation view.
// Everything here is explicitly imported by its consumers — no hidden
// strip-concat scope sharing.
import { clockOf } from './bench-points.mjs'
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
    modbus: { mode: 'rtu', port: '', baudrate: 9600, host: '', tcpPort: 502, slave: 1, function: 3, address: 0, count: 1, segments: [], values: [] },
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
