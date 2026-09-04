// @ts-check

import { stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import { requireKeilProject, requireWorkspaceCwd } from '../../../bench-paths.mjs'
import { loadWorkspace } from '../../../bench-store.mjs'
import { keilErrorResult } from '../../domain/keil/errors.mjs'
import {
  MAX_FUNCS_TOTAL,
  MAX_MAP_DEFINES,
  MAX_MAP_EDGES,
  MAX_MAP_FILES,
  MAX_MAP_INCLUDES,
  kindOfFile,
  normalizeKeilProjectMap,
} from '../../domain/keil/project-model.mjs'
import {
  checkFileReadable,
  isInside,
  readSource,
  scanProjects,
} from '../../infrastructure/keil/keil-project-scanner.mjs'
import {
  listTargets,
  parseUvprojxFile,
  pickTarget,
  readGroups,
  readVariousControls,
} from '../../infrastructure/keil/uvprojx-parser.mjs'
import { extractFunctions, extractIncludes } from '../../infrastructure/program/source-analyzer.mjs'

/**
 * Format a relative path with forward slashes.
 * @param {string} root
 * @param {string} target
 * @returns {string}
 */
function relPath(root, target) {
  try {
    return relative(resolve(root), resolve(target)).replaceAll('\\', '/')
  } catch {
    return target.replaceAll('\\', '/')
  }
}

/**
 * Resolve an included header file against candidate directories.
 * @param {string} name
 * @param {string} fromFile
 * @param {string[]} incDirs
 * @param {string} workspace
 * @returns {Promise<string | null>}
 */
async function resolveInclude(name, fromFile, incDirs, workspace) {
  const candidates = [resolve(dirname(fromFile), name)]
  for (const incDir of incDirs) {
    candidates.push(resolve(incDir, name))
  }

  for (const candidate of candidates) {
    if (!isInside(workspace, candidate)) {
      continue
    }
    try {
      const st = await stat(candidate)
      if (st.isFile()) {
        return candidate
      }
    } catch {}
  }
  return null
}

/**
 * Map Keil project structure, groups, files, includes, defines and function signatures.
 * @param {string} projectPath
 * @param {string} [target]
 * @param {string} [root]
 * @param {{ maxFiles?: number, maxEdges?: number, maxFuncsTotal?: number }} [options]
 * @returns {Promise<ReturnType<typeof normalizeKeilProjectMap>>}
 */
export async function mapProject(projectPath, target = '', root = '', options = {}) {
  const p = resolve(projectPath)
  const workspace = root ? resolve(root) : dirname(p)
  const maxFiles = options.maxFiles || MAX_MAP_FILES
  const maxEdges = options.maxEdges || MAX_MAP_EDGES
  const maxFuncsTotal = options.maxFuncsTotal || MAX_FUNCS_TOTAL

  const { xmlRoot } = await parseUvprojxFile(p)
  const picked = pickTarget(xmlRoot, (target || '').trim())
  if (!picked) {
    throw new Error('工程里没有 Target')
  }
  const { targetNode, targetName } = picked

  const controls = readVariousControls(targetNode)
  /** @type {string[]} */
  const seenInc = []
  for (const item of controls.includes) {
    if (!seenInc.includes(item)) seenInc.push(item)
  }
  const includesTotal = seenInc.length
  const includes = seenInc.slice(0, MAX_MAP_INCLUDES)

  /** @type {string[]} */
  const seenDef = []
  for (const item of controls.defines) {
    if (!seenDef.includes(item)) seenDef.push(item)
  }
  const definesTotal = seenDef.length
  const defines = seenDef.slice(0, MAX_MAP_DEFINES)

  /** @type {Array<{ path: string, exists: boolean, inside: boolean }>} */
  const incRows = []
  for (const item of includes) {
    const resolved = isAbsolute(item) ? resolve(item) : resolve(dirname(p), item)
    const inside = isInside(workspace, resolved)
    let exists = false
    if (inside) {
      try {
        const st = await stat(resolved)
        exists = st.isDirectory() || st.isFile()
      } catch {
        exists = false
      }
    }
    incRows.push({
      path: item.replaceAll('\\', '/'),
      exists,
      inside,
    })
  }

  const incDirs = incRows.map((row) => (isAbsolute(row.path) ? resolve(row.path) : resolve(dirname(p), row.path)))

  const rawGroups = readGroups(targetNode)
  /** @type {Array<{ name: string, files: any[] }>} */
  const groups = []
  let fileCount = 0
  let missing = 0
  let unreadable = 0
  let funcTotal = 0
  /** @type {Array<{ from: string, name: string, to: string, resolved: boolean }>} */
  const includeEdges = []
  let filesCapped = false
  let edgesCapped = false

  for (const group of rawGroups) {
    /** @type {any[]} */
    const files = []
    for (const file of group.files) {
      if (fileCount >= maxFiles) {
        filesCapped = true
        break
      }
      const fname = file.name
      const fpath = file.path || fname
      if (!fpath) continue

      const resolved = isAbsolute(fpath) ? resolve(fpath) : resolve(dirname(p), fpath)
      const inside = isInside(workspace, resolved)
      let exists = false
      let readable = false
      let reason = 'outside'
      let rel = fname || basename(fpath)

      if (inside) {
        try {
          const st = await stat(resolved)
          exists = st.isFile()
        } catch {
          exists = false
        }
        if (!exists) {
          readable = false
          reason = 'missing'
          missing++
          rel = relPath(workspace, resolved)
        } else {
          const [ok, readReason] = await checkFileReadable(resolved)
          readable = ok
          reason = ok ? '' : readReason
          if (!readable) {
            unreadable++
          }
          rel = relPath(workspace, resolved)
        }
      }

      const kind = kindOfFile(fname || basename(fpath))
      /** @type {Array<{ name: string, line: number }>} */
      let functions = []

      if (inside && readable && (kind === 'c' || kind === 'h') && funcTotal < maxFuncsTotal) {
        const source = await readSource(resolved)
        if (kind === 'c') {
          functions = extractFunctions(source)
          funcTotal += functions.length
        }
        for (const incName of extractIncludes(source)) {
          if (includeEdges.length >= maxEdges) {
            edgesCapped = true
            break
          }
          const dest = await resolveInclude(incName, resolved, incDirs, workspace)
          const destInside = Boolean(dest && isInside(workspace, dest))
          includeEdges.push({
            from: rel,
            name: incName,
            to: destInside && dest ? relPath(workspace, dest) : '',
            resolved: destInside,
          })
        }
      }

      files.push({
        name: fname || basename(fpath),
        kind,
        rel,
        exists,
        readable,
        reason: readable ? '' : reason,
        inside,
        functions,
      })
      fileCount++
    }
    groups.push({ name: group.name, files })
    if (filesCapped) {
      break
    }
  }

  return normalizeKeilProjectMap({
    project: p,
    target: targetName,
    groups,
    includes: incRows,
    defines,
    include_edges: includeEdges,
    truncated: {
      files: filesCapped,
      includes: includesTotal > MAX_MAP_INCLUDES,
      defines: definesTotal > MAX_MAP_DEFINES,
      include_edges: edgesCapped,
      functions: funcTotal >= maxFuncsTotal,
    },
    limits: {
      files: maxFiles,
      includes: MAX_MAP_INCLUDES,
      defines: MAX_MAP_DEFINES,
      include_edges: maxEdges,
      functions: maxFuncsTotal,
    },
    counts: {
      groups: groups.length,
      files: fileCount,
      missing,
      unreadable,
      includes: incRows.length,
      defines: defines.length,
      include_edges: includeEdges.length,
      functions: funcTotal,
    },
  })
}

/**
 * Keil project scan service operation (replaces keil_project.py scan).
 * @param {string} home
 * @param {string} cwd
 * @param {any} [opts]
 * @returns {Promise<{ ok: boolean, error?: string, result?: any, exitCode?: number }>}
 */
export async function keilScan(home, cwd, opts) {
  const room = requireWorkspaceCwd(cwd)
  if (room.error || !room.cwd) return { ok: false, error: room.error || '需要工作区目录' }

  const { projects, error } = await scanProjects(room.cwd)
  if (error) {
    return {
      ok: false,
      error: error.error?.message || '扫描失败',
      result: error,
      exitCode: 1,
    }
  }

  return {
    ok: true,
    result: {
      status: 'ok',
      action: 'scan',
      details: { projects, count: projects.length },
    },
    exitCode: 0,
  }
}

/**
 * Keil project targets enumeration service operation (replaces keil_project.py targets).
 * @param {string} home
 * @param {string} cwd
 * @param {string} project
 * @param {any} [opts]
 * @returns {Promise<{ ok: boolean, error?: string, result?: any, exitCode?: number }>}
 */
export async function keilTargets(home, cwd, project, opts) {
  const room = requireWorkspaceCwd(cwd)
  if (room.error || !room.cwd) return { ok: false, error: room.error || '需要工作区目录' }
  const keil = /** @type {any} */ (requireKeilProject(room.cwd, project))
  if (keil.error) return { ok: false, error: keil.error }

  try {
    const targets = await listTargets(keil.project)
    return {
      ok: true,
      result: {
        status: 'ok',
        action: 'targets',
        details: {
          project: keil.project,
          targets,
          count: targets.length,
        },
      },
      exitCode: 0,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      error: message,
      result: keilErrorResult('targets', 'invalid_project', message),
      exitCode: 1,
    }
  }
}

/**
 * Keil project map service operation (replaces keil_project.py map).
 * @param {string} home
 * @param {string} cwd
 * @param {string} [project]
 * @param {string} [target]
 * @param {any} [opts]
 * @returns {Promise<{ ok: boolean, error?: string, result?: any, exitCode?: number }>}
 */
export async function keilMap(home, cwd, project, target, opts) {
  const room = requireWorkspaceCwd(cwd)
  if (room.error || !room.cwd) return { ok: false, error: room.error || '需要工作区目录' }
  const workspace = loadWorkspace(home, room.cwd)
  const picked = project || workspace.keil?.project
  const keil = /** @type {any} */ (requireKeilProject(room.cwd, picked))
  if (keil.error) return { ok: false, error: keil.error }

  const name = (target || workspace.keil?.target || '').trim()

  try {
    const details = await mapProject(keil.project, name, room.cwd)
    return {
      ok: true,
      result: {
        status: 'ok',
        action: 'map',
        details,
      },
      exitCode: 0,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      error: message,
      result: keilErrorResult('map', 'invalid_project', message),
      exitCode: 1,
    }
  }
}
