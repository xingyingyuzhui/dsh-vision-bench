// @ts-check

import {
  keilAddBreakpoint,
  keilAddWatchpoint,
  keilRemoveBreakpoint,
  keilRemoveWatchpoint,
} from './keil-sim-breakpoints.mjs'
import {
  dispatchKeilCommand,
  keilApplyScenario,
  keilContinue,
  keilPause,
  keilReset,
  keilStep,
} from './keil-sim-commands.mjs'
import { emitKeilBackendEvent, handleKeilAsyncEvent, pushKeilRingEvent } from './keil-sim-events.mjs'
import {
  keilEvaluate,
  keilInspect,
  keilLocals,
  keilReadMemoryBytes,
  keilReadMemoryHex,
  keilRegisters,
  keilStack,
} from './keil-sim-inspect.mjs'
import { startKeilSession, stopKeilSession } from './keil-sim-session.mjs'
import { UvSockClient } from './uvsock-client.mjs'

/**
 * Keil Simulator Debug Backend.
 * Implements the DebugBackend contract using official Keil UVSOCK semantic protocol client.
 *
 * Session / command / event / breakpoint / inspect logic lives in sibling modules;
 * this class keeps the stable public surface for debug-runtime consumers.
 */
export class KeilSimBackend {
  /**
   * @param {{
   *   debugSessionId?: string,
   *   ownerSessionId?: string,
   *   workspaceCwd?: string,
   *   eventRing?: { push: (event: any) => any },
   *   uvsockClient?: UvSockClient,
   *   uvscClient?: UvSockClient,
   *   uv4Process?: import('./uv4-debug-process.mjs').UV4DebugProcess,
   * }} [deps]
   */
  constructor(deps = {}) {
    this.debugSessionId = deps.debugSessionId || ''
    this.ownerSessionId = deps.ownerSessionId || ''
    this.workspaceCwd = deps.workspaceCwd || ''
    this.eventRing = deps.eventRing || null

    /** @type {UvSockClient} */
    this.client = deps.uvsockClient || deps.uvscClient || new UvSockClient()
    this.uvsockClient = this.client
    this.uvscClient = this.client

    if (this.client && typeof this.client.on === 'function') {
      this.client.on('error', (err) => {
        this._emit({
          type: 'backend.error',
          message: err?.message || String(err),
        })
      })
    }

    this.uv4Process = deps.uv4Process || null

    /** @type {import('../../../types/debug.d.ts').SourceLocation | null} */
    this.currentLocation = null
    /** @type {Map<string, string>} */
    this.breakpointMap = new Map()
    /** @type {Map<string, string>} */
    this.watchpointMap = new Map()
    this.state = 'idle'
    this.firmwareHash = ''

    /** @type {Set<(event: import('../../../types/debug-backend.d.ts').DebugBackendEvent) => void>} */
    this.listeners = new Set()

    /** @param {any} ev */
    this._onAsyncEvent = (ev) => this._handleAsyncEvent(ev)
    if (typeof this.client.onAsync === 'function') {
      this.client.onAsync(this._onAsyncEvent)
    } else if (typeof this.client.on === 'function') {
      this.client.on('event', this._onAsyncEvent)
    }
  }

  /**
   * @param {(event: import('../../../types/debug-backend.d.ts').DebugBackendEvent) => void} listener
   * @returns {() => void}
   */
  subscribe(listener) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** @param {import('../../../types/debug-backend.d.ts').DebugBackendEvent} event */
  _emit(event) {
    emitKeilBackendEvent(this.listeners, event)
  }

  capabilities() {
    return {
      breakpoints: true,
      watchpoints: true,
      memoryRead: true,
      registers: true,
      simulatorSignals: true,
      peripheralSimulation: 'device-dependent',
    }
  }

