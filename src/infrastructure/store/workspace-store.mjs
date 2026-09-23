// @ts-check
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { normalizeConn, validateConnections } from '../../domain/modbus/connection-model.mjs'
import { normalizeFramesByConnection } from '../../domain/modbus/frames-buffer.mjs'
import { normalizeModbus } from '../../application/modbus/modbus-migration.mjs'
import { validateDevices } from '../../domain/modbus/device-model.mjs'
import { validateCandidateDeviceLayers } from '../../domain/modbus/device-identity.mjs'
import { recordKeilProjectSelect } from './workspace-keil-select.mjs'
import {
  normalizeTasks,
  normalizeTimeline,
  normalizeTimelineEvent,
  prepend,
  trimTimeline,
} from '../../domain/modbus/journal-model.mjs'
import { emptyLog, mergeLog, normalizeEvent } from '../../domain/prompt/prompt-log.mjs'
import { runExclusiveSync } from '../persistence/workspace-lock.mjs'
import { createWorkspaceRepository } from '../persistence/workspace-repository.mjs'
import { storeDir } from './bindings-store.mjs'
import { emptyFocusState, normalizeFocusState } from './focus-store.mjs'

const TIMELINE_WINDOW = 360
/** @typedef {Record<string, any>} WorkspaceJson */
/** @param {unknown} timeline @param {unknown} event */ const pushEvent = (timeline, event) => trimTimeline(prepend(timeline, event, TIMELINE_WINDOW))

/** @param {unknown} modbus */ export const stringifyConfigSlice = (modbus) => {
  try {
    const pack = modbus && typeof modbus === 'object' ? /** @type {WorkspaceJson} */ (modbus) : {}
    const slice = {
      connections: pack.connections || [],
      devices: pack.devices || [],
      points: pack.points || [],
      visualization: pack.visualization || null,
      share: pack.share || null,
      sessionConfigs: pack.sessionConfigs || null,
      privateClaimSessionId: pack.privateClaimSessionId || '',
    }
    return JSON.stringify(slice)
  } catch {
    return ''
  }
}

/** @returns {WorkspaceJson & { keil: WorkspaceJson, session: { boundId: string }, manualRequests: WorkspaceJson[], modbus: WorkspaceJson, focus: unknown, log: unknown, tasks: unknown, timeline: unknown }} */
export const emptyWorkspace = () => ({
  keil: { project: '', target: '', artifact: 'hex', download: '' },
  log: emptyLog(),
  tasks: [],
  timeline: [],
  session: { boundId: '' },
  manualRequests: [],
  modbus: normalizeModbus({ version: 3, configVersion: 1 }),
  focus: emptyFocusState(),
})

const MANUAL_STATUSES = new Set(['pending', 'done', 'rejected'])

/** @param {unknown} list */
const normalizeManualRequests = (list) => {
  if (!Array.isArray(list)) return []
  return list
    .slice(0, 20)
    .map((/** @type {WorkspaceJson} */ item) => ({
      id: typeof item?.id === 'string' ? item.id.trim() : '',
      text: typeof item?.text === 'string' ? item.text.trim().slice(0, 240) : '',
      status: MANUAL_STATUSES.has(item?.status) ? item.status : 'pending',
      createdAt: Number(item?.createdAt) > 0 ? Number(item.createdAt) : Date.now(),
      sessionId: typeof item?.sessionId === 'string' ? item.sessionId.trim() : '',
    }))
    .filter((item) => item.id && item.text)
}

/** @param {unknown} cwd */ export const workspaceKey = (cwd) =>
  createHash('sha256')
    .update(String(cwd || ''))
    .digest('hex')
    .slice(0, 16)

/** @param {string} home */ export const workspaceRepository = (home) =>
  createWorkspaceRepository({
    home,
    keyOf: workspaceKey,
    normalizeWorkspace,
  })

/** @param {string} home @param {string | undefined} cwd */ export const workspacePath = (home, cwd) => join(storeDir(home), 'workspaces', `${workspaceKey(cwd)}.json`)

