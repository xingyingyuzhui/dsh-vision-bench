import { readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeModbus } from '../../../bench-devices.mjs'
import {
  MAX_TASKS,
  capTasks,
  compactTasks,
  compactTimeline,
  hasRunning,
  newId,
  normalizeTask,
  normalizeTimelineEvent,
  prepend,
  runningTasks,
  trimTimeline,
} from '../../../bench-journal.mjs'
import { requireWorkspaceCwd } from '../../../bench-paths.mjs'
import { mergeLog } from '../../../bench-prompt.mjs'
import { resolveTarget } from '../../../bench-targets.mjs'
import { projectModbusForSession } from '../../application/modbus/config-scope-service.mjs'
import { isScopePartitioned } from '../../domain/modbus/config-scope.mjs'
import { ERROR_CODES } from '../../domain/modbus/errors.mjs'
import { createWorkspaceRepository } from '../persistence/workspace-repository.mjs'
import { storeDir } from './bindings-store.mjs'
import {
  applyWorkspacePatch,
  loadWorkspace,
  normalizeWorkspace,
  saveWorkspaceAsync,
  workspaceKey,
  workspaceRepository,
} from './workspace-store.mjs'

const TIMELINE_WINDOW = 360
const pushEvent = (timeline, event) => trimTimeline(prepend(timeline, event, TIMELINE_WINDOW))

export const recordBenchEvent = async (home, cwd, event, extra = {}) => {
  const timelineEvent = normalizeTimelineEvent({
    kind: event?.action,
    source: extra.source || 'user',
    sessionId: extra.sessionId || '',
    taskId: extra.taskId || '',
    ok: event?.ok,
    summary: event?.summary,
  })
  return workspaceRepository(home).update(cwd, null, async (current) => ({
    ok: true,
    workspace: normalizeWorkspace({
      ...current,
      ...extra,
      keil: { ...current.keil, ...(extra.keil || {}) },
      modbus: { ...current.modbus, ...(extra.modbus || {}) },
      log: mergeLog(current.log, event),
      timeline: pushEvent(current.timeline, timelineEvent),
    }),
  }))
}

export const openTask = async (home, cwd, spec) => {
  const origin = {
    source: spec && spec.source === 'agent' ? 'agent' : 'user',
    sessionId: spec?.sessionId ? String(spec.sessionId) : '',
  }
  const task = normalizeTask({
    id: newId('t'),
    type: spec?.type,
    source: origin.source,
    sessionId: origin.sessionId,
    status: 'running',
    startedAt: Date.now(),
    summary: spec?.summary,
  })
  const event = normalizeTimelineEvent({
    kind: `${task.type}-start`,
    source: origin.source,
    sessionId: origin.sessionId,
    taskId: task.id,
    summary: task.summary || `开始 ${task.type}`,
  })
  await workspaceRepository(home).update(cwd, null, async (current) => ({
    ok: true,
    workspace: normalizeWorkspace({
      ...current,
      tasks: capTasks(prepend(current.tasks, task, MAX_TASKS * 3)),
      timeline: pushEvent(current.timeline, event),
    }),
  }))
  return task
}

export const openExclusiveTask = async (home, cwd, spec, opts = {}) => {
  const origin = {
    source: spec && spec.source === 'agent' ? 'agent' : 'user',
    sessionId: spec?.sessionId ? String(spec.sessionId) : '',
  }
  const task = normalizeTask({
    id: newId('t'),
    type: spec?.type,
    source: origin.source,
    sessionId: origin.sessionId,
    status: 'running',
    startedAt: Date.now(),
    summary: spec?.summary,
  })
  const event = normalizeTimelineEvent({
    kind: `${task.type}-start`,
    source: origin.source,
    sessionId: origin.sessionId,
    taskId: task.id,
    summary: task.summary || `开始 ${task.type}`,
  })
  const conflicts = Array.isArray(opts.conflicts) && opts.conflicts.length ? opts.conflicts : [task.type]
  const saved = await workspaceRepository(home).update(cwd, null, async (current) => {
    for (const type of conflicts) {
      if (hasRunning(current, type)) {
        return {
          ok: false,
          errorCode: ERROR_CODES.TASK_CONFLICT,
          error: type === 'download' ? '已有烧录任务进行中' : '已有编译任务进行中',
        }
      }
    }
    return {
      ok: true,
      workspace: normalizeWorkspace({
        ...current,
        tasks: capTasks(prepend(current.tasks, task, MAX_TASKS * 3)),
        timeline: pushEvent(current.timeline, event),
      }),
    }
  })
  if (!saved || saved.ok === false) {
    return {
      ok: false,
      errorCode: saved?.errorCode ? saved.errorCode : ERROR_CODES.TASK_CONFLICT,
      error: saved?.error || '任务冲突',
    }
  }
  return { ok: true, task }
}

