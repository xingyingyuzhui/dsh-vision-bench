// @ts-check
import { existsSync } from 'node:fs'
import { backupFileSync, readJsonSync, writeJsonAtomicSync } from './atomic-json.mjs'
import { runExclusive, runExclusiveSync } from './workspace-lock.mjs'
import {
  legacyWorkspaceFile,
  listWorkspaceKeys as listKeysOnDisk,
  loadV4Workspace,
  migrateLegacyWorkspace,
  saveV4Workspace,
  workspaceDir,
} from './workspace-migration.mjs'

const RUNTIME_TOP = ['tasks', 'log', 'timeline', 'manualRequests', 'focus']
const RUNTIME_MODBUS = ['values', 'alarmState', 'alarmActive', 'framesByConnection', 'trend', 'pollingByConnection']

/**
 * @param {any} current
 * @param {any} next
 */
function applyRuntimeOnly(current, next) {
  const curMb = current?.modbus && typeof current.modbus === 'object' ? current.modbus : {}
  const nextMb = next?.modbus && typeof next.modbus === 'object' ? next.modbus : {}
  const out = { ...current }
  for (const key of RUNTIME_TOP) {
    if (next && Object.prototype.hasOwnProperty.call(next, key)) out[key] = next[key]
  }
  const modbus = { ...curMb }
  for (const key of RUNTIME_MODBUS) {
    if (Object.prototype.hasOwnProperty.call(nextMb, key)) modbus[key] = nextMb[key]
  }
  modbus.configVersion = curMb.configVersion
  out.modbus = modbus
  return out
}

/**
 * Workspace repository — Host is the sole writer.
 * @param {{
 *   home: string,
 *   keyOf: (cwd: string) => string,
 *   normalizeWorkspace: (raw: any) => any,
 *   persistWorkspace?: (key: string, workspace: any) => void,
 * }} deps
 */
