// @ts-check

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { gdbInterpreterExec } from './gdb-backend-commands.mjs'
import { wireGdbMiListeners } from './gdb-backend-events.mjs'
import { gdbStack } from './gdb-backend-inspect.mjs'

/**
 * Starts OpenOCD + GDB/MI, connects remote, and enters halted state.
 *
 * @param {any} backend GdbBackend instance (mutated in place)
 * @param {{
 *   targetSpec?: {
 *     artifactPath?: string,
 *     interfaceName?: string,
 *     target?: string,
 *     probeSerial?: string,
 *     gdbPort?: number,
 *     openocdBin?: string,
 *     gdbBin?: string,
 *     cwd?: string,
 *   },
 *   ownerSessionId?: string,
 *   workspaceCwd?: string,
 * }} [spec]
 */
export async function startGdbSession(backend, spec = {}) {
  backend.nativeState = 'starting'
  const targetSpec = spec.targetSpec || {}
  const artifactPath = targetSpec.artifactPath
  const gdbPort = targetSpec.gdbPort || 3333
  const cwd = targetSpec.cwd || backend.workspaceCwd || process.cwd()

  if (!artifactPath) {
    throw new Error('启动调试必须指定固件产物路径 (artifactPath)')
  }
  if (!existsSync(artifactPath)) {
    throw new Error(`固件产物不存在: ${artifactPath}`)
  }

  try {
    const content = readFileSync(artifactPath)
    backend.firmwareHash = createHash('sha256').update(content).digest('hex')
  } catch (err) {
    throw new Error(`读取固件产物失败: ${err instanceof Error ? err.message : String(err)}`)
  }

  const openocdBin = targetSpec.openocdBin || 'openocd'
  const gdbBin = targetSpec.gdbBin || 'arm-none-eabi-gdb'

  try {
    backend.openocdProcess = await backend.openocdStarter({
      openocdBin,
      interfaceName: targetSpec.interfaceName,
      target: targetSpec.target,
      probeSerial: targetSpec.probeSerial,
      gdbPort,
      cwd,
    })

    const gdbArgs = ['--interpreter=mi3', '--quiet', '--nx', artifactPath]
    backend.miClient = backend.miClientFactory({
      bin: gdbBin,
      args: gdbArgs,
      cwd,
    })

    const wired = wireGdbMiListeners(backend)
    backend._unsubscribeAsync = wired.unsubscribeAsync
    backend._unsubscribeStream = wired.unsubscribeStream

    // Connect GDB to OpenOCD — fatal without a connection.
    await backend.miClient.command('-target-select', ['extended-remote', `127.0.0.1:${gdbPort}`])

    // Reset + halt — non-fatal; degrade to MI interrupt.
    try {
      await gdbInterpreterExec(backend.miClient, 'monitor reset halt')
    } catch (err) {
      backend.lastNonFatalError = err instanceof Error ? err.message : String(err)
      try {
        await backend.miClient.command('-exec-interrupt')
      } catch {
        /* target may already be halted */
      }
    }

    try {
      const frames = await gdbStack(backend.miClient)
      if (frames.length > 0) {
        const top = frames[0]
        backend.lastNativeLocation = {
          file: top.file || '',
          line: top.line || 0,
          function: top.function,
          address: top.address,
        }
      }
    } catch {
      /* initial frame read is optional */
    }

    backend.nativeState = 'paused'
  } catch (err) {
    await stopGdbSession(backend)
    throw err
  }
}

/**
 * Stops debugging session and child processes in reverse order.
 * @param {any} backend GdbBackend instance
 */
export async function stopGdbSession(backend) {
  backend.isStopping = true
  backend.nativeState = 'stopping'

  if (backend._unsubscribeAsync) {
    try {
      backend._unsubscribeAsync()
    } catch {
      /* ignore */
    }
    backend._unsubscribeAsync = null
  }

  if (backend._unsubscribeStream) {
    try {
      backend._unsubscribeStream()
    } catch {
      /* ignore */
    }
    backend._unsubscribeStream = null
  }

  if (backend.miClient) {
    try {
      await Promise.race([
        backend.miClient.command('-gdb-exit', [], { timeoutMs: 2000 }),
        new Promise((r) => setTimeout(r, 2000)),
      ])
    } catch {
      /* ignore */
    }
    try {
      await backend.miClient.stop()
    } catch {
      /* ignore */
    }
    backend.miClient = null
  }

  if (backend.openocdProcess) {
    try {
      await backend.openocdProcess.stop()
    } catch {
      /* ignore */
    }
    backend.openocdProcess = null
  }

  backend.nativeState = 'idle'
}