/** @param {WorkspaceJson | null | undefined} input */ export const normalizeWorkspace = (input) => {
  const out = emptyWorkspace()
  const keil = input?.keil && typeof input.keil === 'object' ? /** @type {WorkspaceJson} */ (input.keil) : {}
  const modbus = input?.modbus && typeof input.modbus === 'object' ? /** @type {WorkspaceJson} */ (input.modbus) : {}
  out.keil.project = typeof keil.project === 'string' ? keil.project.trim() : ''
  out.keil.target = typeof keil.target === 'string' ? keil.target.trim() : ''
  const artifact = typeof keil.artifact === 'string' ? keil.artifact.trim().toLowerCase() : 'hex'
  out.keil.artifact = ['hex', 'bin', 'axf', 'elf'].indexOf(artifact) >= 0 ? artifact : 'hex'
  out.keil.download = typeof keil.download === 'string' ? keil.download.trim() : ''
  if (keil.flash && typeof keil.flash === 'object') {
    out.keil.flash = {
      interface: typeof keil.flash.interface === 'string' ? keil.flash.interface.trim() : '',
      target: typeof keil.flash.target === 'string' ? keil.flash.target.trim() : '',
    }
  }
  const rawLog = input && Array.isArray(input.log) ? input.log : []
  out.log = rawLog.map(normalizeEvent).slice(0, 8)
  out.tasks = normalizeTasks(input?.tasks)
  out.timeline = normalizeTimeline(input?.timeline)
  const session = input?.session && typeof input.session === 'object' ? /** @type {WorkspaceJson} */ (input.session) : {}
  out.session = { boundId: typeof session.boundId === 'string' ? session.boundId.trim() : '' }
  out.manualRequests = normalizeManualRequests(input?.manualRequests)
  out.modbus = normalizeModbus(modbus)
  out.focus = normalizeFocusState(input?.focus)
  return out
}

/** @param {string | undefined} home @param {string | undefined} cwd */ export const loadWorkspace = (home, cwd) => {
  try {
    const repo = createWorkspaceRepository({
      home: /** @type {string} */ (home),
      keyOf: workspaceKey,
      normalizeWorkspace,
    })
    return repo.load(cwd) || emptyWorkspace()
  } catch {
    return emptyWorkspace()
  }
}

/** @param {WorkspaceJson | null | undefined} incoming */
const isV3Patch = (incoming) => {
  if (!incoming || typeof incoming !== 'object') return false
  return (
    incoming.version === 3 ||
    Array.isArray(incoming.connections) ||
    (Array.isArray(incoming.devices) &&
      incoming.devices.some((/** @type {WorkspaceJson} */ d) => d && (d.connectionId || d.unitId !== undefined))) ||
    incoming.pollingByConnection !== undefined ||
    incoming.framesByConnection !== undefined ||
    incoming.activeConnectionId !== undefined ||
    incoming.activeDeviceId !== undefined ||
    incoming.alarmState !== undefined ||
    incoming.visualization !== undefined ||
    incoming.share !== undefined ||
    incoming.sessionConfigs !== undefined ||
    incoming.privateClaimSessionId !== undefined
  )
}

/** @param {WorkspaceJson | null | undefined} incoming @param {boolean} looksLegacy */
const isV2Partial = (incoming, looksLegacy) => {
  if (looksLegacy) return false
  if (!incoming || typeof incoming !== 'object') return false
  return [
    'conn',
    'points',
    'values',
    'polling',
    'alarmActive',
    'alarmState',
    'version',
    'frames',
    'framesLog',
    'framesByConnection',
  ].some((k) => Object.prototype.hasOwnProperty.call(incoming, k))
}

