import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { backupFileSync, readJsonSync, writeJsonAtomicSync } from './atomic-json.mjs'

export const WORKSPACE_LAYOUT_VERSION = 4

/** Split a normalized workspace into config vs recoverable runtime. */
export function splitWorkspaceParts(workspace) {
  const modbus = workspace?.modbus || {}
  const config = {
    layoutVersion: WORKSPACE_LAYOUT_VERSION,
    keil: workspace?.keil || {},
    session: workspace?.session || { boundId: '' },
    configDrafts: workspace?.configDrafts || [],
    modbus: {
      version: modbus.version || 3,
      configVersion: modbus.configVersion || 1,
      connections: modbus.connections || [],
      devices: modbus.devices || [],
      points: modbus.points || [],
      pollingByConnection: modbus.pollingByConnection || {},
      visualization: modbus.visualization || { schemaVersion: 1, components: [] },
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

export function mergeWorkspaceParts(config, runtime) {
  const cfgMb = config?.modbus || {}
  const rtMb = runtime?.modbus || {}
  return {
    keil: config?.keil || {},
    session: config?.session || { boundId: '' },
    configDrafts: config?.configDrafts || [],
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
      visualization: cfgMb.visualization || { schemaVersion: 1, components: [] },
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

export function workspaceDir(home, key) {
  return join(home, 'vision-bench', 'workspaces', key)
}

export function legacyWorkspaceFile(home, key) {
  return join(home, 'vision-bench', 'workspaces', `${key}.json`)
}

export function migrationMarkerPath(dir) {
  return join(dir, 'migration.json')
}

/**
 * Migrate legacy single-file workspace to v4 directory layout.
 * On failure, leaves the legacy file untouched.
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
    return { ok: false, error: `legacy workspace JSON invalid: ${e?.message}` }
  }

  const normalized = normalizeWorkspace(raw)
  const bak = `${legacy}.pre-v4.bak`
  try {
    backupFileSync(legacy, bak)
    mkdirSync(dir, { recursive: true })
    const { config, runtime } = splitWorkspaceParts(normalized)
    writeJsonAtomicSync(join(dir, 'config.json'), config)
    writeJsonAtomicSync(join(dir, 'runtime.json'), runtime)
    writeFileSync(join(dir, 'journal.jsonl'), '', 'utf8')
    // verify
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
    // leave legacy intact; best-effort cleanup of partial dir contents is intentional soft
    return { ok: false, error: String(e?.message || e), rollback: 'legacy-kept' }
  }
}

export function loadV4Workspace(dir, normalizeWorkspace) {
  const marker = readJsonSync(migrationMarkerPath(dir), null)
  if (!marker || marker.layoutVersion !== WORKSPACE_LAYOUT_VERSION) return null
  const config = readJsonSync(join(dir, 'config.json'), null)
  const runtime = readJsonSync(join(dir, 'runtime.json'), null)
  if (!config || !runtime) return null
  return normalizeWorkspace(mergeWorkspaceParts(config, runtime))
}

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
  // keep journal file present
  const journal = join(dir, 'journal.jsonl')
  if (!existsSync(journal)) writeFileSync(journal, '', 'utf8')
}

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
