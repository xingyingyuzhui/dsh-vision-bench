import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { emptyLog, mergeLog, normalizeEvent } from './bench-prompt.mjs'
import { normalizeModbus, patchActiveDevice } from './bench-devices.mjs'
import { requireWorkspaceCwd } from './bench-paths.mjs'
import {
  MAX_TASKS,
  compactTasks,
  compactTimeline,
  newId,
  normalizeTask,
  normalizeTasks,
  normalizeTimeline,
  normalizeTimelineEvent,
  prepend,
  runningTasks,
  trimTimeline,
} from './bench-journal.mjs'

export const BINDING_KEYS = ['python', 'uv4', 'openocd']

const TIMELINE_WINDOW = 360

const pushEvent = (timeline, event) =>
  trimTimeline(prepend(timeline, event, TIMELINE_WINDOW))

export const emptyBindings = () => ({ python: '', uv4: '', openocd: '' })

export const defaultDshHome = (env = process.env, home = homedir()) =>
  env.DSH_HOME || join(home, '.dsh')

export const storeDir = (home) => join(home, 'vision-bench')

export const bindingsPath = (home) => join(storeDir(home), 'bindings.json')

export const normalizeBindings = (input) => {
  const out = emptyBindings()
  if (!input || typeof input !== 'object') return out
  for (const key of BINDING_KEYS) {
    const value = input[key]
    out[key] = typeof value === 'string' ? value.trim() : ''
  }
  return out
}

export const validateBindings = (bindings) => {
  const errors = []
  for (const key of BINDING_KEYS) {
    const value = bindings[key]
    if (value && !isAbsolute(value)) errors.push(key + ' 必须是绝对路径')
  }
  return errors
}

export const probePath = (value, exists = existsSync) => {
  if (!value) return { bound: false, exists: false }
  try {
    return { bound: true, exists: !!exists(value) }
  } catch {
    return { bound: true, exists: false }
  }
}

export const probeBindings = (bindings, exists = existsSync) => {
  const health = {}
  for (const key of BINDING_KEYS) health[key] = probePath(bindings[key], exists)
  return health
}

export const loadBindings = (home) => {
  try {
    return normalizeBindings(JSON.parse(readFileSync(bindingsPath(home), 'utf8')))
  } catch {
    return emptyBindings()
  }
}

export const saveBindings = (home, input) => {
  const bindings = normalizeBindings(input)
  const errors = validateBindings(bindings)
  if (errors.length > 0) {
    return { ok: false, error: errors.join('；'), bindings }
  }
  mkdirSync(storeDir(home), { recursive: true })
  writeFileSync(bindingsPath(home), JSON.stringify(bindings, null, 2) + '\n')
  return { ok: true, bindings }
}

export const emptyWorkspace = () => ({
  keil: { project: '', target: '', artifact: 'hex', download: '' },
  log: emptyLog(),
  tasks: [],
  timeline: [],
  session: { boundId: '' },
  modbus: normalizeModbus({}),
})

export const workspaceKey = (cwd) =>
  createHash('sha256').update(String(cwd || '')).digest('hex').slice(0, 16)

export const workspacePath = (home, cwd) =>
  join(storeDir(home), 'workspaces', workspaceKey(cwd) + '.json')

export const normalizeWorkspace = (input) => {
  const out = emptyWorkspace()
  const keil = input && input.keil && typeof input.keil === 'object' ? input.keil : {}
  const modbus = input && input.modbus && typeof input.modbus === 'object' ? input.modbus : {}
  out.keil.project = typeof keil.project === 'string' ? keil.project.trim() : ''
  out.keil.target = typeof keil.target === 'string' ? keil.target.trim() : ''
  const artifact = typeof keil.artifact === 'string' ? keil.artifact.trim().toLowerCase() : 'hex'
  out.keil.artifact = ['hex', 'bin', 'axf', 'elf'].indexOf(artifact) >= 0 ? artifact : 'hex'
  out.keil.download = typeof keil.download === 'string' ? keil.download.trim() : ''
  const rawLog = input && Array.isArray(input.log) ? input.log : []
  out.log = rawLog.map(normalizeEvent).slice(0, 8)
  out.tasks = normalizeTasks(input && input.tasks)
  out.timeline = normalizeTimeline(input && input.timeline)
  const session = input && input.session && typeof input.session === 'object' ? input.session : {}
  out.session = { boundId: typeof session.boundId === 'string' ? session.boundId.trim() : '' }
  out.modbus = normalizeModbus(modbus)
  return out
}

