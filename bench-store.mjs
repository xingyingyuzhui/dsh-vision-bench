import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync, copyFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { emptyLog, mergeLog, normalizeEvent } from './bench-prompt.mjs'
import { normalizeConn, normalizeFramesByConnection, normalizeModbus, validateConnections, validateDevices, normalizeConfigVersion } from './bench-devices.mjs'
// alarmState persists condition( active|recovered ) + acknowledged(bool)+ackedAt/ackedBy split for Task12
import { requireWorkspaceCwd } from './bench-paths.mjs'
import { applyPatch, compare as patchCompare, validatePatch } from './bench-patch.mjs'
import { resolveTarget } from './bench-targets.mjs'
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

export const emptyFocusState = () => ({
  request: null,
  prev: null,
  tempWatchIds: [],
  badgeOnly: false,
  evidence: [],
})

const focusText = (v) => (typeof v === 'string' ? v.trim().slice(0, 64) : '')

export const normalizeFocusRequest = (input) => {
  if (!input || typeof input !== 'object') return null
  const connectionId = focusText(input.connectionId || input.connId)
  const deviceId = focusText(input.deviceId)
  const pointId = focusText(input.pointId)
  const frameId = focusText(input.frameId)
  const trendKey = focusText(input.trendKey)
  const alarmId = focusText(input.alarmId)
  const kind = typeof input.kind === 'string' ? input.kind.slice(0, 32) : ''
  const at = Number(input.at) > 0 ? Number(input.at) : Date.now()
  const by = input.by === 'agent' ? 'agent' : 'user'
  const version = Number(input.version) > 0 ? Number(input.version) : 0
  const hasTarget = connectionId || deviceId || pointId || frameId || trendKey || alarmId
  if (!hasTarget) return null
  return { connectionId, deviceId, pointId, frameId, trendKey, alarmId, kind, at, by, version }
}

export const normalizeFocusState = (input) => {
  const out = emptyFocusState()
  if (!input || typeof input !== 'object') return out
  const req = normalizeFocusRequest(input.request || input)
  const prev = normalizeFocusRequest(input.prev)
  out.request = req
  out.prev = prev
  if (Array.isArray(input.tempWatchIds)) {
    out.tempWatchIds = input.tempWatchIds.map((v) => focusText(v)).filter(Boolean).slice(0, 32)
  } else if (Array.isArray(input.tempWatch)) {
    out.tempWatchIds = input.tempWatch.map((v) => focusText(v)).filter(Boolean).slice(0, 32)
  }
  out.badgeOnly = input.badgeOnly === true
  if (Array.isArray(input.evidence)) {
    // Task4/0.18.2: typed evidence contract — kind decides which typed id field
    // carries the target; timeRange/version/at survive restart unchanged.
    out.evidence = input.evidence.slice(0, 20).map((e) => {
      if (!e || typeof e !== 'object') return null
      const kind = typeof e.kind === 'string' ? e.kind.slice(0, 32) : ''
      const at = Number(e.at) > 0 ? Number(e.at) : Date.now()
      const pointId = focusText(e.pointId || (kind === 'point' ? e.id : ''))
      const frameId = focusText(e.frameId || (kind === 'frame' ? e.id : ''))
      const alarmId = focusText(e.alarmId || (kind === 'alarm' ? e.id : ''))
      const trendKey = focusText(e.trendKey || (kind === 'trend' ? e.id : ''))
      const rawRange = e && e.timeRange
      const rangeStart = Number(rawRange && rawRange.start)
      const rangeEnd = Number(rawRange && rawRange.end)
      const timeRange = Number.isFinite(rangeStart) && rangeStart > 0 && Number.isFinite(rangeEnd) && rangeEnd >= rangeStart
        ? { start: rangeStart, end: rangeEnd }
        : { start: at - 5 * 60 * 1000, end: at }
      return {
        kind,
        id: focusText(e.id || pointId || frameId || trendKey || alarmId),
        connectionId: focusText(e.connectionId || e.connId),
        deviceId: focusText(e.deviceId),
        pointId,
        frameId,
        trendKey,
        alarmId,
        at,
        version: Number(e.version) > 0 ? Number(e.version) : 0,
        timeRange,
      }
    }).filter(Boolean)
  }
  return out
}

