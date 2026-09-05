// @ts-check
import { DEBUG_ERRORS, DebugError } from '../../../domain/debug/errors.mjs'
import { allocateLoopbackPort } from '../../network/loopback-port.mjs'
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
 *   probeSerial?: string,
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
    probeSerial,
    gdbPort = 3333,
    cwd,
    signal,
    readyTimeoutMs = 15000,
    onStdout,
    onStderr,
  } = options

  const built = buildOpenOcdDebugArgs({ interfaceName, target, probeSerial, gdbPort })
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

  try {
    await proc.readyPromise
  } catch (err) {
    try {
      proc.stop()
    } catch {}
    throw err
  }

  return {
    proc,
    port: built.port,
    stop: () => proc.stop(),
    exitPromise: proc.exitPromise,
  }
}

/**
 * Starts OpenOCD with dynamic port allocation and retries up to maxAttempts on port collision.
 *
 * @param {{
 *   openocdBin: string,
 *   interfaceName?: string,
 *   target?: string,
 *   gdbPort?: number,
 *   cwd?: string,
 *   signal?: AbortSignal,
 *   readyTimeoutMs?: number,
 *   maxAttempts?: number,
 *   portAllocator?: (preferred?: number) => Promise<number>,
 *   starter?: typeof startOpenOcdDebugProcess,
 *   onStdout?: (line: string) => void,
 *   onStderr?: (line: string) => void,
 * }} options
 */
export async function startOpenOcdWithAllocatedPort(options) {
  const portAllocator = options.portAllocator || allocateLoopbackPort
  const starter = options.starter || startOpenOcdDebugProcess
  const maxAttempts = options.maxAttempts || 3

  /** @type {any} */
  let lastError = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const allocatedPort = await portAllocator(options.gdbPort || 0)
    try {
      const result = await starter({
        ...options,
        gdbPort: allocatedPort,
      })
      return result
    } catch (err) {
      const errorObj = /** @type {any} */ (err)
      lastError = errorObj
      const isPortConflict =
        /address already in use|bind failed|port \d+ in use|EADDRINUSE/i.test(String(errorObj?.message || '')) ||
        (errorObj?.exitCode && errorObj.exitCode !== 0)
      if (attempt < maxAttempts && isPortConflict) {
        await new Promise((resolve) => setTimeout(resolve, 50 * attempt))
        continue
      }
      throw new DebugError(
        DEBUG_ERRORS.PORT_CONFLICT,
        `无法绑定 OpenOCD GDB 端口: 端口冲突已达到最大重试次数 (${maxAttempts} 次): ${errorObj?.message || errorObj}`,
        { attempts: attempt, maxAttempts, lastError: String(errorObj?.message || errorObj) },
      )
    }
  }

  throw new DebugError(
    DEBUG_ERRORS.PORT_CONFLICT,
    `无法绑定 OpenOCD GDB 端口: 已达到最大重试次数 (${maxAttempts} 次)`,
    { maxAttempts, lastError: String(lastError?.message || lastError) },
  )
}
