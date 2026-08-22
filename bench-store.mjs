import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync, copyFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { emptyLog, mergeLog, normalizeEvent } from './bench-prompt.mjs'
import { normalizeConn, normalizeModbus, validateConnections, validateDevices } from './bench-devices.mjs'
import { requireWorkspaceCwd } from './bench-paths.mjs'
import {
  MAX_TASKS,
  capTasks,
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
  manualRequests: [],
  modbus: normalizeModbus({ version: 3 }),
})

const MANUAL_STATUSES = new Set(['pending', 'done', 'rejected'])

const normalizeManualRequests = (list) => {
  if (!Array.isArray(list)) return []
  return list.slice(0, 20).map((item) => ({
    id: typeof (item && item.id) === 'string' ? item.id.trim() : '',
    text: typeof (item && item.text) === 'string' ? item.text.trim().slice(0, 240) : '',
    status: MANUAL_STATUSES.has(item && item.status) ? item.status : 'pending',
    createdAt: Number(item && item.createdAt) > 0 ? Number(item.createdAt) : Date.now(),
    sessionId: typeof (item && item.sessionId) === 'string' ? item.sessionId.trim() : '',
  })).filter((item) => item.id && item.text)
}

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
  out.manualRequests = normalizeManualRequests(input && input.manualRequests)
  out.modbus = normalizeModbus(modbus)
  return out
}

export const loadWorkspace = (home, cwd) => {
  try {
    const raw = JSON.parse(readFileSync(workspacePath(home, cwd), 'utf8'))
    return normalizeWorkspace(raw)
  } catch {
    return emptyWorkspace()
  }
}

const isV3Patch = (incoming) => {
  if (!incoming || typeof incoming !== 'object') return false
  return incoming.version === 3
    || Array.isArray(incoming.connections)
    || Array.isArray(incoming.devices) && incoming.devices.some(d=> d && (d.connectionId || d.unitId !== undefined))
    || incoming.pollingByConnection !== undefined
    || incoming.framesByConnection !== undefined
    || incoming.activeConnectionId !== undefined
    || incoming.activeDeviceId !== undefined
    || incoming.alarmState !== undefined
}

const isV2Partial = (incoming, looksLegacy) => {
  if (looksLegacy) return false
  if (!incoming || typeof incoming !== 'object') return false
  return ['conn','points','values','polling','alarmActive','alarmState','version','frames','framesLog','framesByConnection'].some(k=> Object.prototype.hasOwnProperty.call(incoming,k))
}