const MAX_DRAFTS = 20

const DRAFT_STATUSES = new Set(['pending', 'applied', 'discarded'])

const normalizeDraftPatch = (patch) => {
  if (!Array.isArray(patch)) return []
  // shallow clone, keep only op/path/value/from, enforce limits 200 ops
  return patch.slice(0, 200).map((op) => {
    if (!op || typeof op !== 'object') return null
    const out = { op: String(op.op || '').slice(0, 16), path: String(op.path || '').slice(0, 256) }
    if ('value' in op) out.value = op.value
    if ('from' in op) out.from = String(op.from).slice(0, 256)
    return out
  }).filter(Boolean)
}

const normalizeDraftSummary = (input) => {
  if (!input || typeof input !== 'object') return { added: 0, removed: 0, modified: 0, comConflicts: [], unitIdConflicts: [], affectedPoints: 0, details: [] }
  return {
    added: Number(input.added) > 0 ? Math.trunc(Number(input.added)) : 0,
    removed: Number(input.removed) > 0 ? Math.trunc(Number(input.removed)) : 0,
    modified: Number(input.modified) > 0 ? Math.trunc(Number(input.modified)) : 0,
    comConflicts: Array.isArray(input.comConflicts) ? input.comConflicts.map((s) => String(s).slice(0, 240)).slice(0, 10) : [],
    unitIdConflicts: Array.isArray(input.unitIdConflicts) ? input.unitIdConflicts.map((s) => String(s).slice(0, 240)).slice(0, 10) : [],
    affectedPoints: Number(input.affectedPoints) > 0 ? Math.trunc(Number(input.affectedPoints)) : 0,
    details: Array.isArray(input.details) ? input.details.slice(0, 40).map((d) => ({
      op: String(d.op || '').slice(0, 16),
      path: String(d.path || '').slice(0, 256),
      kind: String(d.kind || '').slice(0, 24),
    })) : [],
  }
}

export const normalizeConfigDraft = (input) => {
  if (!input || typeof input !== 'object') return null
  const id = typeof input.id === 'string' ? input.id.trim() : ''
  if (!id) return null
  const baseConfigVersion = normalizeConfigVersion(input.baseConfigVersion)
  const createdAt = Number(input.createdAt) > 0 ? Number(input.createdAt) : Date.now()
  const source = input.source === 'agent' ? 'agent' : 'user'
  const sessionId = typeof input.sessionId === 'string' ? input.sessionId.trim().slice(0, 64) : (typeof input.createdBy === 'string' ? input.createdBy.trim().slice(0, 64) : '')
  const status = DRAFT_STATUSES.has(input.status) ? input.status : 'pending'
  const endpointFingerprints = input.endpointFingerprints && typeof input.endpointFingerprints === 'object' && !Array.isArray(input.endpointFingerprints)
    ? Object.fromEntries(Object.entries(input.endpointFingerprints).map(([k, v]) => [String(k).slice(0, 64), typeof v === 'string' ? v.slice(0, 256) : JSON.stringify(v).slice(0, 256)]))
    : (input.baseFingerprint && typeof input.baseFingerprint === 'object' ? Object.fromEntries(Object.entries(input.baseFingerprint).map(([k, v]) => [String(k).slice(0, 64), typeof v === 'string' ? v.slice(0, 256) : JSON.stringify(v).slice(0, 256)])) : {})
  const patch = normalizeDraftPatch(input.patch)
  const summary = normalizeDraftSummary(input.summary)
  return { id, baseConfigVersion, createdAt, source, sessionId, status, patch, summary, endpointFingerprints, baseSnapshot: input.baseSnapshot && typeof input.baseSnapshot === 'object' ? input.baseSnapshot : null }
}

