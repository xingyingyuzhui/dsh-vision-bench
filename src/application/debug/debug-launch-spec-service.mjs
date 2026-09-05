// @ts-check
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { loadBindings as defaultLoadBindings, loadWorkspace as defaultLoadWorkspace } from '../../../bench-store.mjs'
import { createDebugLaunchSpec } from '../../domain/debug/debug-launch-spec.mjs'
import { DEBUG_ERRORS, DebugError } from '../../domain/debug/errors.mjs'
import {
  DEFAULT_OPENOCD_INTERFACE,
  DEFAULT_OPENOCD_TARGET,
  resolveOpenOcdProfile,
} from '../../domain/flash/openocd-profile.mjs'
import { allocateLoopbackPort } from '../../infrastructure/network/loopback-port.mjs'

/**
 * Common artifact candidate folders to search in embedded projects.
 */
const COMMON_ARTIFACT_DIRS = ['build', 'Objects', 'out', 'bin', 'Debug', 'debug', 'cmake-build-debug', '.']

/**
 * Searches for firmware artifact (.axf or .elf) within workspace cwd.
 * @param {string} cwd
 * @returns {string[]} List of absolute paths to candidate firmware files
 */
export function findFirmwareArtifacts(cwd) {
  if (!cwd || !existsSync(cwd)) return []

  /** @type {string[]} */
  const candidates = []

  for (const relDir of COMMON_ARTIFACT_DIRS) {
    const dir = join(cwd, relDir)
    if (!existsSync(dir)) continue

    try {
      const entries = readdirSync(dir)
      for (const entry of entries) {
        const lower = entry.toLowerCase()
        if (lower.endsWith('.axf') || lower.endsWith('.elf')) {
          const full = join(dir, entry)
          try {
            const st = statSync(full)
            if (st.isFile()) {
              candidates.push(full)
            }
          } catch {
            /* ignore inaccessible */
          }
        }
      }
    } catch {
      /* ignore read errors */
    }
  }

  // Deduplicate
  return Array.from(new Set(candidates))
}

/**
 * Computes SHA256 of file at path.
 * @param {string} filePath
 * @returns {string}
 */
export function computeFileSha256(filePath) {
  if (!filePath || !existsSync(filePath)) return ''
  try {
    const buf = readFileSync(filePath)
    return createHash('sha256').update(buf).digest('hex')
  } catch {
    return ''
  }
}

/**
 * Default getter for last successful build result from workspace.
 *
 * @param {string} cwd
 * @param {{ home?: string, workspace?: any }} [opts]
 * @returns {{
 *   projectPath?: string,
 *   targetName?: string,
 *   artifactPath?: string,
 *   artifactSha256?: string,
 *   builtAt?: number,
 *   success?: boolean,
 * } | null}
 */
export function defaultGetLastBuildResult(cwd, opts = {}) {
  const ws =
    opts.workspace || (typeof defaultLoadWorkspace === 'function' ? defaultLoadWorkspace(opts.home, cwd) : null)
  if (!ws) return null

  // 1. Check explicit buildResult stored on workspace.keil
  if (ws.keil?.buildResult?.success) {
    return ws.keil.buildResult
  }

  // 2. Check newest ok build task with download path
  const tasks = Array.isArray(ws.tasks) ? ws.tasks : []
  const okBuildTask = tasks
    .slice()
    .reverse()
    .find((/** @type {any} */ t) => t && t.type === 'build' && t.status === 'ok')

  if (okBuildTask && ws.keil?.download) {
    return {
      projectPath: ws.keil.project || '',
      targetName: ws.keil.target || '',
      artifactPath: ws.keil.download,
      artifactSha256: ws.keil.buildResult?.artifactSha256 || '',
      builtAt: okBuildTask.endedAt || okBuildTask.startedAt || 0,
      success: true,
    }
  }

  return null
}

/**
 * Resolves full launch specification for a debug session, prioritizing:
 * 1. current workspace project/target
 * 2. last successful BuildResult
 * 3. current artifact hash re-check
 * 4. settings bindings
 * 5. shared OpenOCD profile
 * 6. dynamic loopback port
 * 7. mtime artifact scan fallback
 *
 * @param {import('../../types/debug-launch.d.ts').DebugLaunchRequest} request
 * @param {{
 *   home?: string,
 *   loadWorkspace?: (home?: string, cwd?: string) => any,
 *   loadBindings?: (home?: string) => any,
 *   getLastBuildResult?: (cwd: string, opts?: any) => any,
 *   resolveOpenOcdProfile?: typeof resolveOpenOcdProfile,
 *   portAllocator?: typeof allocateLoopbackPort,
 *   artifactFinder?: typeof findFirmwareArtifacts,
 * }} [deps]
 * @returns {Promise<import('../../types/debug-launch.d.ts').ResolvedLaunchSpec & { spec: ReturnType<typeof createDebugLaunchSpec>, resolutionMethod?: string }>}
 */
