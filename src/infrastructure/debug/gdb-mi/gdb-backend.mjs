// @ts-check

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { startOpenOcdDebugProcess } from '../openocd/openocd-debug-process.mjs'
import { createMiClient } from './mi-client.mjs'
import { mapGdbStopReason } from './stop-reason.mjs'

/**
 * GDB/MI + OpenOCD Hardware Debug Backend.
 * Implements the DebugBackend interface for embedded targets.
 * Parity with ADR-013 & Phase 3 Section 7.7.
 */
export class GdbBackend {
  /**
   * @param {{
   *   debugSessionId?: string,
   *   ownerSessionId?: string,
   *   workspaceCwd?: string,
   *   openocdStarter?: typeof startOpenOcdDebugProcess,
   *   miClientFactory?: typeof createMiClient,
   * }} [deps]
   */
  constructor(deps = {}) {
    this.debugSessionId = deps.debugSessionId || ''
    this.ownerSessionId = deps.ownerSessionId || ''
    this.workspaceCwd = deps.workspaceCwd || ''
    this.openocdStarter = deps.openocdStarter || startOpenOcdDebugProcess
    this.miClientFactory = deps.miClientFactory || createMiClient

    /** @type {any} */
    this.openocdProcess = null
    /** @type {import('./mi-client.mjs').MIClient | null} */
    this.miClient = null
    /**
     * Native location cache for GDB.
     * Note: backend cache is NOT public/debug product state.
     * @type {import('../../../types/debug.d.ts').SourceLocation | null}
     */
    this.lastNativeLocation = null
    /** @type {Map<string, string>} */
    this.breakpointMap = new Map() // bp.id -> gdb breakpoint number
    /** @type {Map<string, string>} */
    this.watchpointMap = new Map() // wp.id -> gdb watchpoint number
    /**
     * Native state cache for GDB.
     * Note: backend cache is NOT public/debug product state.
     */
    this.nativeState = 'idle'
    this.isStopping = false
    this.firmwareHash = ''
    this.exitEmitted = false
    this._unsubscribeAsync = null
    this._unsubscribeStream = null
    /** @type {Set<(event: import('../../../types/debug-backend.d.ts').DebugBackendEvent) => void>} */
    this.listeners = new Set()
  }