export function createWorkspaceRepository(deps) {
  const { home, keyOf, normalizeWorkspace } = deps

  /** @param {any} key @param {any} workspace */
  const persist = (key, workspace) => {
    if (typeof deps.persistWorkspace === 'function') {
      deps.persistWorkspace(key, workspace)
      return
    }
    const dir = workspaceDir(home, key)
    saveV4Workspace(dir, workspace)
    writeJsonAtomicSync(legacyWorkspaceFile(home, key), workspace)
  }

  /** @param {any} key */
  const loadByKey = (key) => {
    const dir = workspaceDir(home, key)
    const legacyPath = legacyWorkspaceFile(home, key)
    if (existsSync(legacyPath)) {
      const migrated = migrateLegacyWorkspace(home, key, normalizeWorkspace)
      if (migrated && migrated.ok === false) {
        const legacy = readJsonSync(legacyPath, null)
        return legacy ? normalizeWorkspace(legacy) : null
      }
    }
    const v4 = loadV4Workspace(dir, normalizeWorkspace)
    if (v4) return v4
    const legacy = readJsonSync(legacyPath, null)
    return legacy ? normalizeWorkspace(legacy) : null
  }

  /** @param {any} cwd */
  const load = (cwd) => loadByKey(keyOf(cwd))

  /** @param {any} cwd @param {any} workspace */
  const replaceForMigrationSync = (cwd, workspace) => {
    const key = keyOf(cwd)
    return runExclusiveSync(key, () => {
      persist(key, workspace)
      return { ok: true, workspace }
    })
  }

  /** @param {any} cwd @param {any} workspace */
  const seedWorkspaceForTestSync = (cwd, workspace) => replaceForMigrationSync(cwd, workspace)
  /** @param {any} cwd @param {any} workspace */
  const replace = (cwd, workspace) => replaceForMigrationSync(cwd, workspace)
  /** @param {any} cwd @param {any} workspace */
  const replaceForMigration = (cwd, workspace) => replaceForMigrationSync(cwd, workspace)

  /** @param {any} cwd @param {any} expectedVersion @param {any} mutator */
  const update = async (cwd, expectedVersion, mutator) => {
    const key = keyOf(cwd)
    return runExclusive(key, async () => {
      const current = loadByKey(key) || normalizeWorkspace({})
      const cfgVer = Number(current?.modbus?.configVersion) || 1
      if (expectedVersion != null && Number(expectedVersion) !== cfgVer) {
        return {
          ok: false,
          errorCode: 'CONFIG_DRIFT',
          error: 'configVersion drift',
          details: { expectedVersion, actualVersion: cfgVer },
        }
      }
      const next = await mutator(current)
      if (!next || next.ok === false) return next
      const workspace = next.workspace || next
      try {
        persist(key, workspace)
      } catch (error) {
        return {
          ok: false,
          errorCode: 'WORKSPACE_WRITE_FAILED',
          error: error instanceof Error ? error.message : String(error),
        }
      }
      return { ok: true, workspace, prev: current }
    })
  }

  /** @param {any} cwd @param {any} expectedVersion @param {any} mutator */
  const mutateConfig = async (cwd, expectedVersion, mutator) => {
    const key = keyOf(cwd)
    return runExclusive(key, async () => {
      const current = loadByKey(key)
      if (!current) {
        return { ok: false, errorCode: 'WORKSPACE_NOT_FOUND', error: 'workspace not found' }
      }
      const previousConfigVersion = Number(current?.modbus?.configVersion) || 1
      if (expectedVersion != null && Number(expectedVersion) !== previousConfigVersion) {
        return {
          ok: false,
          errorCode: 'CONFIG_DRIFT',
          error: 'configVersion drift',
          details: { expectedVersion, actualVersion: previousConfigVersion },
        }
      }
      const next = await mutator(current)
      if (!next || next.ok === false) return next
      const workspace = next.workspace || next
      const normalized = normalizeWorkspace(workspace)
      const nextVersion = previousConfigVersion + 1
      normalized.modbus = { ...normalized.modbus, configVersion: nextVersion }
      try {
        persist(key, normalized)
      } catch (error) {
        return {
          ok: false,
          errorCode: 'WORKSPACE_WRITE_FAILED',
          error: error instanceof Error ? error.message : String(error),
          previousConfigVersion,
        }
      }
      return {
        ok: true,
        workspace: normalized,
        previousConfigVersion,
        nextConfigVersion: nextVersion,
      }
    })
  }

  /** @param {any} key @param {any} mutator */
  const applyRuntimeMutator = async (key, mutator) => {
    const current = loadByKey(key)
    if (!current) {
      return { ok: false, errorCode: 'WORKSPACE_NOT_FOUND', error: 'workspace not found' }
    }
    const previousConfigVersion = Number(current?.modbus?.configVersion) || 1
    let next
    try {
      next = await mutator(current)
    } catch (error) {
      return {
        ok: false,
        errorCode: 'RUNTIME_MUTATOR_FAILED',
        error: error instanceof Error ? error.message : String(error),
      }
    }
    if (!next || next.ok === false) return next
    const raw = next.workspace || next
    const merged = applyRuntimeOnly(current, raw)
    const workspace = normalizeWorkspace(merged)
    workspace.modbus = { ...workspace.modbus, configVersion: previousConfigVersion }
    try {
      persist(key, workspace)
    } catch (error) {
      return {
        ok: false,
        errorCode: 'WORKSPACE_WRITE_FAILED',
        error: error instanceof Error ? error.message : String(error),
      }
    }
    return { ok: true, workspace, previousConfigVersion, nextConfigVersion: previousConfigVersion, prev: current }
  }

  /** @param {any} key @param {any} mutator */
  const mutateRuntimeByKey = (key, mutator) => runExclusive(key, () => applyRuntimeMutator(key, mutator))
  /** @param {any} cwd @param {any} mutator */
  const updateRuntime = (cwd, mutator) => mutateRuntimeByKey(keyOf(cwd), mutator)
  /** @param {any} cwd @param {any} mutator */
  const mutateRuntime = (cwd, mutator) => mutateRuntimeByKey(keyOf(cwd), mutator)

  const listWorkspaceKeys = () => listKeysOnDisk(home)

  /** @param {any} [options] */
  const sweepInterruptedTasks = async (options = {}) => {
    const now = Date.now()
    const markInterruptedTask =
      options.markInterruptedTask ||
      ((/** @type {any} */ item) => ({
        ...item,
        status: 'error',
        endedAt: now,
        summary: `${item.summary || `${item.type || 'task'} 任务`}（上次运行中断）`,
      }))
    const appendSweepEvent =
      options.appendSweepEvent ||
      ((/** @type {any} */ timeline, /** @type {any} */ stale) => {
        const event = {
          kind: 'sweep',
          source: 'system',
          ok: false,
          at: now,
          summary: `启动清扫：${stale.length} 个中断任务已标记失败`,
        }
        return [event, ...(Array.isArray(timeline) ? timeline : [])].slice(0, 360)
      })
    let swept = 0
    const errors = []
    for (const key of listWorkspaceKeys()) {
      const current = loadByKey(key)
      if (!current) continue
      const stale = (current.tasks || []).filter((/** @type {any} */ item) => item && item.status === 'running')
      if (!stale.length) continue
      const result = await mutateRuntimeByKey(key, (/** @type {any} */ ws) => {
        const tasks = (ws.tasks || []).map((/** @type {any} */ item) =>
          item && item.status === 'running' ? markInterruptedTask(item, now) : item,
        )
        return {
          ...ws,
          tasks,
          timeline: appendSweepEvent(ws.timeline, stale, now),
        }
      })
      if (!result.ok) {
        errors.push({
          key,
          error: result.error || 'sweep write failed',
          errorCode: result.errorCode || 'SWEEP_WRITE_FAILED',
        })
        continue
      }
      const reloaded = loadByKey(key)
      const staleIds = new Set(stale.map((/** @type {any} */ item) => item.id).filter(Boolean))
      const stillRunning = (reloaded?.tasks || []).some(
        (/** @type {any} */ item) =>
          item && item.status === 'running' && (staleIds.size === 0 || staleIds.has(item.id)),
      )
      if (stillRunning) {
        errors.push({
          key,
          error: 'sweep did not persist',
          errorCode: 'SWEEP_NOT_PERSISTED',
        })
        continue
      }
      swept += stale.length
    }
    return { ok: errors.length === 0, swept, errors }
  }

  /** @param {any} cwd */
  const backup = (cwd) => {
    const key = keyOf(cwd)
    const legacy = legacyWorkspaceFile(home, key)
    const bak = `${legacy}.manual.bak`
    const ok = backupFileSync(legacy, bak)
    return { ok, path: bak }
  }

  return {
    load,
    loadByKey,
    update,
    mutateConfig,
    updateRuntime,
    mutateRuntime,
    replace,
    replaceForMigration,
    replaceForMigrationSync,
    seedWorkspaceForTestSync,
    backup,
    listWorkspaceKeys,
    sweepInterruptedTasks,
    /** @param {any} cwd */
    workspaceDir: (cwd) => workspaceDir(home, keyOf(cwd)),
  }
}

/** @param {any} filePath @param {any} workspace */
export function persistWorkspaceAtomic(filePath, workspace) {
  writeJsonAtomicSync(filePath, workspace)
}
