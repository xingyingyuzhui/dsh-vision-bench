// @ts-check
import { DEBUG_ERRORS, DebugError } from './errors.mjs'

/**
 * Creates and validates a canonical DebugLaunchSpec domain model.
 *
 * @param {{
 *   backend?: string,
 *   workspace?: { cwd?: string },
 *   project?: { path?: string, targetName?: string },
 *   artifact?: { path?: string, sha256?: string, builtAt?: number },
 *   tools?: { gdbBin?: string, openocdBin?: string, uv4Bin?: string },
 *   hardware?: { interfaceName?: string, openocdTarget?: string, probeSerial?: string },
 *   transport?: { gdbPort?: number, uvscPort?: number, tclPort?: number | string, telnetPort?: number | string },
 * }} input
 */
export function createDebugLaunchSpec(input) {
  const backend = input?.backend || 'gdb-openocd'
  if (!['gdb-openocd', 'keil-simulator', 'mock'].includes(backend)) {
    throw new DebugError(DEBUG_ERRORS.TARGET_SPEC_INVALID, `不支持的调试后端类型: ${backend}`)
  }

  const cwd = String(input?.workspace?.cwd || '').trim()
  const projectPath = String(input?.project?.path || '').trim()
  const targetName = String(input?.project?.targetName || '').trim()

  const artifactPath = String(input?.artifact?.path || '').trim()
  const artifactSha256 = String(input?.artifact?.sha256 || '').trim()
  const builtAt = Number(input?.artifact?.builtAt) || 0

  const gdbBin = String(input?.tools?.gdbBin || '').trim()
  const openocdBin = String(input?.tools?.openocdBin || '').trim()
  const uv4Bin = String(input?.tools?.uv4Bin || '').trim()

  const interfaceName = String(input?.hardware?.interfaceName || '').trim()
  const openocdTarget = String(input?.hardware?.openocdTarget || '').trim()
  const probeSerial = String(input?.hardware?.probeSerial || '').trim()

  const gdbPort = input?.transport?.gdbPort ? Number(input.transport.gdbPort) : undefined
  const uvscPort = input?.transport?.uvscPort ? Number(input.transport.uvscPort) : undefined

  return {
    backend,
    workspace: {
      cwd,
    },
    project: {
      path: projectPath,
      targetName,
    },
    artifact: {
      path: artifactPath,
      sha256: artifactSha256,
      builtAt,
    },
    tools: {
      gdbBin,
      openocdBin,
      uv4Bin,
    },
    hardware: {
      interfaceName,
      openocdTarget,
      probeSerial,
    },
    transport: {
      gdbPort,
      uvscPort,
      tclPort: input?.transport?.tclPort ?? 'disabled',
      telnetPort: input?.transport?.telnetPort ?? 'disabled',
    },
  }
}