export const finishTask = async (home, cwd, taskId, patch) => {
  const status =
    patch && (patch.cancelled || patch.status === 'cancelled')
      ? 'cancelled'
      : patch && patch.ok === false
        ? 'error'
        : 'ok'
  const summary = patch?.summary ? String(patch.summary).slice(0, 240) : ''
  return workspaceRepository(home).update(cwd, null, async (prev) => {
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
        frames: patch && patch.frames !== undefined ? patch.frames : item.frames,
        errors: patch && patch.errors !== undefined ? patch.errors : item.errors,
      })
    })
    const current = tasks.find((item) => item.id === taskId)
    const type = current?.type
    const action = type === 'build' || type === 'read' || type === 'write' ? type : 'task'
    const event = normalizeTimelineEvent({
      kind: `${current?.type || 'task'}-end`,
      source: current?.source,
      sessionId: current?.sessionId,
      taskId,
      ok: status === 'ok',
      summary: summary || (status === 'ok' ? '完成' : '失败'),
    })
    return applyWorkspacePatch(prev, {
      tasks,
      timeline: pushEvent(prev.timeline, event),
      keil: patch?.keil,
      modbus: patch?.modbus,
      log:
        patch && patch.log !== undefined
          ? patch.log
          : mergeLog(prev.log, {
              action,
              ok: status === 'ok',
              summary: summary || (status === 'ok' ? '完成' : '失败'),
            }),
    })
  })
}

export const journalView = (workspace) => ({
  tasks: compactTasks(workspace?.tasks),
  running: compactTasks(runningTasks(workspace?.tasks)),
  timeline: compactTimeline(workspace?.timeline),
})

export const bindSession = async (home, cwd, sessionId) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const id = String(sessionId || '').trim()
  if (!id) return { ok: false, error: '缺少会话 id' }
  const saved = await saveWorkspaceAsync(home, room.cwd, { session: { boundId: id } })
  if (!saved.ok) return saved
  return {
    ok: true,
    boundId: saved.workspace.session.boundId,
    prevBoundId: saved.prev?.session?.boundId || '',
  }
}

const touchedSessionCache = new Map()

export const touchServiceSession = async (home, cwd, sessionId) => {
  const id = typeof sessionId === 'string' ? sessionId.trim() : ''
  if (!id || !cwd) return { ok: false, skipped: 'no-session' }
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const cacheKey = `${home}:${room.cwd}`
  const cached = touchedSessionCache.get(cacheKey)
  if (cached && cached.boundId === id && Date.now() - cached.touchedAt < 5000) {
    return { ok: true, boundId: id, unchanged: true }
  }
  const prev = loadWorkspace(home, room.cwd)
  const cur = prev?.session?.boundId ? prev.session.boundId : ''
  if (cur === id) {
    touchedSessionCache.set(cacheKey, { boundId: id, touchedAt: Date.now() })
    return { ok: true, boundId: id, unchanged: true }
  }
  const res = await bindSession(home, room.cwd, id)
  if (res?.ok) {
    touchedSessionCache.set(cacheKey, { boundId: id, touchedAt: Date.now() })
  }
  return res
}

export const unbindSession = async (home, cwd) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  touchedSessionCache.delete(`${home}:${room.cwd}`)
  const saved = await saveWorkspaceAsync(home, room.cwd, { session: { boundId: '' } })
  if (!saved.ok) return saved
  return { ok: true, boundId: '' }
}

export const createManualRequest = async (home, cwd, spec) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const text = typeof spec?.text === 'string' ? spec.text.trim().slice(0, 240) : ''
  if (!text) return { ok: false, error: '缺少请求内容' }
  const request = {
    id: newId('mr'),
    text,
    status: 'pending',
    createdAt: Date.now(),
    sessionId: typeof spec?.sessionId === 'string' ? spec.sessionId.trim() : '',
  }
  const saved = await workspaceRepository(home).update(room.cwd, null, async (prev) =>
    applyWorkspacePatch(prev, {
      manualRequests: prepend(prev.manualRequests, request, 20),
      timeline: pushEvent(
        prev.timeline,
        normalizeTimelineEvent({
          kind: 'manual-request',
          source: spec && spec.source === 'agent' ? 'agent' : 'user',
          sessionId: request.sessionId,
          summary: `请求人工操作：${text}`,
        }),
      ),
    }),
  )
  if (!saved.ok) return saved
  return { ok: true, request }
}

export const resolveManualRequest = async (home, cwd, id, done) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  let request = null
  const saved = await workspaceRepository(home).update(room.cwd, null, async (prev) => {
    const current = (prev.manualRequests || []).find(
      (item) => item.id === String(id || '') && item.status === 'pending',
    )
    if (!current) return { ok: false, error: '请求不存在或已处理' }
    const status = done ? 'done' : 'rejected'
    request = { ...current, status }
    const manualRequests = (prev.manualRequests || []).map((item) =>
      item.id === current.id ? { ...item, status } : item,
    )
    return applyWorkspacePatch(prev, {
      manualRequests,
      timeline: pushEvent(
        prev.timeline,
        normalizeTimelineEvent({
          kind: 'manual-done',
          source: 'user',
          sessionId: current.sessionId,
          ok: !!done,
          summary: `人工操作${done ? '已完成' : '无法完成'}：${current.text}`,
        }),
      ),
    })
  })
  if (!saved.ok) return saved
  return { ok: true, request }
}