/** @param {WorkspaceJson} prev @param {WorkspaceJson | null | undefined} input */
export const applyWorkspacePatch = (prev, input) => {
  const incoming = /** @type {WorkspaceJson} */ (input?.modbus || {})
  const looksLegacy =
    incoming.conn === undefined &&
    ((Array.isArray(incoming.devices) &&
      incoming.devices.some((/** @type {WorkspaceJson} */ d) => d && (d.mode !== undefined || d.port !== undefined || Array.isArray(d.segments)))) ||
      incoming.mode !== undefined ||
      incoming.segments !== undefined)
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
    if (incoming.trend !== undefined) mergedModbus.trend = incoming.trend
    if (incoming.visualization !== undefined) mergedModbus.visualization = incoming.visualization
    if (incoming.share !== undefined) mergedModbus.share = incoming.share
    if (incoming.sessionConfigs !== undefined) mergedModbus.sessionConfigs = incoming.sessionConfigs
    if (incoming.privateClaimSessionId !== undefined)
      mergedModbus.privateClaimSessionId = incoming.privateClaimSessionId
    if (input && input._replaceFramesByConnection !== undefined) {
      const replaceMap =
        input._replaceFramesByConnection && typeof input._replaceFramesByConnection === 'object'
          ? input._replaceFramesByConnection
          : {}
      const replaced = /** @type {WorkspaceJson} */ ({})
      for (const [k, v] of Object.entries(replaceMap)) {
        replaced[k] = normalizeFramesByConnection({ [k]: v }, [])[k] || []
      }
      mergedModbus.framesByConnection = replaced
    }
    if (incoming.activeConnectionId !== undefined) mergedModbus.activeConnectionId = incoming.activeConnectionId
    if (incoming.activeDeviceId !== undefined) mergedModbus.activeDeviceId = incoming.activeDeviceId
    if (incoming.alarmState !== undefined) mergedModbus.alarmState = incoming.alarmState
    if (incoming.alarmActive !== undefined && incoming.alarmState === undefined)
      mergedModbus.alarmState = incoming.alarmActive
    if (incoming.polling !== undefined && incoming.pollingByConnection === undefined) {
      const aid = incoming.activeConnectionId || mergedModbus.activeConnectionId || mergedModbus.connections?.[0]?.id
      if (aid) {
        mergedModbus.pollingByConnection = {
          ...mergedModbus.pollingByConnection,
          [aid]: { ...(mergedModbus.pollingByConnection[aid] || {}), ...incoming.polling },
        }
      }
    }
    if (incoming.conn && typeof incoming.conn === 'object' && incoming.connections === undefined) {
      const aid = mergedModbus.activeConnectionId || mergedModbus.connections?.[0]?.id
      if (aid) {
        const raw = { ...incoming.conn }
        raw.slave = undefined
        mergedModbus.connections = (mergedModbus.connections || []).map((/** @type {WorkspaceJson} */ c) =>
          c.id === aid ? { ...c, conn: { ...c.conn, ...raw } } : c,
        )
      }
    }
    if (incoming.version !== undefined) mergedModbus.version = incoming.version
    mergedModbus.version = 3
  } else if (v2Partial) {
    mergedModbus = { ...prev.modbus }
    if (incoming.conn && typeof incoming.conn === 'object') {
      const aid = mergedModbus.activeConnectionId || mergedModbus.connections?.[0]?.id
      const raw = { ...incoming.conn }
      raw.slave = undefined
      mergedModbus.connections = (mergedModbus.connections || []).map((/** @type {WorkspaceJson} */ c) =>
        c.id === aid ? { ...c, conn: normalizeConn({ ...c.conn, ...raw }) } : c,
      )
    }
    if (incoming.points !== undefined) {
      const AREA_BY_FN = /** @type {Record<number, string>} */ ({ 1: 'coil', 2: 'discreteInput', 3: 'holdingRegister', 4: 'inputRegister' })
      const activeConnId = mergedModbus.activeConnectionId || mergedModbus.connections?.[0]?.id || 'c1'
      const activeDevId = mergedModbus.activeDeviceId || mergedModbus.devices?.[0]?.id || 'd1'
      const kept = (mergedModbus.points || []).filter(
        (/** @type {WorkspaceJson} */ p) => !(p.connectionId === activeConnId && p.deviceId === activeDevId),
      )
      const genId = (/** @type {string} */ pref) => pref + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
      const newPts = (Array.isArray(incoming.points) ? incoming.points : []).map((/** @type {WorkspaceJson} */ raw) => {
        const fn = Number(raw?.function)
        const area = AREA_BY_FN[fn] || 'holdingRegister'
        const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : genId('p')
        const address = Number(raw?.address)
        return {
          id,
          connectionId: activeConnId,
          deviceId: activeDevId,
          name: typeof raw.name === 'string' ? raw.name.slice(0, 40) : '',
          area,
          function: [1, 2, 3, 4].includes(fn) ? fn : 3,
          address: Number.isFinite(address) && address >= 0 && address <= 65535 ? Math.trunc(address) : 0,
          scale: Number.isFinite(Number(raw?.scale)) ? Number(raw.scale) : 1,
          offset: Number.isFinite(Number(raw?.offset)) ? Number(raw.offset) : 0,
          unit: typeof raw.unit === 'string' ? raw.unit.slice(0, 12) : '',
          alarmMin:
            raw.alarmMin === null || raw.alarmMin === undefined || raw.alarmMin === ''
              ? null
              : Number.isFinite(Number(raw.alarmMin))
                ? Number(raw.alarmMin)
                : null,
          alarmMax:
            raw.alarmMax === null || raw.alarmMax === undefined || raw.alarmMax === ''
              ? null
              : Number.isFinite(Number(raw.alarmMax))
                ? Number(raw.alarmMax)
                : null,
          alarmDeadband:
            raw.alarmDeadband === null || raw.alarmDeadband === undefined || raw.alarmDeadband === ''
              ? null
              : Number.isFinite(Number(raw.alarmDeadband)) && Number(raw.alarmDeadband) >= 0
                ? Number(raw.alarmDeadband)
                : null,
        }
      })
      mergedModbus.points = kept.concat(newPts)
    }
    if (incoming.values !== undefined) mergedModbus.values = incoming.values
    if (incoming.polling !== undefined) {
      const aid = mergedModbus.activeConnectionId || mergedModbus.connections?.[0]?.id
      if (aid)
        mergedModbus.pollingByConnection = {
          ...mergedModbus.pollingByConnection,
          [aid]: { ...(mergedModbus.pollingByConnection[aid] || {}), ...incoming.polling },
        }
    }
    if (incoming.alarmState !== undefined) mergedModbus.alarmState = incoming.alarmState
    if (incoming.alarmActive !== undefined && incoming.alarmState === undefined)
      mergedModbus.alarmState = incoming.alarmActive
    mergedModbus.version = 3
  } else {
    mergedModbus = input?.modbus ? { ...prev.modbus, ...incoming } : prev.modbus
  }
  const prevConfigSlice = stringifyConfigSlice(prev.modbus)
  const nextConfigSlice = stringifyConfigSlice(mergedModbus)
  const explicitVer = Number(incoming.configVersion)
  let nextConfigVersion = prev.modbus?.configVersion ? prev.modbus.configVersion : 1
  if (Number.isFinite(explicitVer) && explicitVer > nextConfigVersion) {
    nextConfigVersion = explicitVer
  } else if (prevConfigSlice && nextConfigSlice && prevConfigSlice !== nextConfigSlice) {
    nextConfigVersion = (nextConfigVersion || 1) + 1
  }
  mergedModbus.configVersion = nextConfigVersion

  const deviceLayerCheck = validateCandidateDeviceLayers(mergedModbus)
  if (!deviceLayerCheck.ok) {
    return { ok: false, errorCode: deviceLayerCheck.errorCode, error: deviceLayerCheck.error, conflicts: deviceLayerCheck.conflicts, workspace: prev }
  }

  const rawKeil = input?.keil
  const nextKeil = rawKeil
    ? {
        ...prev.keil,
        ...rawKeil,
        flash: rawKeil.flash !== undefined ? { ...prev.keil?.flash, ...rawKeil.flash } : prev.keil?.flash,
      }
    : prev.keil

  const workspace = normalizeWorkspace({
    ...prev,
    ...input,
    keil: nextKeil,
    modbus: mergedModbus,
    session: input?.session ? { ...prev.session, ...input.session } : prev.session,
    focus: input?.focus ? normalizeFocusState(input.focus) : prev.focus,
  })

  const connErrs = validateConnections(workspace.modbus.connections || [], workspace.modbus.devices || [])
  const devErrs = validateDevices(workspace.modbus.devices || [], workspace.modbus.connections || [])
  const allErrs = connErrs.concat(devErrs)
  if (allErrs.length > 0) {
    return { ok: false, error: allErrs.join('；'), workspace }
  }
  const keilSelected = recordKeilProjectSelect(workspace, input, prev)
  if (!keilSelected.ok) return keilSelected
  return { ok: true, workspace, prev }
}

