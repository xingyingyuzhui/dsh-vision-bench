export const MAX_TASKS = 20
export const MAX_TIMELINE = 50
const TASK_TYPES = new Set(['build', 'read'])
const SOURCES = new Set(['user', 'agent'])
const STATUSES = new Set(['running', 'ok', 'error'])

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

export const normalizeTask = (input) => {
  const startedAt = Number(input && input.startedAt)
  const endedAt = Number(input && input.endedAt)
  const status = STATUSES.has(input && input.status) ? input.status : 'error'
  return {
    id: text(input && input.id, newId('t')),
    type: TASK_TYPES.has(input && input.type) ? input.type : 'build',
    source: SOURCES.has(input && input.source) ? input.source : 'user',
    sessionId: text(input && input.sessionId, ''),
    status,
    startedAt: Number.isFinite(startedAt) && startedAt > 0 ? startedAt : Date.now(),
    endedAt: Number.isFinite(endedAt) && endedAt > 0 ? endedAt : null,
    summary: text(input && input.summary, '').slice(0, 240),
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
  return list.map(normalizeTimelineEvent).slice(0, MAX_TIMELINE)
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