export const normalizeConfigDrafts = (list) => {
  if (!Array.isArray(list)) return []
  const out = []
  const seen = new Set()
  for (const raw of list) {
    const d = normalizeConfigDraft(raw)
    if (!d || seen.has(d.id)) continue
    seen.add(d.id)
    out.push(d)
    if (out.length >= MAX_DRAFTS) break
  }
  // newest first (createdAt desc)
  out.sort((a, b) => b.createdAt - a.createdAt)
  return out
}

// ── configDraft helpers (RFC6902, N4.2) ────────────────────────────────

const endpointFingerprintOf = (conn) => {
  if (!conn || typeof conn !== 'object') return ''
  return [
    conn.mode || 'rtu',
    (conn.port || '').trim().toLowerCase(),
    String(conn.baudrate || 0),
    String(conn.bytesize || 8),
    conn.parity || 'N',
    String(conn.stopbits || 1),
    (conn.host || '').trim().toLowerCase(),
    String(conn.tcpPort || 502),
    String(conn.slave ?? 1),
  ].join('|')
}

const snapshotFingerprints = (connections) => {
  const out = {}
  for (const c of Array.isArray(connections) ? connections : []) {
    if (c && c.id) out[c.id] = endpointFingerprintOf(c.conn || c)
  }
  return out
}

const stringifyConfigSlice = (modbus) => {
  try {
    const pack = modbus && typeof modbus === 'object' ? modbus : {}
    const slice = {
      connections: pack.connections || [],
      devices: pack.devices || [],
      points: pack.points || [],
      // TaskP0/0.20.0: 组件配置属于配置版本一部分
      visualization: pack.visualization || null,
    }
    return JSON.stringify(slice)
  } catch { return '' }
}

const computeDraftSummary = (basePack, targetPack, patch) => {
  let added = 0, removed = 0, modified = 0, affectedPoints = 0
  const details = []
  for (const op of Array.isArray(patch) ? patch : []) {
    const path = String(op.path || '')
    let kind = 'modify'
    if (op.op === 'add') { added += 1; kind = 'add' }
    else if (op.op === 'remove') { removed += 1; kind = 'remove' }
    else if (op.op === 'replace') { modified += 1; kind = 'modify' }
    const top = path.split('/')[1] || ''
    if (top === 'points' || top === 'devices' || top === 'connections') {
      // count distinct point impact later
    }
    details.push({ op: op.op, path, kind })
    if (details.length >= 40) break
  }
  // affectedPoints: count points that differ between base and target
  try {
    const baseIds = new Set((basePack.points || []).map((p) => p.id))
    const targetIds = new Set((targetPack.points || []).map((p) => p.id))
    for (const id of targetIds) if (!baseIds.has(id)) affectedPoints += 1
    for (const id of baseIds) if (!targetIds.has(id)) affectedPoints += 1
    // modified points: same id but deep changed (excluding values)
    const baseById = new Map((basePack.points || []).map((p) => [p.id, JSON.stringify(p)]))
    for (const p of targetPack.points || []) {
      const b = baseById.get(p.id)
      if (b && b !== JSON.stringify(p)) affectedPoints += 1
    }
  } catch { /* ignore */ }
  const comConflicts = validateConnections(targetPack.connections, targetPack.devices).filter((m) => /COM|监听地址/.test(m))
  const unitIdConflicts = validateDevices(targetPack.devices, targetPack.connections)
  // TaskP0/0.20.0: 可视化组件草稿统计
  let vizAdded = 0, vizRemoved = 0, vizModified = 0
  try {
    const baseViz = (basePack.visualization && basePack.visualization.components) || []
    const targetViz = (targetPack.visualization && targetPack.visualization.components) || []
    const baseById = new Map(baseViz.map((c) => [c.id, JSON.stringify(c)]))
    const targetById = new Map(targetViz.map((c) => [c.id, JSON.stringify(c)]))
    for (const [id, json] of targetById) {
      const b = baseById.get(id)
      if (b === undefined) vizAdded += 1
      else if (b !== json) vizModified += 1
    }
    for (const id of baseById.keys()) if (!targetById.has(id)) vizRemoved += 1
  } catch { /* 统计尽力而为 */ }
  return { added, removed, modified, comConflicts: comConflicts.slice(0, 10), unitIdConflicts: unitIdConflicts.slice(0, 10), affectedPoints, vizAdded, vizRemoved, vizModified, details }
}

