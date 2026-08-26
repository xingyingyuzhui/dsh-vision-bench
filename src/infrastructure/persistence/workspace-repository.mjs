import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { backupFileSync, readJsonSync, writeJsonAtomicSync } from './atomic-json.mjs'
import { runExclusive, runExclusiveSync } from './workspace-lock.mjs'
import {
  legacyWorkspaceFile,
  loadV4Workspace,
  migrateLegacyWorkspace,
  saveV4Workspace,
  workspaceDir,
} from './workspace-migration.mjs'

/**
 * Workspace repository — Host is the sole writer.
 * @param {{
 *   home: string,
 *   keyOf: (cwd: string) => string,
 *   normalizeWorkspace: (raw: any) => any,
 * }} deps
 */
export function createWorkspaceRepository(deps) {
  const { home, keyOf, normalizeWorkspace } = deps

  const load = (cwd) => {
    const key = keyOf(cwd)
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

  const replace = (cwd, workspace) => {
    const key = keyOf(cwd)
    return runExclusiveSync(key, () => {
      const dir = workspaceDir(home, key)
      saveV4Workspace(dir, workspace)
      // dual-write legacy file for one-version rollback/readers
      writeJsonAtomicSync(legacyWorkspaceFile(home, key), workspace)
      return { ok: true, workspace }
    })
  }

  const update = async (cwd, expectedVersion, mutator) => {
    const key = keyOf(cwd)
    return runExclusive(key, async () => {
      const current = load(cwd)
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
      saveV4Workspace(workspaceDir(home, key), workspace)
      writeJsonAtomicSync(legacyWorkspaceFile(home, key), workspace)
      return { ok: true, workspace }
    })
  }

  const backup = (cwd) => {
    const key = keyOf(cwd)
    const legacy = legacyWorkspaceFile(home, key)
    const bak = `${legacy}.manual.bak`
    const ok = backupFileSync(legacy, bak)
    return { ok, path: bak }
  }

  return { load, update, replace, backup, workspaceDir: (cwd) => workspaceDir(home, keyOf(cwd)) }
}

export function persistWorkspaceAtomic(filePath, workspace) {
  writeJsonAtomicSync(filePath, workspace)
}