export const sweepStaleTasks = async (home, options = {}) => {
  const repo = createWorkspaceRepository({
    home,
    keyOf: workspaceKey,
    normalizeWorkspace,
    persistWorkspace: options.persistWorkspace,
  })
  return repo.sweepInterruptedTasks({
    markInterruptedTask: (item, now) =>
      normalizeTask({
        ...item,
        status: 'error',
        endedAt: now,
        summary: `${item.summary || `${item.type} 任务`}（上次运行中断）`,
      }),
    appendSweepEvent: (timeline, stale) =>
      pushEvent(
        timeline,
        normalizeTimelineEvent({
          kind: 'sweep',
          source: 'system',
          ok: false,
          summary: `启动清扫：${stale.length} 个中断任务已标记失败`,
        }),
      ),
  })
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
    } catch {
      /* skip */
    }
  }
  logs.sort((a, b) => b.mtime - a.mtime)
  let pruned = 0
  for (const log of logs.slice(Math.max(1, keep))) {
    try {
      unlinkSync(log.path)
      pruned += 1
    } catch {
      /* ignore */
    }
  }
  return { ok: true, pruned }
}

export const clearFramesByConnection = async (home, cwd, options) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const ws = loadWorkspace(home, room.cwd)
  const pack = normalizeModbus(ws.modbus)
  const current = pack.framesByConnection || {}
  const connId = typeof options?.connectionId === 'string' ? options.connectionId.trim() : ''
  const all = options?.all === true
  if (!all && !connId) return { ok: false, error: '缺少 connectionId 或 all' }
  let nextFrames
  if (all) {
    nextFrames = {}
  } else {
    const exists = (pack.connections || []).some((c) => c.id === connId)
    if (!exists) return { ok: false, error: `连接不存在: ${connId}`, errorCode: 'CONNECTION_NOT_FOUND' }
    nextFrames = { ...current }
    delete nextFrames[connId]
  }
  const saved = await saveWorkspaceAsync(home, room.cwd, {
    modbus: { version: 3 },
    _replaceFramesByConnection: nextFrames,
  })
  if (!saved.ok) return saved
  return { ok: true, cleared: all ? 'all' : connId, workspace: saved.workspace }
}

export const appendEvidence = async (home, cwd, evidence, sessionId = '') => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const ws = loadWorkspace(home, room.cwd)
  const sid = typeof sessionId === 'string' ? sessionId.trim() : ''
  const pack =
    sid || isScopePartitioned(ws.modbus) ? projectModbusForSession(ws.modbus, sid) : normalizeModbus(ws.modbus)
  const list = Array.isArray(evidence) ? evidence : evidence && typeof evidence === 'object' ? [evidence] : []
  if (!list.length) return { ok: false, error: '缺少 evidence' }
  for (const ev of list) {
    if (!ev || typeof ev !== 'object') return { ok: false, error: 'invalid evidence' }
    const kind = typeof ev.kind === 'string' ? ev.kind : ''
    const pointId = kind === 'point' ? ev.pointId || ev.id : ev.pointId
    const frameId = kind === 'frame' ? ev.frameId || ev.id : ev.frameId
    const alarmId = kind === 'alarm' ? ev.alarmId || ev.id : ev.alarmId
    const trendKey = kind === 'trend' ? ev.trendKey || ev.id : ev.trendKey
    const visualizationId = kind === 'visualization' ? ev.visualizationId || ev.id : ev.visualizationId
    const hasId =
      ev.id ||
      pointId ||
      frameId ||
      alarmId ||
      trendKey ||
      visualizationId ||
      ev.connectionId ||
      ev.deviceId ||
      ev.connId
    if (!hasId) return { ok: false, error: '证据缺少 ID', errorCode: 'TARGET_REQUIRED' }
    const rt = resolveTarget(pack, {
      connectionId: ev.connectionId || ev.connId,
      deviceId: ev.deviceId,
      pointId,
      frameId,
      alarmId,
      trendKey,
      visualizationId,
    })
    const isStrict =
      kind === 'point' ||
      kind === 'frame' ||
      kind === 'alarm' ||
      kind === 'trend' ||
      kind === 'visualization' ||
      ev.pointId ||
      ev.frameId ||
      ev.alarmId ||
      ev.trendKey ||
      ev.visualizationId
    if (isStrict && !rt.ok) {
      return {
        ok: false,
        error: rt.error,
        errorCode: rt.errorCode || (kind === 'visualization' ? 'VIZ_NOT_FOUND' : undefined),
      }
    }
    const evVer = Number(ev.version ?? ev.configVersion)
    if (Number.isFinite(evVer) && evVer !== (pack.configVersion || 1)) {
      return {
        ok: false,
        error: `版本漂移：证据基于 v${evVer} 当前 v${pack.configVersion || 1}`,
        errorCode: 'CONFIG_DRIFT',
      }
    }
  }
  const nextEvidence = [...(ws.focus.evidence || []), ...list].slice(-20)
  const saved = await saveWorkspaceAsync(home, room.cwd, { focus: { ...ws.focus, evidence: nextEvidence } })
  if (!saved.ok) return saved
  return { ok: true, evidence: saved.workspace.focus.evidence }
}