export const emptyWorkspace = () => ({
  keil: { project: '', target: '', artifact: 'hex', download: '' },
  log: emptyLog(),
  tasks: [],
  timeline: [],
  session: { boundId: '' },
  manualRequests: [],
  modbus: normalizeModbus({ version: 3, configVersion: 1 }),
  focus: emptyFocusState(),
  // Task5/0.19.3: 编译错误定位目标（调试页写入，工程结构页消费）
  jumpProject: null,
  configDrafts: [],
})

const MANUAL_STATUSES = new Set(['pending', 'done', 'rejected'])

const normalizeProjectJump = (input) => {
  if (!input || typeof input !== 'object' || typeof input.file !== 'string' || !input.file.trim()) return null
  return { file: String(input.file).slice(0, 400), line: Math.max(0, Math.trunc(Number(input.line) || 0)), at: Date.now() }
}

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
  out.focus = normalizeFocusState(input && input.focus)
  out.configDrafts = normalizeConfigDrafts(input && input.configDrafts)
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
    || incoming.visualization !== undefined
}

const isV2Partial = (incoming, looksLegacy) => {
  if (looksLegacy) return false
  if (!incoming || typeof incoming !== 'object') return false
  return ['conn','points','values','polling','alarmActive','alarmState','version','frames','framesLog','framesByConnection'].some(k=> Object.prototype.hasOwnProperty.call(incoming,k))
}

export const saveWorkspace = (home, cwd, input) => {
  const prev = loadWorkspace(home, cwd)
  const incoming = (input && input.modbus) || {}
  const incomingDrafts = input && input.configDrafts
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
    // Task3/0.19.3: 曲线采样存储（提交阶段写入）
    if (incoming.trend !== undefined) mergedModbus.trend = incoming.trend
    // TaskP0/0.20.0: 可视化组件（由 normalizeWorkspace 统一规范化）
    if (incoming.visualization !== undefined) mergedModbus.visualization = incoming.visualization
    // Task1/0.18.2: explicit WHOLE-replacement semantics — merge cannot express
    // deletion. normalizeFramesByConnection pre-seeds every connection id, which
    // would resurrect cleared keys as empty arrays; normalize only provided keys.
    if (input && input._replaceFramesByConnection !== undefined) {
      const replaceMap = input._replaceFramesByConnection && typeof input._replaceFramesByConnection === 'object'
        ? input._replaceFramesByConnection
        : {}
      const replaced = {}
      for (const [k, v] of Object.entries(replaceMap)) {
        replaced[k] = normalizeFramesByConnection({ [k]: v }, [])[k] || []
      }
      mergedModbus.framesByConnection = replaced
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
  // configDrafts: preserve unless incoming provides explicit list
  let nextDrafts = prev.configDrafts || []
  if (incomingDrafts !== undefined) {
    nextDrafts = normalizeConfigDrafts(incomingDrafts)
  } else if (input && input._replaceConfigDrafts !== undefined) {
    // internal helper for draft ops: input._replaceConfigDrafts bypasses saveWorkspace drafting loop
    nextDrafts = normalizeConfigDrafts(input._replaceConfigDrafts)
  }
  const merged = {
    keil: { ...prev.keil, ...(input && input.keil) },
    modbus: mergedModbus,
    log: input && input.log !== undefined ? input.log : prev.log,
    tasks: input && input.tasks !== undefined ? input.tasks : prev.tasks,
    timeline: input && input.timeline !== undefined ? input.timeline : prev.timeline,
    session: { ...prev.session, ...(input && input.session) },
    manualRequests: input && input.manualRequests !== undefined ? input.manualRequests : prev.manualRequests,
    focus: input && input.focus !== undefined ? normalizeFocusState(input.focus) : prev.focus,
    jumpProject: input && input.jumpProject !== undefined ? normalizeProjectJump(input.jumpProject) : prev.jumpProject,
    configDrafts: nextDrafts,
  }
  const workspace = normalizeWorkspace(merged)
  // auto-bump configVersion when connections/devices/points changed vs prev
  try {
    const prevSlice = stringifyConfigSlice(prev.modbus)
    const curSlice = stringifyConfigSlice(workspace.modbus)
    if (prevSlice !== curSlice) {
      const expected = normalizeConfigVersion((prev.modbus && prev.modbus.configVersion) ? prev.modbus.configVersion + 1 : 2)
      // only bump if not already bumped (e.g., draft apply set explicit higher version)
      const currentCv = workspace.modbus.configVersion || 1
      if (currentCv <= (prev.modbus.configVersion || 1)) {
        workspace.modbus.configVersion = expected
      } else if (currentCv < expected) {
        workspace.modbus.configVersion = expected
      }
      // also keep normalized copy consistent after bump
      // re-normalize to apply status bar etc? just ensure version stays 3
      workspace.modbus = normalizeModbus(workspace.modbus)
      // ensure bumped value survives second normalize
      if (workspace.modbus.configVersion !== expected && currentCv <= (prev.modbus.configVersion || 1)) {
        workspace.modbus.configVersion = expected
      }
    }
  } catch { /* bump is best-effort */ }
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

// ── config draft (RFC6902, N4.2) ─────────────────────────────────────────

export const listConfigDrafts = (home, cwd) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const ws = loadWorkspace(home, room.cwd)
  return { ok: true, drafts: normalizeConfigDrafts(ws.configDrafts), configVersion: ws.modbus.configVersion || 1 }
}

export const getConfigDraft = (home, cwd, draftId) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const ws = loadWorkspace(home, room.cwd)
  const draft = (ws.configDrafts || []).find((d) => d.id === String(draftId).trim())
  if (!draft) return { ok: false, error: '草稿不存在: ' + draftId }
  return { ok: true, draft, configVersion: ws.modbus.configVersion || 1 }
}