export const saveWorkspace = (home, cwd, input) => {
  const prev = loadWorkspace(home, cwd)
  const incoming = (input && input.modbus) || {}
  const looksLegacy = incoming.conn === undefined && (
    Array.isArray(incoming.devices) && incoming.devices.some(d=> d && (d.mode !== undefined || d.port !== undefined || Array.isArray(d.segments)))
    || incoming.mode !== undefined || incoming.segments !== undefined
  )
  const v3Patch = isV3Patch(incoming)
  const v2Partial = isV2Partial(incoming, looksLegacy)
  let mergedModbus
  if (looksLegacy) {
    mergedModbus = incoming
  } else if (v3Patch) {
    mergedModbus = { ...prev.modbus }
    if (incoming.connections !== undefined) mergedModbus.connections = incoming.connections
    if (incoming.devices !== undefined) mergedModbus.devices = incoming.devices
    if (incoming.points !== undefined) mergedModbus.points = incoming.points
    if (incoming.values !== undefined) mergedModbus.values = incoming.values
    if (incoming.pollingByConnection !== undefined) {
      mergedModbus.pollingByConnection = { ...mergedModbus.pollingByConnection, ...incoming.pollingByConnection }
    }
    if (incoming.framesByConnection !== undefined) {
      mergedModbus.framesByConnection = { ...mergedModbus.framesByConnection, ...incoming.framesByConnection }
    }
    if (incoming.activeConnectionId !== undefined) mergedModbus.activeConnectionId = incoming.activeConnectionId
    if (incoming.activeDeviceId !== undefined) mergedModbus.activeDeviceId = incoming.activeDeviceId
    if (incoming.alarmState !== undefined) mergedModbus.alarmState = incoming.alarmState
    if (incoming.alarmActive !== undefined && incoming.alarmState === undefined) mergedModbus.alarmState = incoming.alarmActive
    // legacy polling -> pollingByConnection mapping
    if (incoming.polling !== undefined && incoming.pollingByConnection === undefined) {
      const aid = incoming.activeConnectionId || mergedModbus.activeConnectionId || (mergedModbus.connections && mergedModbus.connections[0] && mergedModbus.connections[0].id)
      if (aid) {
        mergedModbus.pollingByConnection = { ...mergedModbus.pollingByConnection, [aid]: { ...(mergedModbus.pollingByConnection[aid]||{}), ...incoming.polling } }
      }
    }
    // conn patch to active connection when connections not directly patched
    if (incoming.conn && typeof incoming.conn === 'object' && incoming.connections === undefined) {
      const aid = mergedModbus.activeConnectionId || (mergedModbus.connections && mergedModbus.connections[0] && mergedModbus.connections[0].id)
      if (aid) {
        mergedModbus.connections = (mergedModbus.connections||[]).map(c=> c.id===aid ? { ...c, conn: { ...c.conn, ...incoming.conn } } : c)
        // slave -> unitId
        if (incoming.conn.slave !== undefined) {
          const devId = mergedModbus.activeDeviceId || (mergedModbus.devices && mergedModbus.devices[0] && mergedModbus.devices[0].id)
          if (devId) {
            mergedModbus.devices = (mergedModbus.devices||[]).map(d=> d.id===devId ? { ...d, unitId: Math.min(247, Math.max(0, Math.trunc(Number(incoming.conn.slave)||1))) } : d)
          }
        }
      }
    }
    if (incoming.version !== undefined) mergedModbus.version = incoming.version
    // ensure version 3
    mergedModbus.version = 3
  } else if (v2Partial) {
    mergedModbus = { ...prev.modbus }
    // conn patch
    if (incoming.conn && typeof incoming.conn === 'object') {
      const aid = mergedModbus.activeConnectionId || (mergedModbus.connections && mergedModbus.connections[0] && mergedModbus.connections[0].id)
      mergedModbus.connections = (mergedModbus.connections||[]).map(c=> c.id===aid ? { ...c, conn: normalizeConn({ ...c.conn, ...incoming.conn }) } : c)
      if (incoming.conn.slave !== undefined) {
        const devId = mergedModbus.activeDeviceId || (mergedModbus.devices && mergedModbus.devices[0] && mergedModbus.devices[0].id)
        if (devId) {
          mergedModbus.devices = (mergedModbus.devices||[]).map(d=> d.id===devId ? { ...d, unitId: Math.min(247, Math.max(0, Math.trunc(Number(incoming.conn.slave)||1))) } : d)
        }
      }
    }
    if (incoming.points !== undefined) {
      const AREA_BY_FN = { 1:'coil', 2:'discreteInput', 3:'holdingRegister', 4:'inputRegister' }
      const activeConnId = mergedModbus.activeConnectionId || (mergedModbus.connections && mergedModbus.connections[0] && mergedModbus.connections[0].id) || 'c1'
      const activeDevId = mergedModbus.activeDeviceId || (mergedModbus.devices && mergedModbus.devices[0] && mergedModbus.devices[0].id) || 'd1'
      const kept = (mergedModbus.points||[]).filter(p=> !(p.connectionId===activeConnId && p.deviceId===activeDevId))
      const genId = (pref)=> pref + Date.now().toString(36) + Math.random().toString(36).slice(2,8)
      const newPts = (Array.isArray(incoming.points)?incoming.points:[]).map(raw=>{
        const fn = Number(raw && raw.function)
        const area = AREA_BY_FN[fn] || 'holdingRegister'
        const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : genId('p')
        const address = Number(raw && raw.address)
        return {
          id,
          connectionId: activeConnId,
          deviceId: activeDevId,
          name: typeof raw.name==='string'?raw.name.slice(0,40):'',
          area,
          function: [1,2,3,4].includes(fn)?fn:3,
          address: Number.isFinite(address) && address>=0 && address<=65535 ? Math.trunc(address):0,
          scale: Number.isFinite(Number(raw && raw.scale))?Number(raw.scale):1,
          offset: Number.isFinite(Number(raw && raw.offset))?Number(raw.offset):0,
          unit: typeof raw.unit==='string'?raw.unit.slice(0,12):'',
          alarmMin: raw.alarmMin===null||raw.alarmMin===undefined||raw.alarmMin==='' ? null : (Number.isFinite(Number(raw.alarmMin))?Number(raw.alarmMin):null),
          alarmMax: raw.alarmMax===null||raw.alarmMax===undefined||raw.alarmMax==='' ? null : (Number.isFinite(Number(raw.alarmMax))?Number(raw.alarmMax):null),
        }
      })
      mergedModbus.points = kept.concat(newPts)
    }
    if (incoming.values !== undefined) mergedModbus.values = incoming.values
    if (incoming.polling !== undefined) {
      const aid = mergedModbus.activeConnectionId || (mergedModbus.connections && mergedModbus.connections[0] && mergedModbus.connections[0].id)
      if (aid) mergedModbus.pollingByConnection = { ...mergedModbus.pollingByConnection, [aid]: { ...(mergedModbus.pollingByConnection[aid]||{}), ...incoming.polling } }
    }
    if (incoming.alarmActive !== undefined) mergedModbus.alarmState = incoming.alarmActive
    if (incoming.alarmState !== undefined) mergedModbus.alarmState = incoming.alarmState
    if (incoming.frames !== undefined || incoming.framesLog !== undefined || incoming.framesByConnection !== undefined) {
      const aid = mergedModbus.activeConnectionId || (mergedModbus.connections && mergedModbus.connections[0] && mergedModbus.connections[0].id)
      const frames = incoming.frames || incoming.framesLog || incoming.framesByConnection
      if (Array.isArray(frames)) {
        mergedModbus.framesByConnection = { ...mergedModbus.framesByConnection, [aid]: frames }
      } else if (frames && typeof frames==='object') {
        mergedModbus.framesByConnection = { ...mergedModbus.framesByConnection, ...frames }
      }
    }
    mergedModbus.version = 3
  } else {
    mergedModbus = prev.modbus
  }
  const merged = {
    keil: { ...prev.keil, ...(input && input.keil) },
    modbus: mergedModbus,
    log: input && input.log !== undefined ? input.log : prev.log,
    tasks: input && input.tasks !== undefined ? input.tasks : prev.tasks,
    timeline: input && input.timeline !== undefined ? input.timeline : prev.timeline,
    session: { ...prev.session, ...(input && input.session) },
    manualRequests: input && input.manualRequests !== undefined ? input.manualRequests : prev.manualRequests,
  }
  const workspace = normalizeWorkspace(merged)
  // COM / TCP server + Unit ID uniqueness check before persist
  const connErrors = validateConnections(workspace.modbus.connections, workspace.modbus.devices)
  // also keep explicit device check for callers that only use validateDevices
  const devErrors = validateDevices(workspace.modbus.devices, workspace.modbus.connections)
  const allErrs = [...connErrors]
  // avoid double counting if validateConnections already included device errors (when devices arg provided)
  // connErrors already contains device errors when devices were passed, so dedup by not double-adding
  // we only add devErrors that are not already in connErrors
  for (const e of devErrors) if (!allErrs.includes(e)) allErrs.push(e)
  if (allErrs.length) {
    return { ok: false, error: allErrs.join('；'), workspace }
  }
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
  // Backup v2 file if migrating
  try {
    const rawPath = workspacePath(home, cwd)
    if (existsSync(rawPath)) {
      const rawContent = readFileSync(rawPath, 'utf8')
      const rawJson = JSON.parse(rawContent)
      const rawModbus = rawJson && rawJson.modbus
      const isV2OnDisk = rawModbus && (rawModbus.version === 2 || (rawModbus.version === undefined && (rawModbus.conn || rawModbus.points)))
      if (isV2OnDisk && workspace.modbus.version === 3) {
        const bakPath = rawPath + '.v2.bak'
        if (!existsSync(bakPath)) {
          writeFileSync(bakPath, rawContent)
        }
        // also keep copy as .bak for recoverable
        const legacyBak = join(storeDir(home), 'workspaces', workspaceKey(cwd) + '.v2.json')
        if (!existsSync(legacyBak)) {
          writeFileSync(legacyBak, rawContent)
        }
      }
    }
  } catch { /* ignore backup errors */ }
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
    tasks: capTasks(prepend(prev.tasks, task, MAX_TASKS * 3)),
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
      frames: patch && patch.frames !== undefined ? patch.frames : item.frames,
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

export const createManualRequest = (home, cwd, spec) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const text = typeof (spec && spec.text) === 'string' ? spec.text.trim().slice(0, 240) : ''
  if (!text) return { ok: false, error: '缺少请求内容' }
  const prev = loadWorkspace(home, room.cwd)
  const request = {
    id: newId('mr'),
    text,
    status: 'pending',
    createdAt: Date.now(),
    sessionId: typeof (spec && spec.sessionId) === 'string' ? spec.sessionId.trim() : '',
  }
  const saved = saveWorkspace(home, room.cwd, {
    manualRequests: prepend(prev.manualRequests, request, 20),
    timeline: pushEvent(prev.timeline, normalizeTimelineEvent({
      kind: 'manual-request',
      source: spec && spec.source === 'agent' ? 'agent' : 'user',
      sessionId: request.sessionId,
      summary: '请求人工操作：' + text,
    })),
  })
  if (!saved.ok) return saved
  return { ok: true, request }
}

export const resolveManualRequest = (home, cwd, id, done) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const prev = loadWorkspace(home, room.cwd)
  const current = (prev.manualRequests || []).find((item) => item.id === String(id || '') && item.status === 'pending')
  if (!current) return { ok: false, error: '请求不存在或已处理' }
  const status = done ? 'done' : 'rejected'
  const manualRequests = (prev.manualRequests || []).map((item) => item.id === current.id
    ? { ...item, status }
    : item)
  const saved = saveWorkspace(home, room.cwd, {
    manualRequests,
    timeline: pushEvent(prev.timeline, normalizeTimelineEvent({
      kind: 'manual-done',
      source: 'user',
      sessionId: current.sessionId,
      ok: !!done,
      summary: '人工操作' + (done ? '已完成' : '无法完成') + '：' + current.text,
    })),
  })
  if (!saved.ok) return saved
  return { ok: true, request: { ...current, status } }
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