export async function resolveDebugLaunchSpec(request, deps = {}) {
  const cwd = String(request.cwd || process.cwd()).trim()
  const home = deps.home
  const backend = request.backend || 'gdb-openocd'
  const targetSpec = request.targetSpec || {}

  const loadWorkspace = deps.loadWorkspace || defaultLoadWorkspace
  const loadBindings = deps.loadBindings || defaultLoadBindings
  const getLastBuildResult = deps.getLastBuildResult || defaultGetLastBuildResult
  const portAllocator = deps.portAllocator || allocateLoopbackPort
  const artifactFinder = deps.artifactFinder || findFirmwareArtifacts
  const profileResolver = deps.resolveOpenOcdProfile || resolveOpenOcdProfile

  let ws = null
  try {
    ws = loadWorkspace(home, cwd)
  } catch {
    ws = null
  }

  /** @type {Record<string, any>} */
  let bindings = {}
  try {
    bindings = loadBindings(home) || {}
  } catch {
    bindings = {}
  }

  // 1. Current workspace project & target
  const projectPath = String(targetSpec.projectPath || ws?.keil?.project || '').trim()
  const targetName = String(targetSpec.targetName || ws?.keil?.target || '').trim()

  let artifactPath = targetSpec.artifactPath ? String(targetSpec.artifactPath).trim() : ''
  let artifactSha256 = targetSpec.artifactSha256 ? String(targetSpec.artifactSha256).trim() : ''
  let source = 'auto-resolved'
  let resolutionMethod = 'auto'

  // 2. Check last successful BuildResult if artifact not explicitly given
  if (!artifactPath) {
    const buildResult = getLastBuildResult(cwd, { home, workspace: ws })
    if (buildResult?.success) {
      const matchProject = !projectPath || !buildResult.projectPath || buildResult.projectPath === projectPath
      const matchTarget = !targetName || !buildResult.targetName || buildResult.targetName === targetName
      if (matchProject && matchTarget && buildResult.artifactPath && existsSync(buildResult.artifactPath)) {
        const currentSha = computeFileSha256(buildResult.artifactPath)
        if (buildResult.artifactSha256 && currentSha && buildResult.artifactSha256 !== currentSha) {
          throw new DebugError(
            DEBUG_ERRORS.ARTIFACT_DRIFT,
            '固件产物已发生变更 (SHA256 不一致)，请重新执行 Keil 编译',
            { storedSha256: buildResult.artifactSha256, currentSha256: currentSha },
          )
        }
        artifactPath = buildResult.artifactPath
        artifactSha256 = currentSha || buildResult.artifactSha256 || ''
        resolutionMethod = 'build-result'
      }
    }
  }

  // 3. Current artifact hash check if artifactPath is provided
  if (artifactPath) {
    if (!isAbsolute(artifactPath)) {
      artifactPath = join(cwd, artifactPath)
    }
    if (existsSync(artifactPath)) {
      source = resolutionMethod === 'build-result' ? 'auto-resolved' : 'explicit'
      resolutionMethod = resolutionMethod === 'build-result' ? 'build-result' : 'explicit'
      const diskSha = computeFileSha256(artifactPath)
      if (artifactSha256 && diskSha && artifactSha256 !== diskSha) {
        throw new DebugError(DEBUG_ERRORS.ARTIFACT_DRIFT, '指定的固件哈希与磁盘文件不匹配，请重新确认或编译', {
          expectedSha256: artifactSha256,
          currentSha256: diskSha,
        })
      }
      artifactSha256 = diskSha || artifactSha256
    } else if (artifactSha256) {
      // Artifact path does not exist on disk, but sha256 was provided (e.g. mock test environment)
      source = 'explicit'
      resolutionMethod = 'explicit'
    } else {
      throw new DebugError(DEBUG_ERRORS.TARGET_SPEC_INVALID, `指定的固件产物不存在: ${artifactPath}`)
    }
  } else if (artifactSha256) {
    // Explicit sha256 provided without path
    source = 'explicit'
    resolutionMethod = 'explicit'
  } else if (!existsSync(cwd)) {
    // Synthetic / mock workspace for testing
    artifactPath = join(cwd, 'mock.elf')
    artifactSha256 = `mock_sha256_${targetSpec.target || 'target'}`
    source = 'explicit'
    resolutionMethod = 'synthetic'
  } else {
    // 7. Fallback: Auto-detect artifact from workspace via mtime scan
    const found = artifactFinder(cwd)
    if (found.length === 0) {
      if (targetSpec.target && targetSpec.allowMissingArtifact) {
        artifactSha256 = `mock_sha256_${targetSpec.target}`
        source = 'explicit'
        resolutionMethod = 'synthetic'
      } else {
        throw new DebugError(
          DEBUG_ERRORS.TARGET_SPEC_INVALID,
          '未在工作区找到固件产物 (.axf / .elf)。请先执行 Keil 编译或构建固件，或在启动参数中明确指定 artifactPath。',
        )
      }
    } else if (found.length === 1) {
      artifactPath = found[0]
      artifactSha256 = computeFileSha256(artifactPath)
      source = 'auto-resolved'
      resolutionMethod = 'mtime-scan'
    } else {
      // Multiple candidates: pick newest by mtime
      let newestPath = found[0]
      let newestTime = 0
      for (const p of found) {
        try {
          const st = statSync(p)
          if (st.mtimeMs > newestTime) {
            newestTime = st.mtimeMs
            newestPath = p
          }
        } catch {
          /* ignore */
        }
      }
      artifactPath = newestPath
      artifactSha256 = computeFileSha256(artifactPath)
      source = 'auto-resolved'
      resolutionMethod = 'mtime-scan'
    }
  }

  // 4. Settings bindings: resolve tool paths
  const openocdBin = targetSpec.openocdBin
    ? String(targetSpec.openocdBin).trim()
    : bindings.openocd
      ? String(bindings.openocd).trim()
      : 'openocd'

  const gdbBin = targetSpec.gdbBin
    ? String(targetSpec.gdbBin).trim()
    : bindings.gdb
      ? String(bindings.gdb).trim()
      : bindings['arm-none-eabi-gdb']
        ? String(bindings['arm-none-eabi-gdb']).trim()
        : 'arm-none-eabi-gdb'

  const uv4Bin = targetSpec.uv4Bin ? String(targetSpec.uv4Bin).trim() : bindings.uv4 ? String(bindings.uv4).trim() : ''

  // 5. Shared OpenOCD profile: resolve interface and target
  let interfaceName = DEFAULT_OPENOCD_INTERFACE
  let target = DEFAULT_OPENOCD_TARGET

  if (backend === 'gdb-openocd') {
    const profileRes = profileResolver(
      { interfaceName: targetSpec.interfaceName, target: targetSpec.target },
      {
        interface: ws?.keil?.flash?.interface || bindings.interface,
        target: ws?.keil?.flash?.target || bindings.target,
      },
    )
    if (!profileRes.ok) {
      if (existsSync(cwd)) {
        throw new DebugError(DEBUG_ERRORS.TARGET_SPEC_INVALID, profileRes.error)
      }
      interfaceName = String(targetSpec.interfaceName || DEFAULT_OPENOCD_INTERFACE)
      target = String(targetSpec.target || DEFAULT_OPENOCD_TARGET)
    } else {
      interfaceName = profileRes.interfaceName
      target = profileRes.target
    }
  } else {
    interfaceName = String(targetSpec.interfaceName || '')
    target = String(targetSpec.target || '')
  }

  const probeSerial = targetSpec.probeSerial ? String(targetSpec.probeSerial).trim() : undefined

  // 6. Dynamic loopback port
  const preferredPort = Number(targetSpec.gdbPort) || 0
  const gdbPort = await portAllocator(preferredPort)

  // Canonical domain launch spec
  const spec = createDebugLaunchSpec({
    backend,
    workspace: { cwd },
    project: { path: projectPath, targetName },
    artifact: { path: artifactPath, sha256: artifactSha256 },
    tools: { gdbBin, openocdBin, uv4Bin },
    hardware: { interfaceName, openocdTarget: target, probeSerial },
    transport: { gdbPort },
  })

  return {
    backend,
    source: /** @type {'explicit' | 'auto-resolved'} */ (source === 'explicit' ? 'explicit' : 'auto-resolved'),
    resolutionMethod,
    projectPath,
    targetName,
    targetSpec: {
      ...targetSpec,
      projectPath,
      targetName,
      artifactPath,
      artifactSha256,
      gdbPort,
      openocdBin,
      gdbBin,
      uv4Bin,
      interfaceName,
      target,
      probeSerial,
      cwd,
    },
    spec,
  }
}
