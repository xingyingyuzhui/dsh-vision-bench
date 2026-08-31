// @ts-check
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  backupFileOnceSync,
  backupFileSync,
  readJsonSync,
  writeJsonAtomicSync,
  writeTextAtomicSync,
} from './atomic-json.mjs'

export const WORKSPACE_LAYOUT_VERSION = 4

/** Split a normalized workspace into config vs recoverable runtime. */
/**
 * @param {any} workspace
 * @returns {any}
 */
function persistableVisualization(viz) {
  const src = viz && typeof viz === 'object' ? viz : { schemaVersion: 1, components: [] }
  if (Number(src.schemaVersion) > 1) {
    const { unsupported, error, errorCode, ...out } = src
    void unsupported
    void error
    void errorCode
    return out
  }
  return {
    schemaVersion: 1,
    components: (Array.isArray(src.components) ? src.components : []).map((item) => {
      if (!item || typeof item !== 'object') return item
      const { layout, ...rest } = item
      void layout
      return rest
    }),
  }
}

export function splitWorkspaceParts(workspace) {
  const modbus = workspace?.modbus || {}
  const config = {
    layoutVersion: WORKSPACE_LAYOUT_VERSION,
    keil: workspace?.keil || {},
    session: workspace?.session || { boundId: '' },
    modbus: {
      version: modbus.version || 3,
      configVersion: modbus.configVersion || 1,
      connections: modbus.connections || [],
      devices: modbus.devices || [],
      points: modbus.points || [],
      pollingByConnection: modbus.pollingByConnection || {},
      visualization: persistableVisualization(modbus.visualization),
      activeConnectionId: modbus.activeConnectionId || '',
      activeDeviceId: modbus.activeDeviceId || '',
    },
  }
  const runtime = {
    layoutVersion: WORKSPACE_LAYOUT_VERSION,
    modbus: {
      values: modbus.values || [],
      alarmState: modbus.alarmState || {},
      alarmActive: modbus.alarmActive || {},
      framesByConnection: modbus.framesByConnection || {},
      trend: modbus.trend || {},
    },
    focus: workspace?.focus || null,
    tasks: workspace?.tasks || [],
    log: workspace?.log || [],
    timeline: workspace?.timeline || [],
    manualRequests: workspace?.manualRequests || [],
  }
  return { config, runtime }
}

/**
 * @param {any} config
 * @param {any} runtime
 * @returns {any}
 */
export function mergeWorkspaceParts(config, runtime) {
  const cfgMb = config?.modbus || {}
  const rtMb = runtime?.modbus || {}
  return {
    keil: config?.keil || {},
    session: config?.session || { boundId: '' },
    focus: runtime?.focus || null,
    tasks: runtime?.tasks || [],
    log: runtime?.log || [],
    timeline: runtime?.timeline || [],
    manualRequests: runtime?.manualRequests || [],
    modbus: {
      version: cfgMb.version || 3,
      configVersion: cfgMb.configVersion || 1,
      connections: cfgMb.connections || [],
      devices: cfgMb.devices || [],
      points: cfgMb.points || [],
      pollingByConnection: cfgMb.pollingByConnection || {},
      visualization: cfgMb.visualization || { schemaVersion: 2, columns: 12, components: [] },
      activeConnectionId: cfgMb.activeConnectionId || '',
      activeDeviceId: cfgMb.activeDeviceId || '',
      values: rtMb.values || [],
      alarmState: rtMb.alarmState || {},
      alarmActive: rtMb.alarmActive || {},
      framesByConnection: rtMb.framesByConnection || {},
      trend: rtMb.trend || {},
    },
  }
}

/**
 * @param {any} home
 * @param {any} key
 * @returns {any}
 */
export function workspaceDir(home, key) {
  return join(home, 'vision-bench', 'workspaces', key)
}

/**
 * @param {any} home
 * @param {any} key
 * @returns {any}
 */
export function legacyWorkspaceFile(home, key) {
  return join(home, 'vision-bench', 'workspaces', `${key}.json`)
}

/**
 * @param {any} dir
 * @returns {any}
 */
export function migrationMarkerPath(dir) {
  return join(dir, 'migration.json')
}

/**
 * Migrate legacy single-file workspace to v4 directory layout.
 * On failure, leaves the legacy file untouched.
 */
/**
 * @param {any} home
 * @param {any} key
 * @param {any} normalizeWorkspace
 * @returns {any}
 */
