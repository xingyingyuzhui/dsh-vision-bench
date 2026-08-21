export const MAX_TASKS = 20
export const MAX_TIMELINE = 120
export const MAX_TIMELINE_MINOR = 60

const TASK_TYPES = {
  build: { label: '编译' },
  read: { label: '读点' },
  write: { label: '写点' },
  download: { label: '下载' },
  verify: { label: '验证' },
}
const TASK_TYPE_KEYS = new Set(Object.keys(TASK_TYPES))
const SOURCES = new Set(['user', 'agent', 'system'])
const STATUSES = new Set(['running', 'ok', 'error', 'cancelled'])

export const taskTypeLabel = (type) => {
  const meta = TASK_TYPES[type]
  return meta ? meta.label : String(type || '任务')
}

export const isTaskType = (type) => TASK_TYPE_KEYS.has(type)

// Timeline kinds marked major survive minor-trimming when the list runs over budget.
const MAJOR_KINDS = new Set([
  'select-project',
  'sweep',
  'build-end',
  'write-end',
  'download-end',
  'verify-end',
])

export const isMajorKind = (kind) => MAJOR_KINDS.has(String(kind || ''))

export const trimTimeline = (list, max = MAX_TIMELINE, minorBudget = MAX_TIMELINE_MINOR) => {
  let events = Array.isArray(list) ? list.slice(0, max * 3) : []
  if (events.length <= max) return events
  const minors = events.filter((item) => item && !isMajorKind(item.kind)).length
  let dropMinor = Math.min(minors, Math.max(0, events.length - max))
  const keepMinor = Math.max(0, minors - dropMinor)
  const out = []
  let seenMinor = 0
  for (let i = events.length - 1; i >= 0; i--) {
    const item = events[i]
    if (!item) continue
    if (!isMajorKind(item.kind)) {
      seenMinor += 1
      if (seenMinor <= keepMinor) out.push(item)
      continue
    }
    out.push(item)
  }
  events = out.reverse()
  dropMinor = 0
  while (events.length > max) {
    const idx = events.findIndex((item) => !isMajorKind(item.kind))
    if (idx < 0) break
    events.splice(idx, 1)
    dropMinor += 1
  }
  return events.slice(0, max)
}

export const newId = (prefix) =>
  prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

const text = (value, fallback) => {
  const out = typeof value === 'string' ? value.trim() : ''
  return out || fallback || ''
}

export const normalizeOrigin = (input) => ({
  source: SOURCES.has(input && input.source) ? input.source : 'user',
  sessionId: text(input && input.sessionId, ''),
})

const normalizeFrames = (input) => {
  if (!input || typeof input !== 'object') return null
  const trace = Array.isArray(input.trace)
    ? input.trace.map((line) => text(line, '').slice(0, 200)).filter(Boolean).slice(0, 8)
    : []
  const request = text(input.request, '').slice(0, 200)
  const response = text(input.response, '').slice(0, 200)
  if (!trace.length && !request && !response) return null
  return { request, response, trace }
}

export const normalizeTask = (input) => {
  const startedAt = Number(input && input.startedAt)
  const endedAt = Number(input && input.endedAt)
  const status = STATUSES.has(input && input.status) ? input.status : 'error'
  const progress = Number(input && input.progress)
  return {
    id: text(input && input.id, newId('t')),
    type: TASK_TYPE_KEYS.has(input && input.type) ? input.type : 'build',
    source: SOURCES.has(input && input.source) ? input.source : 'user',
    sessionId: text(input && input.sessionId, ''),
    status,
    startedAt: Number.isFinite(startedAt) && startedAt > 0 ? startedAt : Date.now(),
    endedAt: Number.isFinite(endedAt) && endedAt > 0 ? endedAt : null,
    summary: text(input && input.summary, '').slice(0, 240),
    logFile: text(input && input.logFile, '').slice(0, 260),
    phase: text(input && input.phase, '').slice(0, 32),
    stage: text(input && input.stage, '').slice(0, 32),
    progress: Number.isFinite(progress) && progress >= 0 && progress <= 100 ? Math.trunc(progress) : null,
    frames: normalizeFrames(input && input.frames),
    errors: Array.isArray(input && input.errors)
      ? input.errors.map((item) => String(item || '').slice(0, 240)).filter(Boolean).slice(0, 8)
      : [],
  }
}

export const normalizeTimelineEvent = (input) => {
  const at = Number(input && input.at)
  return {
    id: text(input && input.id, newId('e')),
    at: Number.isFinite(at) && at > 0 ? at : Date.now(),
    kind: text(input && input.kind, 'event'),
    source: SOURCES.has(input && input.source) ? input.source : 'user',
    sessionId: text(input && input.sessionId, ''),
    taskId: text(input && input.taskId, ''),
    ok: input && input.ok === true ? true : input && input.ok === false ? false : null,
    summary: text(input && input.summary, '').slice(0, 240),
  }
}

export const normalizeTasks = (list) => {
  if (!Array.isArray(list)) return []
  return list.map(normalizeTask).slice(0, MAX_TASKS)
}

export const normalizeTimeline = (list) => {
  if (!Array.isArray(list)) return []
  return trimTimeline(list.map(normalizeTimelineEvent))
}

export const prepend = (list, item, max) => [item].concat(Array.isArray(list) ? list : []).slice(0, max)

export const runningTasks = (tasks) =>
  (Array.isArray(tasks) ? tasks : []).filter((item) => item && item.status === 'running')

export const compactTasks = (tasks) =>
  (Array.isArray(tasks) ? tasks : []).slice(0, 8).map((item) => ({
    id: item.id,
    type: item.type,
    source: item.source,
    sessionId: item.sessionId,
    status: item.status,
    startedAt: item.startedAt,
    endedAt: item.endedAt,
    summary: item.summary,
    logFile: item.logFile || '',
    phase: item.phase || '',
    stage: item.stage || '',
    progress: item.progress === null || item.progress === undefined ? null : item.progress,
    frames: item.frames || null,
    errors: Array.isArray(item.errors) ? item.errors : [],
  }))

export const compactTimeline = (timeline) =>
  (Array.isArray(timeline) ? timeline : []).slice(0, 12).map((item) => ({
    id: item.id,
    at: item.at,
    kind: item.kind,
    source: item.source,
    sessionId: item.sessionId,
    taskId: item.taskId,
    ok: item.ok,
    summary: item.summary,
  }))
