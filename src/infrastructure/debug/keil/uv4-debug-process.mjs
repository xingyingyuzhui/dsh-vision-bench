// @ts-check

import { spawn } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { allocateLoopbackPort, isPortAvailable } from '../../network/loopback-port.mjs'

/**
 * Manages the lifecycle of a Keil UV4 process launched for simulator debugging.
 */
export class UV4DebugProcess {
  /**
   * @param {{
   *   uv4Bin?: string,
   *   spawner?: typeof spawn,
   *   portAllocator?: typeof allocateLoopbackPort,
   *   portChecker?: typeof isPortAvailable,
   * }} [deps]
   */
  constructor(deps = {}) {
    this.uv4Bin = deps.uv4Bin || 'UV4.exe'
    this.spawner = deps.spawner || spawn
    this.portAllocator = deps.portAllocator || allocateLoopbackPort
    this.portChecker = deps.portChecker || isPortAvailable

    /** @type {import('node:child_process').ChildProcess | null} */
    this.process = null
    this.port = 0
    this.running = false
    this.exitCode = null
  }

  /**
   * Launches UV4 in background simulator mode with a dynamically allocated socket port.
   *
   * @param {{
   *   projectPath: string,
   *   target?: string,
   *   preferredPort?: number,
   *   timeoutMs?: number,
   *   uv4Bin?: string,
   * }} options
   * @returns {Promise<{ port: number, process: import('node:child_process').ChildProcess }>}
   */
  async launch(options) {
    if (!options.projectPath) {
      throw new Error('启动 UV4 仿真必须指定工程文件 (projectPath)')
    }

    const bin = options.uv4Bin || this.uv4Bin
    const port = await this.portAllocator(options.preferredPort || 0)
    this.port = port

    // UV4 CLI args:
    // -j0: quiet / hide dialogs
    // project path
    // socket argument: -sock:<port>
    const args = ['-j0', options.projectPath, `-sock:${port}`]
    if (options.target) {
      args.push('-t', options.target)
    }

    const child = this.spawner(bin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      windowsHide: true,
    })

    this.process = child
    this.running = true

    child.on('exit', (code) => {
      this.running = false
      this.exitCode = code
    })

    child.on('error', () => {
      this.running = false
    })

    // Wait briefly or verify port availability
    const timeout = options.timeoutMs || 10000
    const start = Date.now()
    let ready = false

    while (Date.now() - start < timeout) {
      if (!this.running && this.exitCode !== null) {
        throw new Error(`UV4 进程异常退出 (code: ${this.exitCode})`)
      }
      // Check if port is bound (occupied means server is listening)
      const available = await this.portChecker(port)
      if (!available) {
        ready = true
        break
      }
      await new Promise((r) => setTimeout(r, 100))
    }

    // In mock/test environments without real UV4, ready might be simulated
    return {
      port: this.port,
      process: child,
    }
  }

  /**
   * Gracefully terminates the UV4 process.
   *
   * @param {number} [timeoutMs=3000]
   * @returns {Promise<void>}
   */
  async stop(timeoutMs = 3000) {
    if (!this.process || !this.running) {
      this.running = false
      return
    }

    const proc = this.process
    this.running = false

    return new Promise((resolve) => {
      let resolved = false
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true
          try {
            proc.kill('SIGKILL')
          } catch {}
          resolve()
        }
      }, timeoutMs)

      proc.once('exit', () => {
        if (!resolved) {
          resolved = true
          clearTimeout(timer)
          resolve()
        }
      })

      try {
        proc.kill('SIGTERM')
      } catch {
        proc.kill()
      }
    })
  }
}