export function migrateLegacyWorkspace(home, key, normalizeWorkspace) {
  const legacy = legacyWorkspaceFile(home, key)
  const dir = workspaceDir(home, key)
  const marker = migrationMarkerPath(dir)
  if (existsSync(marker)) {
    const m = readJsonSync(marker, null)
    if (m && m.layoutVersion === WORKSPACE_LAYOUT_VERSION) {
      return { ok: true, already: true, dir }
    }
  }
  if (!existsSync(legacy)) return { ok: true, skipped: true }

  let raw
  try {
    raw = JSON.parse(readFileSync(legacy, 'utf8'))
  } catch (e) {
    return { ok: false, error: `legacy workspace JSON invalid: ${e instanceof Error ? e.message : String(e)}` }
  }

  const normalized = normalizeWorkspace(raw)
  const bak = `${legacy}.pre-v4.bak`
  try {
    backupFileSync(legacy, bak)
    mkdirSync(dir, { recursive: true })
    const { config, runtime } = splitWorkspaceParts(normalized)
    writeJsonAtomicSync(join(dir, 'config.json'), config)
    writeJsonAtomicSync(join(dir, 'runtime.json'), runtime)
    writeTextAtomicSync(join(dir, 'journal.jsonl'), '')
    const cfg2 = readJsonSync(join(dir, 'config.json'), null)
    const rt2 = readJsonSync(join(dir, 'runtime.json'), null)
    if (!cfg2 || !rt2) throw new Error('v4 verify read failed')
    writeJsonAtomicSync(marker, {
      layoutVersion: WORKSPACE_LAYOUT_VERSION,
      migratedAt: Date.now(),
      from: 'legacy-json',
      backup: bak,
    })
    return { ok: true, dir, backup: bak }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), rollback: 'legacy-kept' }
  }
}

/**
 * @param {any} dir
 * @param {any} normalizeWorkspace
 * @returns {any}
 */
export function loadV4Workspace(dir, normalizeWorkspace) {
  const marker = readJsonSync(migrationMarkerPath(dir), null)
  if (!marker || marker.layoutVersion !== WORKSPACE_LAYOUT_VERSION) return null
  const config = readJsonSync(join(dir, 'config.json'), null)
  const runtime = readJsonSync(join(dir, 'runtime.json'), null)
  if (!config || !runtime) return null
  return normalizeWorkspace(mergeWorkspaceParts(config, runtime))
}

/**
 * @param {any} dir
 * @param {any} workspace
 * @returns {any}
 */
export function saveV4Workspace(dir, workspace) {
  mkdirSync(dir, { recursive: true })
  const { config, runtime } = splitWorkspaceParts(workspace)
  writeJsonAtomicSync(join(dir, 'config.json'), config)
  writeJsonAtomicSync(join(dir, 'runtime.json'), runtime)
  if (!existsSync(migrationMarkerPath(dir))) {
    writeJsonAtomicSync(migrationMarkerPath(dir), {
      layoutVersion: WORKSPACE_LAYOUT_VERSION,
      migratedAt: Date.now(),
      from: 'direct-save',
    })
  }
  const journal = join(dir, 'journal.jsonl')
  if (!existsSync(journal)) writeTextAtomicSync(journal, '')
}

export function saveV4Runtime(dir, workspace) {
  mkdirSync(dir, { recursive: true })
  const { runtime } = splitWorkspaceParts(workspace)
  writeJsonAtomicSync(join(dir, 'runtime.json'), runtime)
}

export function preVisualizationV2BackupPath(dir) {
  return join(dir, 'config.pre-visualization-v2.bak.json')
}

export function backupPreVisualizationV2(dir, currentWorkspace) {
  const bak = preVisualizationV2BackupPath(dir)
  try {
    if (existsSync(bak) && !statSync(bak).isFile()) {
      return { ok: false, errorCode: 'VIZ_MIGRATION_BACKUP_FAILED', error: 'backup path is not a file', path: bak }
    }
  } catch {
    return { ok: false, errorCode: 'VIZ_MIGRATION_BACKUP_FAILED', error: 'backup path unreadable', path: bak }
  }
  if (existsSync(bak)) return { ok: true, existed: true, path: bak }
  mkdirSync(dir, { recursive: true })
  const configPath = join(dir, 'config.json')
  try {
    if (existsSync(configPath)) {
      const copied = backupFileOnceSync(configPath, bak)
      if (!copied.ok) return { ok: false, errorCode: 'VIZ_MIGRATION_BACKUP_FAILED', error: copied.error, path: bak }
    } else {
      const { config } = splitWorkspaceParts(currentWorkspace)
      writeJsonAtomicSync(bak, config)
    }
    if (!existsSync(bak)) {
      return { ok: false, errorCode: 'VIZ_MIGRATION_BACKUP_FAILED', error: 'backup missing after copy', path: bak }
    }
    return { ok: true, existed: false, path: bak }
  } catch (error) {
    return {
      ok: false,
      errorCode: 'VIZ_MIGRATION_BACKUP_FAILED',
      error: error instanceof Error ? error.message : String(error),
      path: bak,
    }
  }
}

/**
 * @param {any} home
 * @returns {any}
 */
export function listWorkspaceKeys(home) {
  const root = join(home, 'vision-bench', 'workspaces')
  if (!existsSync(root)) return []
  const out = new Set()
  for (const name of readdirSync(root)) {
    if (name.endsWith('.json') && !name.includes('.v2.') && !name.endsWith('.bak') && !name.includes('.pre-v4.')) {
      out.add(name.replace(/\.json$/, ''))
    } else if (!name.includes('.')) {
      out.add(name)
    }
  }
  return [...out]
}