export const createConfigDraft = (home, cwd, spec) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const workspace = loadWorkspace(home, room.cwd)
  const pack = normalizeModbus(workspace.modbus)
  const baseConfigVersion = Number(spec && spec.baseConfigVersion)
  if (!Number.isFinite(baseConfigVersion) || baseConfigVersion < 1) {
    return { ok: false, error: '缺少 baseConfigVersion' }
  }
  if ((pack.configVersion || 1) !== baseConfigVersion) {
    return { ok: false, error: '基线版本已漂移，当前 ' + (pack.configVersion || 1) + ' 期望 ' + baseConfigVersion, errorCode: 'CONFIG_DRIFT' }
  }
  let patch = spec && spec.patch
  // allow target snapshot -> compute patch via bench-patch compare
  if (!patch && spec && spec.target && typeof spec.target === 'object') {
    try {
      const targetSlice = spec.target.modbus ? spec.target.modbus : spec.target
      const baseSlice = { connections: pack.connections, devices: pack.devices, points: pack.points }
      const normalizedTarget = normalizeModbus({ ...pack, ...targetSlice, version: 3 })
      const targetNormalizedSlice = { connections: normalizedTarget.connections, devices: normalizedTarget.devices, points: normalizedTarget.points }
      patch = patchCompare(baseSlice, targetNormalizedSlice)
    } catch (e) {
      return { ok: false, error: '生成 patch 失败: ' + String(e && e.message || e) }
    }
  }
  // alias: accept operations / ops / jsonPatch as patch
  if (!patch && spec && Array.isArray(spec.operations)) patch = spec.operations
  if (!patch && spec && Array.isArray(spec.ops)) patch = spec.ops
  if (!patch && spec && Array.isArray(spec.jsonPatch)) patch = spec.jsonPatch
  if (!Array.isArray(patch) || patch.length === 0) return { ok: false, error: '缺少 patch (RFC6902 数组)' }
  const validation = validatePatch(patch)
  if (validation) return { ok: false, error: 'patch 校验失败: ' + validation }
  // enforce patch targets only allowed roots (/connections, /devices, /points, /activeConnectionId, /activeDeviceId) for safety
  const allowedTop = new Set(['connections', 'devices', 'points', 'activeConnectionId', 'activeDeviceId', 'pollingByConnection', 'values', 'visualization'])
  for (const op of patch) {
    const top = String(op.path || '').split('/')[1] || ''
    if (top && !allowedTop.has(top) && top !== '') {
      return { ok: false, error: '不支持的 patch 路径: ' + op.path }
    }
  }
  // Try applying to detect obvious shape errors before persisting
  const baseForPatch = { connections: pack.connections, devices: pack.devices, points: pack.points, activeConnectionId: pack.activeConnectionId, activeDeviceId: pack.activeDeviceId, pollingByConnection: pack.pollingByConnection, visualization: pack.visualization }
  const applied = applyPatch(baseForPatch, patch)
  if (!applied.ok) return { ok: false, error: 'patch 应用预检失败: ' + applied.error }
  const summary = computeDraftSummary(pack, normalizeModbus({ ...pack, ...applied.result, version: 3 }), patch)
  const draft = {
    id: 'draft' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    baseConfigVersion: pack.configVersion || 1,
    createdAt: Date.now(),
    source: spec && spec.source === 'agent' ? 'agent' : 'user',
    sessionId: typeof (spec && spec.sessionId) === 'string' ? spec.sessionId.trim().slice(0, 64) : '',
    status: 'pending',
    patch: normalizeDraftPatch(patch),
    summary,
    endpointFingerprints: snapshotFingerprints(pack.connections),
    baseSnapshot: { connections: pack.connections, devices: pack.devices, points: pack.points },
  }
  const nextDrafts = [draft].concat(workspace.configDrafts || []).slice(0, MAX_DRAFTS)
  const saved = saveWorkspace(home, room.cwd, { _replaceConfigDrafts: nextDrafts })
  if (!saved.ok) return saved
  // record timeline
  try {
    recordBenchEvent(home, room.cwd, { action: 'config-draft', ok: true, summary: '创建配置草稿 ' + draft.id + '（基于 v' + draft.baseConfigVersion + '，影响 ' + summary.affectedPoints + ' 点）' }, { source: draft.source, sessionId: draft.sessionId })
  } catch {}
  return { ok: true, draft, summary, baseConfigVersion: draft.baseConfigVersion }
}

