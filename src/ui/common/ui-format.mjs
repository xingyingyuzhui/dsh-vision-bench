// UI formatting helpers (split from bench-shared).
import { statusKind } from '../../../bench-settings.mjs'
export { clockOf } from '../../../bench-points.mjs'

export function emptyWorkspace() {
  return {
    keil: { project: '', target: '', artifact: 'hex' },
    modbus: {
      version: 2,
      conn: {
        mode: 'rtu',
        port: '',
        baudrate: 9600,
        bytesize: 8,
        parity: 'N',
        stopbits: 1,
        host: '',
        tcpPort: 502,
        sim: false,
      },
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
  if (data?.journal) return data.journal
  const workspace = data?.workspace
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

export function formatErrorMessage(err, fallback = '') {
  if (!err) return ''
  if (typeof err === 'string') return err
  if (typeof err === 'object') {
    if (typeof err.message === 'string' && err.message) return err.message
    if (typeof err.error === 'string' && err.error) return err.error
    if (typeof err.code === 'string' && err.code) return err.code
    try {
      return JSON.stringify(err)
    } catch {
      return String(err)
    }
  }
  return String(err || fallback)
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
  return el('div', { className: 'dvb-row' }, el('div', { className: 'dvb-label' }, el('span', null, label)), control)
}

export function statusBar(el, t, cwd, rows) {
  return el(
    'div',
    { className: 'dvb-bar' },
    el(
      'div',
      { className: 'dvb-health' },
      rows.map((row) =>
        el(
          'span',
          {
            key: row.key,
            className: 'dvb-chip',
            'data-kind': row.kind || statusKind(row.health),
          },
          row.text || `${t(row.key)} · ${t(statusKind(row.health))}`,
        ),
      ),
    ),
    cwd
      ? el('div', { className: 'dvb-cwd' }, `${t('workspace')}  ${cwd}`)
      : el('div', { className: 'dvb-msg', 'data-kind': 'err' }, t('needWorkspace')),
  )
}

export function visionCollabBar(el, t, opts) {
  const cwd = opts?.cwd || ''
  const workspace = opts?.workspace || {}
  const journal = opts?.journal || { tasks: [], running: [], timeline: [] }
  const pendingWrites = opts?.pendingWrites || opts?.pending || []
  const sessionId = opts?.sessionId || ''
  // Task7/0.19.2: Vision 服务当前 Session — boundId 仅做读取兼容，不再展示
  const running = journal.running || []
  const pendingCount = Array.isArray(pendingWrites) ? pendingWrites.length : 0
  const manualPending = (workspace.manualRequests || []).filter((m) => m.status === 'pending').length
  const runningCount = running.length
  if (!cwd && !runningCount && !pendingCount && !manualPending) return null
  return el(
    'div',
    { className: 'dvb-vision-bar' },
    el(
      'div',
      { className: 'dvb-vision-chips' },
      cwd ? el('span', { className: 'dvb-chip', title: cwd }, `${t('workspace')} ${cwd.slice(-32)}`) : null,
      runningCount ? el('span', { className: 'dvb-chip', 'data-kind': 'live' }, `任务 ${runningCount}`) : null,
      pendingCount ? el('span', { className: 'dvb-chip', 'data-kind': 'warn' }, `待确认 ${pendingCount}`) : null,
      manualPending ? el('span', { className: 'dvb-chip', 'data-kind': 'warn' }, `人工 ${manualPending}`) : null,
    ),
    el(
      'div',
      { className: 'dvb-vision-meta' },
      journal.tasks?.length ? el('span', { className: 'dvb-hint' }, `${t('tasks')} ${journal.tasks.length}`) : null,
    ),
  )
}

export function journalPanel(el, t, journal) {
  const tasks = journal && Array.isArray(journal.tasks) ? journal.tasks : []
  const timeline = journal && Array.isArray(journal.timeline) ? journal.timeline : []
  if (!tasks.length && !timeline.length) return null
  return el(
    'div',
    { className: 'dvb-journal' },
    tasks.length ? el('div', { className: 'dvb-journal-title' }, t('tasks')) : null,
    tasks.slice(0, 6).map((item) =>
      el(
        'div',
        {
          key: item.id,
          className: 'dvb-task',
          'data-status': item.status,
          'data-source': item.source,
        },
        el('span', { className: 'dvb-badge' }, formatClock(item.startedAt)),
        el('span', { className: 'dvb-badge', 'data-source': item.source }, sourceLabel(t, item.source)),
        el('span', null, typeLabel(t, item.type)),
        el('span', { className: 'dvb-badge' }, statusLabel(t, item.status)),
        el(
          'span',
          {
            className: 'dvb-hint',
            title: [item.logFile, item.phase]
              .concat(Array.isArray(item.errors) ? item.errors : [])
              .filter(Boolean)
              .join('\n'),
          },
          item.summary || item.errors?.[0] || '',
        ),
        item.frames && (item.frames.request || item.frames.response)
          ? el(
              'div',
              { className: 'dvb-frames', title: (item.frames.trace || []).join('\n') },
              item.frames.request ? el('div', null, `→ ${item.frames.request}`) : null,
              item.frames.response ? el('div', null, `← ${item.frames.response}`) : null,
            )
          : null,
      ),
    ),
    timeline.length ? el('div', { className: 'dvb-journal-title' }, t('timeline')) : null,
    timeline.slice(0, 8).map((item) =>
      el(
        'div',
        {
          key: item.id,
          className: 'dvb-event',
          'data-source': item.source,
          'data-ok': item.ok === false ? 'false' : item.ok === true ? 'true' : '',
        },
        el('span', { className: 'dvb-badge' }, formatClock(item.at)),
        el('span', { className: 'dvb-badge', 'data-source': item.source }, sourceLabel(t, item.source)),
        el('span', { className: 'dvb-hint' }, item.summary || item.kind),
      ),
    ),
  )
}

export function lineKind(line) {
  if (/(assert|panic|fault|hardfault|error|错误|失败|exception)/i.test(line)) return 'err'
  if (/(warn|警告)/i.test(line)) return 'warn'
  return ''
}
