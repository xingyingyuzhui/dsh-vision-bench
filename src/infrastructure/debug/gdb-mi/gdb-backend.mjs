// @ts-check

import { startOpenOcdDebugProcess } from '../openocd/openocd-debug-process.mjs'
import {
  dispatchGdbCommand,
  gdbContinue,
  gdbInterpreterExec,
  gdbPause,
  gdbResetHalt,
  gdbStepInto,
  gdbStepOut,
  gdbStepOver,
} from './gdb-backend-commands.mjs'
import {
  gdbAddBreakpoint,
  gdbAddWatchpoint,
  gdbRemoveBreakpoint,
  gdbRemoveWatchpoint,
} from './gdb-backend-breakpoints.mjs'
import { createGdbEventEmitter } from './gdb-backend-events.mjs'
import {
  gdbEvaluate,
  gdbLocals,
  gdbReadMemory,
  gdbRegisters,
  gdbStack,
} from './gdb-backend-inspect.mjs'
import { startGdbSession, stopGdbSession } from './gdb-backend-session.mjs'
import { createMiClient } from './mi-client.mjs'

/**
 * GDB/MI + OpenOCD Hardware Debug Backend.
 * Implements the DebugBackend interface for embedded targets.
 * Parity with ADR-013 & Phase 3 Section 7.7.
 *
 * Session / command / event / breakpoint / inspect logic lives in sibling modules;
 * this class keeps the stable public surface for debug-runtime consumers.
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
    this.breakpointMap = new Map()
    /** @type {Map<string, string>} */
    this.watchpointMap = new Map()
    /**
     * Native state cache for GDB.
     * Note: backend cache is NOT public/debug product state.
     */
    this.nativeState = 'idle'
    this.isStopping = false
    /**
     * Last non-fatal error encountered during startup (e.g. the probe does not
     * implement `monitor reset halt`). The session is still usable, but the
     * target may not have been reset — callers surface this to the user.
     * @type {string}
     */
    this.lastNonFatalError = ''
    this.firmwareHash = ''
    this.exitEmitted = false
    this._unsubscribeAsync = null
    this._unsubscribeStream = null
    /** @type {Set<(event: import('../../../types/debug-backend.d.ts').DebugBackendEvent) => void>} */
    this.listeners = new Set()

    const emitter = createGdbEventEmitter({
      listeners: this.listeners,
      getExitEmitted: () => this.exitEmitted,
      setExitEmitted: (v) => {
        this.exitEmitted = v
      },
    })
    this._emit = emitter.emit
    this._emitExitOnce = emitter.emitExitOnce
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
  async start(spec = {}) {
    return startGdbSession(this, spec)
  }

  async continue() {
    const rec = await gdbContinue(this._getClient())
    this.nativeState = 'running'
    return rec
  }

  async run() {
    return this.continue()
  }

  async pause() {
    const rec = await gdbPause(this._getClient())
    this.nativeState = 'paused'
    return rec
  }

  async requestPause() {
    return this.pause()
  }

  /**
   * @param {'over' | 'into' | 'out'} [stepType]
   */
  async step(stepType = 'over') {
    if (stepType === 'into') return this.stepInto()
    if (stepType === 'out') return this.stepOut()
    return this.stepOver()
  }

  async stepOver() {
    return gdbStepOver(this._getClient())
  }

  async stepInto() {
    return gdbStepInto(this._getClient())
  }

  async stepOut() {
    return gdbStepOut(this._getClient())
  }

  /**
   * Executes a GDB console (CLI) command through `-interpreter-exec`.
   * @param {string} cliCommand bare CLI text, e.g. `monitor reset halt`
   */
  async interpreterExec(cliCommand) {
    return gdbInterpreterExec(this._getClient(), cliCommand)
  }

  async resetHalt() {
    const rec = await gdbResetHalt(this._getClient())
    this.nativeState = 'paused'
    return rec
  }

  /** @param {import('../../../types/debug.d.ts').DebugBreakpoint} bp */
  async addBreakpoint(bp) {
    return gdbAddBreakpoint(this._getClient(), this.breakpointMap, bp)
  }

  /** @param {import('../../../types/debug.d.ts').DebugBreakpoint} bp */
  async removeBreakpoint(bp) {
    return gdbRemoveBreakpoint(this._getClient(), this.breakpointMap, bp)
  }

  /** @param {import('../../../types/debug.d.ts').DebugWatchpoint} wp */
  async addWatchpoint(wp) {
    return gdbAddWatchpoint(this._getClient(), this.watchpointMap, wp)
  }

  /** @param {import('../../../types/debug.d.ts').DebugWatchpoint} wp */
  async removeWatchpoint(wp) {
    return gdbRemoveWatchpoint(this._getClient(), this.watchpointMap, wp)
  }

  async stack() {
    return gdbStack(this._getClient())
  }

  async locals() {
    return gdbLocals(this._getClient())
  }

  /** @param {string} expr */
  async evaluate(expr) {
    return gdbEvaluate(this._getClient(), expr)
  }

  async registers() {
    return gdbRegisters(this._getClient())
  }

  /**
   * @param {string} address
   * @param {number} length
   */
  async readMemory(address, length) {
    return gdbReadMemory(this._getClient(), address, length)
  }

  /** @param {{ type: string, [key: string]: any }} cmd */
  async command(cmd) {
    return dispatchGdbCommand(this, cmd)
  }

  async stop() {
    return stopGdbSession(this)
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