  /**
   * @param {{
   *   targetSpec?: {
   *     projectPath?: string,
   *     target?: string,
   *     port?: number,
   *     host?: string,
   *     uv4Bin?: string,
   *     firmwareHash?: string,
   *     spawnUv4?: boolean,
   *   },
   * }} [spec]
   */
  async start(spec = {}) {
    return startKeilSession(this, spec)
  }

  async stop() {
    return stopKeilSession(this)
  }

  async continue() {
    return keilContinue(this)
  }

  async run() {
    return this.continue()
  }

  async resume() {
    return this.continue()
  }

  async requestPause() {
    return this.pause()
  }

  async pause() {
    return keilPause(this)
  }

  /** @param {'into' | 'over' | 'out'} [mode] */
  async step(mode = 'into') {
    return keilStep(this, mode)
  }

  async stepOver() {
    return this.step('over')
  }

  async stepInto() {
    return this.step('into')
  }

  async stepOut() {
    return this.step('out')
  }

  /** @param {'halt' | 'run'} [_mode] */
  async reset(_mode = 'halt') {
    return keilReset(this, _mode)
  }

  async resetHalt() {
    return this.reset('halt')
  }

  /** @param {import('../../../types/debug.d.ts').DebugBreakpoint} bp */
  async addBreakpoint(bp) {
    return keilAddBreakpoint(this.client, this.breakpointMap, bp)
  }

  /** @param {import('../../../types/debug.d.ts').DebugBreakpoint} bp */
  async setBreakpoint(bp) {
    return this.addBreakpoint(bp)
  }

  /** @param {string | { id: string }} bpOrId */
  async removeBreakpoint(bpOrId) {
    return keilRemoveBreakpoint(this.client, this.breakpointMap, bpOrId)
  }

  /** @param {string} id */
  async clearBreakpoint(id) {
    return this.removeBreakpoint(id)
  }

  /** @param {import('../../../types/debug.d.ts').DebugWatchpoint} wp */
  async addWatchpoint(wp) {
    return keilAddWatchpoint(this.client, this.watchpointMap, wp)
  }

  /** @param {import('../../../types/debug.d.ts').DebugWatchpoint} wp */
  async setWatchpoint(wp) {
    return this.addWatchpoint(wp)
  }

  /** @param {string | { id: string }} wpOrId */
  async removeWatchpoint(wpOrId) {
    return keilRemoveWatchpoint(this.client, this.watchpointMap, wpOrId)
  }

  /** @param {string} id */
  async clearWatchpoint(id) {
    return this.removeWatchpoint(id)
  }

  /**
   * @param {string} expr
   * @param {number} [_frame]
   */
  async evaluate(expr, _frame = 0) {
    return keilEvaluate(this.client, expr)
  }

  /** @param {number} [_depth] */
  async stack(_depth = 20) {
    return keilStack(this.client, this.currentLocation)
  }

  async locals() {
    return keilLocals(this.client)
  }

  /** @param {number} [frame] */
  async inspect(frame = 0) {
    return keilInspect(this, frame)
  }

  async registers() {
    return keilRegisters(this.client)
  }

  async readRegisters() {
    return this.registers()
  }

  /**
   * @param {string} address
   * @param {number} [length]
   */
  async readMemory(address, length = 32) {
    return keilReadMemoryHex(this.client, address, length)
  }

  /**
   * @param {string} addr
   * @param {number} [length]
   */
  async memory(addr, length = 32) {
    return keilReadMemoryBytes(this.client, addr, length)
  }

  /** @param {any} scenario */
  async applyScenario(scenario) {
    return keilApplyScenario(this, scenario)
  }

  /** @param {{ type: string, [key: string]: any }} cmd */
  async command(cmd) {
    return dispatchKeilCommand(this, cmd)
  }

  /** @param {any} ev */
  _handleAsyncEvent(ev) {
    handleKeilAsyncEvent(this, ev)
  }

  /**
   * @param {string} type
   * @param {any} [payload]
   */
  _pushEvent(type, payload) {
    pushKeilRingEvent(this, type, payload)
  }
}