export const loadWorkspace = (home, cwd) => {
  try {
    return normalizeWorkspace(JSON.parse(readFileSync(workspacePath(home, cwd), 'utf8')))
  } catch {
    return emptyWorkspace()
  }
}

export const saveWorkspace = (home, cwd, input) => {
  const prev = loadWorkspace(home, cwd)
  const incoming = (input && input.modbus) || {}
  const switched = incoming.activeId
    ? { ...prev.modbus, activeId: incoming.activeId }
    : prev.modbus
  const mergedModbus = Array.isArray(incoming.devices)
    ? { ...switched, ...incoming, devices: incoming.devices }
    : (Object.keys(incoming).some((key) => key !== 'activeId' && key !== 'devices')
      ? patchActiveDevice(switched, incoming)
      : switched)
  const merged = {
    keil: { ...prev.keil, ...(input && input.keil) },
    modbus: mergedModbus,
    log: input && input.log !== undefined ? input.log : prev.log,
    tasks: input && input.tasks !== undefined ? input.tasks : prev.tasks,
    timeline: input && input.timeline !== undefined ? input.timeline : prev.timeline,
    session: { ...prev.session, ...(input && input.session) },
  }
  const workspace = normalizeWorkspace(merged)
  const keilProject = workspace.keil.project
  if (keilProject && !isAbsolute(keilProject)) {
    return { ok: false, error: 'keil.project 必须是绝对路径', workspace }
  }
  if (keilProject && keilProject !== (prev.keil && prev.keil.project)) {
    const summary = '选择工程 ' + keilProject
    const origin = {
      source: input && input.origin && input.origin.source === 'agent' ? 'agent' : 'user',
      sessionId: input && input.origin && input.origin.sessionId ? String(input.origin.sessionId) : '',
    }
    workspace.log = mergeLog(workspace.log, {
      action: 'select-project',
      ok: true,
      summary,
    })
    workspace.timeline = pushEvent(workspace.timeline, normalizeTimelineEvent({
      kind: 'select-project',
      source: origin.source,
      sessionId: origin.sessionId,
      ok: true,
      summary,
    }))
  }
  mkdirSync(join(storeDir(home), 'workspaces'), { recursive: true })
  writeFileSync(workspacePath(home, cwd), JSON.stringify(workspace, null, 2) + '\n')
  return { ok: true, workspace, prev }
}

export const recordBenchEvent = (home, cwd, event, extra = {}) => {
  const prev = loadWorkspace(home, cwd)
  const timelineEvent = normalizeTimelineEvent({
    kind: event && event.action,
    source: extra.source || 'user',
    sessionId: extra.sessionId || '',
    taskId: extra.taskId || '',
    ok: event && event.ok,
    summary: event && event.summary,
  })
  return saveWorkspace(home, cwd, {
    ...prev,
    ...extra,
    keil: { ...prev.keil, ...(extra.keil || {}) },
    modbus: { ...prev.modbus, ...(extra.modbus || {}) },
    log: mergeLog(prev.log, event),
    timeline: pushEvent(prev.timeline, timelineEvent),
  })
}

export const openTask = (home, cwd, spec) => {
  const prev = loadWorkspace(home, cwd)
  const origin = {
    source: spec && spec.source === 'agent' ? 'agent' : 'user',
    sessionId: spec && spec.sessionId ? String(spec.sessionId) : '',
  }
  const task = normalizeTask({
    id: newId('t'),
    type: spec && spec.type,
    source: origin.source,
    sessionId: origin.sessionId,
    status: 'running',
    startedAt: Date.now(),
    summary: spec && spec.summary,
  })
  const event = normalizeTimelineEvent({
    kind: task.type + '-start',
    source: origin.source,
    sessionId: origin.sessionId,
    taskId: task.id,
    summary: task.summary || ('开始 ' + task.type),
  })
  saveWorkspace(home, cwd, {
    tasks: prepend(prev.tasks, task, MAX_TASKS),
    timeline: pushEvent(prev.timeline, event),
  })
  return task
}