export const discardConfigDraft = (home, cwd, draftId) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const ws = loadWorkspace(home, room.cwd)
  const id = String(draftId || '').trim()
  if (!id) return { ok: false, error: '缺少草稿 id' }
  const drafts = Array.isArray(ws.configDrafts) ? ws.configDrafts : []
  const found = drafts.find((d) => d.id === id)
  if (!found) return { ok: false, error: '草稿不存在: ' + id }
  if (found.status !== 'pending') return { ok: false, error: '草稿已处理: ' + id }
  const nextDrafts = drafts.map((d) => d.id === id ? { ...d, status: 'discarded' } : d)
  const saved = saveWorkspace(home, room.cwd, { _replaceConfigDrafts: nextDrafts })
  if (!saved.ok) return saved
  try {
    recordBenchEvent(home, room.cwd, { action: 'config-discard', ok: true, summary: '丢弃配置草稿 ' + id }, { source: 'user' })
  } catch {}
  return { ok: true, draftId: id }
}

export const applyConfigDraft = (home, cwd, draftId, opts = {}) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const ws = loadWorkspace(home, room.cwd)
  const pack = normalizeModbus(ws.modbus)
  const id = String(draftId || '').trim()
  if (!id) return { ok: false, error: '缺少草稿 id' }
  const drafts = Array.isArray(ws.configDrafts) ? ws.configDrafts : []
  const draft = drafts.find((d) => d.id === id)
  if (!draft) return { ok: false, error: '草稿不存在: ' + id, errorCode: 'CONFIG_DRIFT' }
  if (draft.status !== 'pending') return { ok: false, error: '草稿已处理: ' + id, errorCode: 'CONFIG_DRIFT' }
  // 1) baseline version drift
  if ((pack.configVersion || 1) !== draft.baseConfigVersion) {
    return { ok: false, error: '基线版本漂移：当前 v' + (pack.configVersion || 1) + ' 草稿基于 v' + draft.baseConfigVersion, errorCode: 'CONFIG_DRIFT' }
  }
  // 2) endpoint fingerprint drift
  const currentFingerprints = snapshotFingerprints(pack.connections)
  const baseFingerprints = draft.endpointFingerprints || {}
  for (const [cid, baseFp] of Object.entries(baseFingerprints)) {
    const curFp = currentFingerprints[cid]
    if (curFp === undefined) {
      // connection deleted after draft -> object missing drift
      return { ok: false, error: '对象不存在：连接 ' + cid + ' 已删除', errorCode: 'CONFIG_DRIFT' }
    }
    if (curFp !== baseFp) {
      return { ok: false, error: '端点指纹漂移：连接 ' + cid + ' 已变更', errorCode: 'CONFIG_DRIFT' }
    }
  }
  // also check that connections referenced in patch still exist? patch path itself will fail on apply if missing, which we map to drift below

  // 3) object existence & patch apply
  const baseForPatch = { connections: pack.connections, devices: pack.devices, points: pack.points, activeConnectionId: pack.activeConnectionId, activeDeviceId: pack.activeDeviceId, pollingByConnection: pack.pollingByConnection, visualization: pack.visualization }
  const applied = applyPatch(baseForPatch, draft.patch)
  if (!applied.ok) {
    return { ok: false, error: 'patch 应用失败（对象可能已删除）：' + applied.error, errorCode: 'CONFIG_DRIFT' }
  }
  const targetRaw = { ...pack, ...applied.result }
  // validate target config before writing
  const targetPack = normalizeModbus({ ...targetRaw, version: 3 })
  const connErrs = validateConnections(targetPack.connections, targetPack.devices)
  const devErrs = validateDevices(targetPack.devices, targetPack.connections)
  const allErrs = [...connErrs]
  for (const e of devErrs) if (!allErrs.includes(e)) allErrs.push(e)
  // compute summary for response (even if validation fails, we still want to surface)
  const summary = computeDraftSummary(pack, targetPack, draft.patch)
  if (allErrs.length) {
    return { ok: false, error: allErrs.join('；'), errorCode: 'CONFLICT', summary, targetPack }
  }
  // persist target config + mark draft applied
  const nextDrafts = drafts.map((d) => d.id === id ? { ...d, status: 'applied' } : d)
  // Use saveWorkspace to write modbus; it will auto-bump configVersion
  const saved = saveWorkspace(home, room.cwd, {
    modbus: {
      connections: targetPack.connections,
      devices: targetPack.devices,
      points: targetPack.points,
      activeConnectionId: targetPack.activeConnectionId,
      activeDeviceId: targetPack.activeDeviceId,
      pollingByConnection: targetPack.pollingByConnection,
      visualization: targetPack.visualization,
      version: 3,
    },
    _replaceConfigDrafts: nextDrafts,
  })
  if (!saved.ok) return { ok: false, error: saved.error, summary }
  try {
    recordBenchEvent(home, room.cwd, { action: 'config-apply', ok: true, summary: '应用配置草稿 ' + id + '（v' + draft.baseConfigVersion + ' → v' + (saved.workspace.modbus.configVersion || 1) + '）' }, { source: 'user', sessionId: opts.sessionId || '' })
  } catch {}
  return { ok: true, draftId: id, prevVersion: draft.baseConfigVersion, nextVersion: saved.workspace.modbus.configVersion || 1, summary, workspace: saved.workspace }
}