/** @param {string} home @param {string | undefined} cwd @param {WorkspaceJson} input */ export const saveWorkspace = (home, cwd, input) => {
  const prev = loadWorkspace(home, cwd)
  const applied = applyWorkspacePatch(prev, input)
  if (!applied.ok) return applied
  const workspace = applied.workspace
  try {
    const rawPath = workspacePath(home, cwd)
    if (existsSync(rawPath)) {
      const rawContent = readFileSync(rawPath, 'utf8')
      const rawJson = JSON.parse(rawContent)
      const rawModbus = rawJson?.modbus
      const isV2OnDisk =
        rawModbus &&
        (rawModbus.version === 2 || (rawModbus.version === undefined && (rawModbus.conn || rawModbus.points)))
      if (isV2OnDisk && workspace.modbus.version === 3) {
        const bakPath = `${rawPath}.v2.bak`
        if (!existsSync(bakPath)) writeFileSync(bakPath, rawContent)
        const legacyBak = join(storeDir(home), 'workspaces', `${workspaceKey(cwd)}.v2.json`)
        if (!existsSync(legacyBak)) writeFileSync(legacyBak, rawContent)
      }
    }
  } catch {
    /* ignore backup errors */
  }
  mkdirSync(join(storeDir(home), 'workspaces'), { recursive: true })
  const key = workspaceKey(cwd)
  return runExclusiveSync(key, () => {
    const repo = createWorkspaceRepository({
      home,
      keyOf: workspaceKey,
      normalizeWorkspace,
    })
    repo.replaceForMigrationSync(cwd, workspace)
    return { ok: true, workspace, prev }
  })
}

/** @param {string} home @param {string | undefined} cwd @param {WorkspaceJson} input */
export async function saveWorkspaceAsync(home, cwd, input) {
  return workspaceRepository(home).update(cwd, null, async (/** @type {WorkspaceJson | null | undefined} */ current) =>
    applyWorkspacePatch(current || emptyWorkspace(), input),
  )
}

export const seedWorkspaceForTestSync = saveWorkspace
