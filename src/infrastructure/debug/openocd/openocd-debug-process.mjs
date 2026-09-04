// @ts-check
import { spawnManagedProcess } from '../process/debug-process.mjs'
import { buildOpenOcdDebugArgs } from './openocd-debug-profile.mjs'

export const OPENOCD_GDB_READY_REGEX = /Listening on port \d+ for gdb connections/i

/**
 * Starts a managed OpenOCD debug process listening for GDB connections.
 *
 * @param {{
 *   openocdBin: string,
 *   interfaceName?: string,
 *   target?: string,
 *   gdbPort?: number,
 *   cwd?: string,
 *   signal?: AbortSignal,
 *   readyTimeoutMs?: number,
 *   onStdout?: (line: string) => void,
 *   onStderr?: (line: string) => void,
 * }} options
 */
export async function startOpenOcdDebugProcess(options) {
  const {
    openocdBin,
    interfaceName,
    target,
    gdbPort = 3333,
    cwd,
    signal,
    readyTimeoutMs = 15000,
    onStdout,
    onStderr,
  } = options

  const built = buildOpenOcdDebugArgs({ interfaceName, target, gdbPort })
  if (!built.ok) {
    throw new Error(built.error)
  }

  const proc = spawnManagedProcess({
    bin: openocdBin,
    args: built.args,
    cwd,
    signal,
    onStdout,
    onStderr,
    readyPredicate: (line) => OPENOCD_GDB_READY_REGEX.test(line),
    readyTimeoutMs,
  })

  await proc.readyPromise

  return {
    proc,
    port: built.port,
    stop: () => proc.stop(),
    exitPromise: proc.exitPromise,
  }
}