export const finishTask = (home, cwd, taskId, patch) => {
  const prev = loadWorkspace(home, cwd)
  const status = patch && (patch.cancelled || patch.status === 'cancelled')
    ? 'cancelled'
    : (patch && patch.ok === false ? 'error' : 'ok')
  const summary = patch && patch.summary ? String(patch.summary).slice(0, 240) : ''
  const tasks = (prev.tasks || []).map((item) => {
    if (item.id !== taskId) return item
    return normalizeTask({
      ...item,
      status,
      endedAt: Date.now(),
      summary: summary || item.summary,
      logFile: patch && patch.logFile !== undefined ? patch.logFile : item.logFile,
      phase: patch && patch.phase !== undefined ? patch.phase : item.phase,
      stage: patch && patch.stage !== undefined ? patch.stage : item.stage,
      progress: patch && patch.progress !== undefined ? patch.progress : item.progress,
      errors: patch && patch.errors !== undefined ? patch.errors : item.errors,
    })
  })
  const current = tasks.find((item) => item.id === taskId)
  const type = current && current.type
  const action = type === 'build' || type === 'read' || type === 'write' ? type : 'task'
  const event = normalizeTimelineEvent({
    kind: (current && current.type || 'task') + '-end',
    source: current && current.source,
    sessionId: current && current.sessionId,
    taskId,
    ok: status === 'ok',
    summary: summary || (status === 'ok' ? '完成' : '失败'),
  })
  return saveWorkspace(home, cwd, {
    tasks,
    timeline: pushEvent(prev.timeline, event),
    keil: patch && patch.keil,
    modbus: patch && patch.modbus,
    log: patch && patch.log !== undefined ? patch.log : mergeLog(prev.log, {
      action,
      ok: status === 'ok',
      summary: summary || (status === 'ok' ? '完成' : '失败'),
    }),
  })
}

export const journalView = (workspace) => ({
  tasks: compactTasks(workspace && workspace.tasks),
  running: compactTasks(runningTasks(workspace && workspace.tasks)),
  timeline: compactTimeline(workspace && workspace.timeline),
})

export const bindSession = (home, cwd, sessionId) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const id = String(sessionId || '').trim()
  if (!id) return { ok: false, error: '缺少会话 id' }
  const saved = saveWorkspace(home, room.cwd, { session: { boundId: id } })
  if (!saved.ok) return saved
  return {
    ok: true,
    boundId: saved.workspace.session.boundId,
    prevBoundId: (saved.prev && saved.prev.session && saved.prev.session.boundId) || '',
  }
}

export const unbindSession = (home, cwd) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const saved = saveWorkspace(home, room.cwd, { session: { boundId: '' } })
  if (!saved.ok) return saved
  return { ok: true, boundId: '' }
}

export const sweepStaleTasks = (home) => {
  const dir = join(storeDir(home), 'workspaces')
  let files = []
  try {
    files = readdirSync(dir)
  } catch {
    return { ok: true, swept: 0 }
  }
  let swept = 0
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    const path = join(dir, file)
    try {
      const workspace = normalizeWorkspace(JSON.parse(readFileSync(path, 'utf8')))
      const stale = (workspace.tasks || []).filter((item) => item.status === 'running')
      if (!stale.length) continue
      const now = Date.now()
      const tasks = workspace.tasks.map((item) => item.status === 'running'
        ? normalizeTask({
          ...item,
          status: 'error',
          endedAt: now,
          summary: (item.summary || item.type + ' 任务') + '（上次运行中断）',
        })
        : item)
      const timeline = pushEvent(workspace.timeline, normalizeTimelineEvent({
        kind: 'sweep',
        source: 'system',
        ok: false,
        summary: '启动清扫：' + stale.length + ' 个中断任务已标记失败',
      }))
      writeFileSync(path, JSON.stringify({ ...workspace, tasks, timeline }, null, 2) + '\n')
      swept += stale.length
    } catch { /* skip unreadable workspace */ }
  }
  return { ok: true, swept }
}

export const pruneBuildLogs = (home, keep = 30) => {
  const dir = join(storeDir(home), 'logs')
  let entries = []
  try {
    entries = readdirSync(dir)
  } catch {
    return { ok: true, pruned: 0 }
  }
  const logs = []
  for (const name of entries) {
    if (!name.endsWith('.log')) continue
    try {
      const path = join(dir, name)
      logs.push({ path, mtime: statSync(path).mtimeMs })
    } catch { /* skip */ }
  }
  logs.sort((a, b) => b.mtime - a.mtime)
  let pruned = 0
  for (const log of logs.slice(Math.max(1, keep))) {
    try {
      unlinkSync(log.path)
      pruned += 1
    } catch { /* ignore */ }
  }
  return { ok: true, pruned }
}