  /**
   * Subscribes to backend events.
   * @param {(event: import('../../../types/debug-backend.d.ts').DebugBackendEvent) => void} listener
   * @returns {() => void}
   */
  subscribe(listener) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Emits a backend event to all registered listeners.
   * @param {import('../../../types/debug-backend.d.ts').DebugBackendEvent} event
   */
  _emit(event) {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        /* ignore listener error */
      }
    }
  }

  /**
   * Emits backend.exited exactly once to prevent duplicate exit events.
   * @param {import('../../../types/debug-backend.d.ts').DebugBackendEvent} event
   */
  _emitExitOnce(event) {
    if (this.exitEmitted) return
    this.exitEmitted = true
    this._emit(event)
  }

  /**
   * Starts GDB and OpenOCD processes, connects MI client, and enters halted debug state.
   *
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
   * }} spec
   */
  async start(spec = {}) {
    this.nativeState = 'starting'
    const targetSpec = spec.targetSpec || {}
    const artifactPath = targetSpec.artifactPath
    const gdbPort = targetSpec.gdbPort || 3333
    const cwd = targetSpec.cwd || this.workspaceCwd || process.cwd()

    // 1. Verify firmware artifact
    if (!artifactPath) {
      throw new Error('启动调试必须指定固件产物路径 (artifactPath)')
    }
    if (!existsSync(artifactPath)) {
      throw new Error(`固件产物不存在: ${artifactPath}`)
    }

    try {
      const content = readFileSync(artifactPath)
      this.firmwareHash = createHash('sha256').update(content).digest('hex')
    } catch (err) {
      throw new Error(`读取固件产物失败: ${err instanceof Error ? err.message : String(err)}`)
    }

    const openocdBin = targetSpec.openocdBin || 'openocd'
    const gdbBin = targetSpec.gdbBin || 'arm-none-eabi-gdb'

    try {
      // 2. Start OpenOCD debug server
      this.openocdProcess = await this.openocdStarter({
        openocdBin,
        interfaceName: targetSpec.interfaceName,
        target: targetSpec.target,
        probeSerial: targetSpec.probeSerial,
        gdbPort,
        cwd,
      })

      // 3. Start GDB MI client
      const gdbArgs = ['--interpreter=mi3', '--quiet', '--nx', artifactPath]
      this.miClient = this.miClientFactory({
        bin: gdbBin,
        args: gdbArgs,
        cwd,
      })

      // Listen for async stop/run events
      this._unsubscribeAsync = this.miClient.onAsync((rec) => {
        if (rec.class === 'stopped') {
          const reason = mapGdbStopReason(rec)
          const frame = rec.results?.frame
          /** @type {import('../../../types/debug.d.ts').SourceLocation | undefined} */
          let loc = undefined
          if (frame) {
            loc = {
              file: frame.file || frame.fullname || '',
              line: Number(frame.line || 0),
              function: frame.func || '',
              address: frame.addr || '',
            }
            this.lastNativeLocation = loc
          }
          this.nativeState = 'paused'
          this._emit({
            type: 'backend.stopped',
            reason,
            location: loc,
            nativeReason: rec.results?.reason,
            breakpointNumber: rec.results?.bkptno ? String(rec.results.bkptno) : undefined,
            watchpointNumber:
              rec.results?.wpt?.number || rec.results?.wpt
                ? String(rec.results?.wpt?.number || rec.results?.wpt)
                : undefined,
            threadId: rec.results?.['thread-id'],
          })
        } else if (rec.class === 'running') {
          this.nativeState = 'running'
          this._emit({
            type: 'backend.running',
            threadId: rec.results?.['thread-id'],
          })
        }
      })

      // Listen for stream records (console, target, log)
      if (typeof this.miClient.onStream === 'function') {
        this._unsubscribeStream = this.miClient.onStream((rec) => {
          let stream = 'console'
          if (rec.kind === 'target-stream') stream = 'target'
          else if (rec.kind === 'log-stream') stream = 'log'
          this._emit({
            type: 'backend.console',
            stream: /** @type {'console' | 'target' | 'log'} */ (stream),
            text: rec.text || '',
          })
        })
      }

      // Monitor exit promise of client
      if (this.miClient._transport?.exitPromise) {
        this.miClient._transport.exitPromise.then(
          (exitInfo) => {
            this._emitExitOnce({
              type: 'backend.exited',
              code: exitInfo?.code ?? undefined,
              signal: exitInfo?.signal ?? undefined,
              unexpected: !this.isStopping,
            })
          },
          (err) => {
            this._emit({
              type: 'backend.error',
              message: err instanceof Error ? err.message : String(err),
              fatal: true,
            })
          },
        )
      }

      // 4. Connect GDB to OpenOCD port
      await this.miClient.command('-target-select', ['extended-remote', `127.0.0.1:${gdbPort}`])

      // 5. Reset target and halt
      await this.miClient.command('-interpreter-exec', ['console', '"monitor reset halt"'])

      // 6. Inspect initial frame
      try {
        const frames = await this.stack()
        if (frames.length > 0) {
          const top = frames[0]
          this.lastNativeLocation = {
            file: top.file || '',
            line: top.line || 0,
            function: top.function,
            address: top.address,
          }
        }
      } catch {
        /* initial frame read is optional */
      }

      this.nativeState = 'paused'
    } catch (err) {
      await this.stop()
      throw err
    }
  }

  /**
   * Continues target execution.
   */
  async continue() {
    const client = this._getClient()
    const rec = await client.command('-exec-continue')
    this.nativeState = 'running'
    return rec
  }

  /**
   * Alias for continue().
   */
  async run() {
    return this.continue()
  }

  /**
   * Interrupts target execution (pause).
   */
  async pause() {
    const client = this._getClient()
    const rec = await client.command('-exec-interrupt')
    this.nativeState = 'paused'
    return rec
  }

  /**
   * Requests target pause (standard DebugBackend interface).
   */
  async requestPause() {
    return this.pause()
  }

  /**
   * Single step over current line.
   * @param {'over' | 'into' | 'out'} [stepType]
   */
  async step(stepType = 'over') {
    if (stepType === 'into') return this.stepInto()
    if (stepType === 'out') return this.stepOut()
    return this.stepOver()
  }

  /**
   * Step over next source line (-exec-next).
   */
  async stepOver() {
    const client = this._getClient()
    const rec = await client.command('-exec-next')
    return rec
  }

  /**
   * Step into function call (-exec-step).
   */
  async stepInto() {
    const client = this._getClient()
    const rec = await client.command('-exec-step')
    return rec
  }

  /**
   * Step out of current function (-exec-finish).
   */
  async stepOut() {
    const client = this._getClient()
    const rec = await client.command('-exec-finish')
    return rec
  }

  /**
   * Halts and resets CPU via OpenOCD monitor command.
   */
  async resetHalt() {
    const client = this._getClient()
    const rec = await client.command('-interpreter-exec', ['console', '"monitor reset halt"'])
    this.nativeState = 'paused'
    return rec
  }

  /**
   * Sets a breakpoint.
   * @param {import('../../../types/debug.d.ts').DebugBreakpoint} bp
   */
  async addBreakpoint(bp) {
    const client = this._getClient()
    const loc = `${bp.file}:${bp.line}`
    const args = []
    if (bp.condition) {
      args.push('-c', bp.condition)
    }
    args.push(loc)

    const rec = await client.command('-break-insert', args)
    const bkpt = rec.results?.bkpt
    const bkptNum = bkpt?.number ? String(bkpt.number) : ''
    if (bkptNum) {
      this.breakpointMap.set(bp.id, bkptNum)
    }
    return {
      ...bp,
      verified: true,
      address: bkpt?.addr,
    }
  }

  /**
   * Removes a breakpoint.
   * @param {import('../../../types/debug.d.ts').DebugBreakpoint} bp
   */
  async removeBreakpoint(bp) {
    const client = this._getClient()
    const num = this.breakpointMap.get(bp.id) || bp.id
    await client.command('-break-delete', [num])
    this.breakpointMap.delete(bp.id)
    return { ok: true }
  }

  /**
   * Sets a watchpoint on an expression.
   * @param {import('../../../types/debug.d.ts').DebugWatchpoint} wp
   */
  async addWatchpoint(wp) {
    const client = this._getClient()
    const args = []
    if (wp.accessType === 'read') {
      args.push('-r')
    } else if (wp.accessType === 'readWrite') {
      args.push('-a')
    }
    args.push(wp.expression)

    const rec = await client.command('-break-watch', args)
    const wpt = rec.results?.wpt
    const wptNum = wpt?.number ? String(wpt.number) : ''
    if (wptNum) {
      this.watchpointMap.set(wp.id, wptNum)
    }
    return {
      ...wp,
      verified: true,
    }
  }

  /**
   * Removes a watchpoint.
   * @param {import('../../../types/debug.d.ts').DebugWatchpoint} wp
   */
  async removeWatchpoint(wp) {
    const client = this._getClient()
    const num = this.watchpointMap.get(wp.id) || wp.id
    await client.command('-break-delete', [num])
    this.watchpointMap.delete(wp.id)
    return { ok: true }
  }

  /**
   * Retrieves current call stack frames.
   * @returns {Promise<import('../../../types/debug.d.ts').DebugStackFrame[]>}
   */
  async stack() {
    const client = this._getClient()
    const rec = await client.command('-stack-list-frames')
    const stack = rec.results?.stack
    if (!Array.isArray(stack)) return []

    return stack.map((item) => {
      const f = item.frame || item
      return {
        level: Number(f.level || 0),
        function: f.func || '??',
        file: f.file || f.fullname || '',
        line: Number(f.line || 0),
        address: f.addr || '',
      }
    })
  }

  /**
   * Retrieves local variables in the current stack frame.
   * @returns {Promise<import('../../../types/debug.d.ts').DebugVariable[]>}
   */
  async locals() {
    const client = this._getClient()
    const rec = await client.command('-stack-list-variables', ['--all-values'])
    const vars = rec.results?.variables
    if (!Array.isArray(vars)) return []

    return vars.map((v) => ({
      name: v.name || '',
      value: v.value || '',
      type: v.type || '',
    }))
  }

  /**
   * Evaluates an expression in current scope.
   * @param {string} expr
   * @returns {Promise<string>}
   */
  async evaluate(expr) {
    const client = this._getClient()
    const rec = await client.command('-data-evaluate-expression', [expr])
    return rec.results?.value || ''
  }

  /**
   * Retrieves target register names and values.
   * @returns {Promise<import('../../../types/debug.d.ts').DebugRegister[]>}
   */
  async registers() {
    const client = this._getClient()
    const namesRec = await client.command('-data-list-register-names')
    const regNames = namesRec.results?.['register-names'] || []

    const valuesRec = await client.command('-data-list-register-values', ['x'])
    const regValues = valuesRec.results?.['register-values'] || []

    /** @type {import('../../../types/debug.d.ts').DebugRegister[]} */
    const registers = []
    if (Array.isArray(regValues)) {
      for (const item of regValues) {
        const num = Number(item.number)
        const name = regNames[num]
        if (name && item.value) {
          registers.push({ name, value: item.value })
        }
      }
    }
    return registers
  }

  /**
   * Reads raw target memory bytes.
   * @param {string} address
   * @param {number} length
   * @returns {Promise<string>} Hex representation of bytes
   */
  async readMemory(address, length) {
    const client = this._getClient()
    const rec = await client.command('-data-read-memory-bytes', [address, length])
    const memory = rec.results?.memory
    if (Array.isArray(memory) && memory[0]?.contents) {
      return memory[0].contents
    }
    return ''
  }

  /**
   * Generic command dispatcher fallback.
   * @param {{ type: string, [key: string]: any }} cmd
   */
  async command(cmd) {
    switch (cmd.type) {
      case 'continue':
        return this.continue()
      case 'pause':
        return this.pause()
      case 'step':
        return this.step(cmd.stepType)
      case 'resetHalt':
        return this.resetHalt()
      case 'evaluate':
        return this.evaluate(cmd.expression)
      case 'stack':
        return this.stack()
      case 'locals':
        return this.locals()
      case 'registers':
        return this.registers()
      case 'readMemory':
        return this.readMemory(cmd.address, cmd.length)
      case 'addWatchpoint':
        return this.addWatchpoint(cmd.watchpoint)
      case 'removeWatchpoint':
        return this.removeWatchpoint(cmd.watchpoint)
      default:
        throw new Error(`未受支持的后端调试命令: ${cmd.type}`)
    }
  }

  /**
   * Stops debugging session, detaches, and stops child processes in reverse order.
   */
  async stop() {
    this.isStopping = true
    this.nativeState = 'stopping'

    if (this._unsubscribeAsync) {
      try {
        this._unsubscribeAsync()
      } catch {
        /* ignore */
      }
      this._unsubscribeAsync = null
    }

    if (this._unsubscribeStream) {
      try {
        this._unsubscribeStream()
      } catch {
        /* ignore */
      }
      this._unsubscribeStream = null
    }

    // 1. Interrupt and exit GDB
    if (this.miClient) {
      try {
        await Promise.race([
          this.miClient.command('-gdb-exit', [], { timeoutMs: 2000 }),
          new Promise((r) => setTimeout(r, 2000)),
        ])
      } catch {
        /* ignore */
      }
      try {
        await this.miClient.stop()
      } catch {
        /* ignore */
      }
      this.miClient = null
    }

    // 2. Stop OpenOCD
    if (this.openocdProcess) {
      try {
        await this.openocdProcess.stop()
      } catch {
        /* ignore */
      }
      this.openocdProcess = null
    }

    this.nativeState = 'idle'
  }

  /**
   * @private
   * @returns {import('./mi-client.mjs').MIClient}
   */
  _getClient() {
    if (!this.miClient || this.isStopping) {
      throw new Error('调试器未运行或正在停止')
    }
    return this.miClient
  }
}

/**
 * Creates an instance of GdbBackend.
 * @param {ConstructorParameters<typeof GdbBackend>[0]} [deps]
 */
export function createGdbBackend(deps) {
  return new GdbBackend(deps)
}