// Task1/0.18.2: explicit frame-deletion semantics. Merge cannot express delete;
// this performs a whole-replacement of framesByConnection.
// options: { connectionId: 'c1' } | { all: true }
export const clearFramesByConnection = (home, cwd, options) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const ws = loadWorkspace(home, room.cwd)
  const pack = normalizeModbus(ws.modbus)
  const current = pack.framesByConnection || {}
  const connId = typeof (options && options.connectionId) === 'string' ? (options && options.connectionId).trim() : ''
  const all = options && options.all === true
  if (!all && !connId) return { ok: false, error: '缺少 connectionId 或 all' }
  let nextFrames
  if (all) {
    nextFrames = {}
  } else {
    // validate against connection list (not against the frames map) → idempotent
    const exists = (pack.connections || []).some((c) => c.id === connId)
    if (!exists) return { ok: false, error: '连接不存在: ' + connId, errorCode: 'CONNECTION_NOT_FOUND' }
    nextFrames = { ...current }
    delete nextFrames[connId]
  }
  const saved = saveWorkspace(home, room.cwd, {
    modbus: { version: 3 },
    _replaceFramesByConnection: nextFrames,
  })
  if (!saved.ok) return saved
  return { ok: true, cleared: all ? 'all' : connId, workspace: saved.workspace }
}

export const appendEvidence = (home, cwd, evidence) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const ws = loadWorkspace(home, room.cwd)
  const pack = normalizeModbus(ws.modbus)
  const list = Array.isArray(evidence) ? evidence : (evidence && typeof evidence === 'object' ? [evidence] : [])
  if (!list.length) return { ok: false, error: '缺少 evidence' }
  for (const ev of list) {
    if (!ev || typeof ev !== 'object') return { ok: false, error: 'invalid evidence' }
    // Task4/0.18.2: kind decides which typed id carries the generic id — a frame
    // id must never be validated as a point (no unconditional pointId = ev.pointId || ev.id)
    const kind = typeof ev.kind === 'string' ? ev.kind : ''
    const pointId = kind === 'point' ? (ev.pointId || ev.id) : ev.pointId
    const frameId = kind === 'frame' ? (ev.frameId || ev.id) : ev.frameId
    const alarmId = kind === 'alarm' ? (ev.alarmId || ev.id) : ev.alarmId
    const trendKey = kind === 'trend' ? (ev.trendKey || ev.id) : ev.trendKey
    const hasId = ev.id || pointId || frameId || alarmId || trendKey || ev.connectionId || ev.deviceId || ev.connId
    if (!hasId) return { ok: false, error: '证据缺少 ID', errorCode: 'TARGET_REQUIRED' }
    const rt = resolveTarget(pack, {
      connectionId: ev.connectionId || ev.connId,
      deviceId: ev.deviceId,
      pointId,
      frameId,
      alarmId,
      trendKey,
    })
    // For evidence that is a generic point/build/log, allow if it has no resolvable target? But if it has id that is not a point, resolveTarget will fail for point not found, which is not desired for build/log evidence.
    // So only validate if the evidence kind is point/frame/alarm/trend and has those IDs; for build/log, skip strict validation
    const isStrict = kind === 'point' || kind === 'frame' || kind === 'alarm' || kind === 'trend' || ev.pointId || ev.frameId || ev.alarmId || ev.trendKey
    if (isStrict && !rt.ok) return { ok: false, error: rt.error, errorCode: rt.errorCode }
    const evVer = Number(ev.version ?? ev.configVersion)
    if (Number.isFinite(evVer) && evVer !== (pack.configVersion || 1)) {
      return { ok: false, error: `版本漂移：证据基于 v${evVer} 当前 v${pack.configVersion || 1}`, errorCode: 'CONFIG_DRIFT' }
    }
  }
  const nextEvidence = [...(ws.focus.evidence || []), ...list].slice(-20)
  const saved = saveWorkspace(home, room.cwd, { focus: { ...ws.focus, evidence: nextEvidence } })
  if (!saved.ok) return saved
  return { ok: true, evidence: saved.workspace.focus.evidence }
}
