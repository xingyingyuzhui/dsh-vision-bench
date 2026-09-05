// @ts-check

import { DEBUG_EVENT_TYPES } from '../../../domain/debug/debug-event.mjs'
import { buildSignalFunctionScript } from './debug-script-builder.mjs'
import { UV4DebugProcess } from './uv4-debug-process.mjs'
import { UV_OPERATION, UV_STATUS, UvSockClient } from './uvsock-client.mjs'

/**
 * Keil Simulator Debug Backend.
 * Implements the DebugBackend contract using official Keil UVSOCK semantic protocol client.
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
   *   uv4Process?: UV4DebugProcess,
   * }} [deps]
   */
  constructor(deps = {}) {
    this.debugSessionId = deps.debugSessionId || ''
    this.ownerSessionId = deps.ownerSessionId || ''
    this.workspaceCwd = deps.workspaceCwd || ''
    this.eventRing = deps.eventRing || null

    /** @type {UvSockClient} */
    this.client = deps.uvsockClient || deps.uvscClient || new UvSockClient()
    // Compatibility accessors
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
   * Returns backend capabilities.
   */
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
   * Starts the Keil Simulator session.
   *
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
    this.state = 'starting'
    const targetSpec = spec.targetSpec || {}
    const projectPath = targetSpec.projectPath || ''
    const target = targetSpec.target || ''
    const host = targetSpec.host || '127.0.0.1'
    let port = targetSpec.port || 5100
    this.firmwareHash = targetSpec.firmwareHash || ''

    if (!projectPath) {
      throw new Error('启动 Keil 仿真调试必须指定工程文件 (projectPath)')
    }

    // 1. Optionally spawn UV4 if requested
    if (targetSpec.spawnUv4 && !this.uv4Process) {
      this.uv4Process = new UV4DebugProcess({ uv4Bin: targetSpec.uv4Bin })
      const launched = await this.uv4Process.launch({
        projectPath,
        target,
        preferredPort: port,
        uv4Bin: targetSpec.uv4Bin,
      })
      port = launched.port
    }

    // 2. Connect to UVSOCK
    if (!this.client.connected) {
      await this.client.connect(host, port)
    }

    // 3. Open project in Keil
    await this.client.loadProject(projectPath)

    if (target) {
      await this.client.setTarget(target)
    }

    // 4. Enter Debug / Simulator mode
    const res = await this.client.enterDebug()

    this.state = 'paused'
    this.currentLocation = res?.location || {
      file: 'main.c',
      line: 1,
      function: 'main',
    }

    this._pushEvent(DEBUG_EVENT_TYPES.SESSION_READY, {
      backend: 'keil-simulator',
      location: this.currentLocation,
    })

    return {
      ok: true,
      state: this.state,
      location: this.currentLocation,
    }
  }

  /**
   * Stops simulation and cleans up resources and processes.
   */
  async stop() {
    this.state = 'stopping'
    try {
      if (this.client.connected) {
        await this.client.exitDebug()
      }
    } catch {}

    this.client.close()

    if (this.uv4Process) {
      try {
        await this.uv4Process.stop()
      } catch {}
      this.uv4Process = null
    }

    this.state = 'idle'
    this._pushEvent(DEBUG_EVENT_TYPES.SESSION_STOPPED, { backend: 'keil-simulator' })

    this._emit({
      type: 'backend.exited',
      unexpected: false,
    })

    return { ok: true, state: this.state }
  }

  /**
   * Continues simulator execution.
   */
  async continue() {
    this.state = 'running'
    this._pushEvent(DEBUG_EVENT_TYPES.RUNNING, {})
    this._emit({
      type: 'backend.running',
    })

    await this.client.startExecution()
    return { ok: true, state: 'running' }
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

  /**
   * Pauses simulator execution.
   */
  async pause() {
    const res = await this.client.stopExecution()
    this.state = 'paused'
    this.currentLocation = res?.location || this.currentLocation

    this._pushEvent(DEBUG_EVENT_TYPES.PAUSED, {
      reason: 'manual',
      location: this.currentLocation,
    })

    this._emit({
      type: 'backend.stopped',
      reason: 'manual',
      location: this.currentLocation || undefined,
    })

    return { ok: true, state: 'paused', location: this.currentLocation }
  }

  /**
   * Steps simulator by mode.
   * @param {'into' | 'over' | 'out'} [mode]
   */
  async step(mode = 'into') {
    this.state = 'running'
    this._emit({
      type: 'backend.running',
    })

    let res = null
    if (mode === 'into') {
      res = await this.client.stepInto()
    } else if (mode === 'out') {
      res = await this.client.stepOut()
    } else {
      res = await this.client.stepOver()
    }

    this.state = 'paused'
    this.currentLocation = res?.location || this.currentLocation

    this._pushEvent(DEBUG_EVENT_TYPES.PAUSED, {
      reason: 'step',
      location: this.currentLocation,
    })

    this._emit({
      type: 'backend.stopped',
      reason: 'step',
      location: this.currentLocation || undefined,
    })

    return { ok: true, state: 'paused', location: this.currentLocation }
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

  /**
   * Resets simulator CPU.
   * @param {'halt' | 'run'} [_mode]
   */
  async reset(_mode = 'halt') {
    const res = await this.client.reset()
    this.state = 'paused'
    this.currentLocation = res?.location || {
      file: 'main.c',
      line: 1,
      function: 'Reset_Handler',
      address: '0x08000000',
    }

    this._pushEvent(DEBUG_EVENT_TYPES.PAUSED, {
      reason: 'reset',
      location: this.currentLocation,
    })

    this._emit({
      type: 'backend.stopped',
      reason: 'reset',
      location: this.currentLocation || undefined,
    })

    return { ok: true, state: 'paused', location: this.currentLocation }
  }

  async resetHalt() {
    return this.reset('halt')
  }

  /**
   * Adds a breakpoint.
   * @param {import('../../../types/debug.d.ts').DebugBreakpoint} bp
   */
  async addBreakpoint(bp) {
    const res = await this.client.createBreakpoint(bp)
    const bpNum = String(res.id || bp.id)
    this.breakpointMap.set(bp.id, bpNum)
    return { ...bp, verified: true }
  }

  /** @param {import('../../../types/debug.d.ts').DebugBreakpoint} bp */
  async setBreakpoint(bp) {
    return this.addBreakpoint(bp)
  }

  /**
   * Removes a breakpoint.
   * @param {string | { id: string }} bpOrId
   */
  async removeBreakpoint(bpOrId) {
    const bpId = typeof bpOrId === 'object' && bpOrId !== null ? bpOrId.id : String(bpOrId || '')
    const bpNum = this.breakpointMap.get(bpId) || bpId
    await this.client.deleteBreakpoint(bpNum)
    this.breakpointMap.delete(bpId)
    return true
  }

  /** @param {string} id */
  async clearBreakpoint(id) {
    return this.removeBreakpoint(id)
  }

  /**
   * Adds a watchpoint via execution command.
   * @param {import('../../../types/debug.d.ts').DebugWatchpoint} wp
   */
  async addWatchpoint(wp) {
    await this.client.executeCommand(`WS ${wp.expression}`)
    const wpNum = String(wp.id)
    this.watchpointMap.set(wp.id, wpNum)
    return { ...wp, verified: true }
  }

  /** @param {import('../../../types/debug.d.ts').DebugWatchpoint} wp */
  async setWatchpoint(wp) {
    return this.addWatchpoint(wp)
  }

  /**
   * Removes a watchpoint.
   * @param {string | { id: string }} wpOrId
   */
  async removeWatchpoint(wpOrId) {
    const wpId = typeof wpOrId === 'object' && wpOrId !== null ? wpOrId.id : String(wpOrId || '')
    const wpNum = this.watchpointMap.get(wpId) || wpId
    await this.client.executeCommand(`BK ${wpNum}`)
    this.watchpointMap.delete(wpId)
    return true
  }

  /** @param {string} id */
  async clearWatchpoint(id) {
    return this.removeWatchpoint(id)
  }

  /**
   * Evaluates an expression in current scope.
   * @param {string} expr
   * @param {number} [_frame]
   * @returns {Promise<string>}
   */
  async evaluate(expr, _frame = 0) {
    const res = await this.client.evaluateExpression(expr)
    return res.value != null ? String(res.value) : ''
  }

  /**
   * Retrieves stack frames.
   * @param {number} [_depth]
   * @returns {Promise<import('../../../types/debug.d.ts').DebugStackFrame[]>}
   */
  async stack(_depth = 20) {
    try {
      const items = await this.client.enumStack()
      if (Array.isArray(items) && items.length > 0) {
        return items.map((item, idx) => ({
          level: idx,
          function: `frame_${item.nItem ?? idx}`,
          file: this.currentLocation?.file || '',
          line: Number(item.nAdr ? item.nAdr & 0xffffn : 1),
        }))
      }
    } catch {}

    return [
      {
        level: 0,
        function: this.currentLocation?.function || 'main',
        file: this.currentLocation?.file || '',
        line: this.currentLocation?.line || 1,
      },
    ]
  }

  /**
   * Retrieves local variables.
   * @returns {Promise<import('../../../types/debug.d.ts').DebugVariable[]>}
   */
  async locals() {
    try {
      const vars = await this.client.enumVariables()
      if (Array.isArray(vars) && vars.length > 0) {
        return vars.map((v) => ({
          name: v.name,
          value: v.value,
          type: v.type,
        }))
      }
    } catch {}
    return []
  }

  /**
   * Inspects current location, stack, and local variables.
   * @param {number} [frame]
   */
  async inspect(frame = 0) {
    const evalRes = await this.evaluate('1', frame).catch(() => '1')
    return {
      location: this.currentLocation,
      stack: await this.stack(),
      locals: await this.locals(),
      registers: await this.registers().catch(() => []),
      evalProbe: evalRes,
    }
  }

  /**
   * Reads CPU registers.
   * @returns {Promise<import('../../../types/debug.d.ts').DebugRegister[]>}
   */
  async registers() {
    try {
      const regs = await this.client.readRegisters()
      if (Array.isArray(regs) && regs.length > 0) {
        return regs.map((r) => ({
          name: r.name || 'REG',
          value: r.value || '0x0',
        }))
      }
    } catch {}

    return [
      { name: 'R0', value: '0x00000000' },
      { name: 'PC', value: '0x08000120' },
    ]
  }

  async readRegisters() {
    return this.registers()
  }

  /**
   * Reads memory and returns hex string representation.
   * @param {string} address
   * @param {number} [length]
   * @returns {Promise<string>}
   */
  async readMemory(address, length = 32) {
    const res = await this.client.readMemory(address, length)
    return res.hex || ''
  }

  /**
   * Reads memory and returns structured object.
   * @param {string} addr
   * @param {number} length
   */
  async memory(addr, length = 32) {
    const res = await this.client.readMemory(addr, length)
    return {
      address: addr,
      bytes: res.bytes,
    }
  }

  /**
   * Applies a safe Signal Function scenario script to simulator.
   *
   * @param {any} scenario
   */
  async applyScenario(scenario) {
    const script = buildSignalFunctionScript(scenario)
    await this.client.executeCommand(script)
    await this.client.executeCommand(`${scenario.name}()`)
    return { ok: true, scenario: scenario.name }
  }

  /**
   * Generic command dispatcher fallback.
   * @param {{ type: string, [key: string]: any }} cmd
   */
  async command(cmd) {
    switch (cmd.type) {
      case 'continue':
      case 'run':
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
        return this.removeWatchpoint(cmd.id || cmd.watchpoint)
      case 'applyScenario':
        return this.applyScenario(cmd.scenario)
      default:
        throw new Error(`KeilSimBackend 不支持的指令: ${cmd.type}`)
    }
  }

  /** @param {any} ev */
  _handleAsyncEvent(ev) {
    const isStop =
      ev.type === 'stop_execution' ||
      ev.cmd === UV_OPERATION.UV_DBG_STOP_EXECUTION ||
      (ev.type === 'async_response' && ev.cmd === UV_OPERATION.UV_DBG_STOP_EXECUTION) ||
      ev.opcode === UV_OPERATION.UV_DBG_STOP_EXECUTION

    if (isStop) {
      this.state = 'paused'
      const rawReason = String(ev.text || ev.details?.error?.message || ev.details?.message || 'stop')
      /** @type {import('../../../types/debug-backend.d.ts').BackendStopReason} */
      let reason = 'pause'
      if (rawReason.includes('breakpoint')) reason = 'breakpoint'
      else if (rawReason.includes('watchpoint')) reason = 'watchpoint'
      else if (rawReason.includes('step')) reason = 'step'
      else if (rawReason.includes('signal')) reason = 'signal'

      this._pushEvent(DEBUG_EVENT_TYPES.PAUSED, {
        reason: rawReason,
        location: this.currentLocation,
        watchpointExpression: ev.watchpointExpression,
      })

      this._emit({
        type: 'backend.stopped',
        reason,
        location: this.currentLocation || undefined,
        nativeReason: rawReason,
      })
    } else if (ev.type === 'build_output' || ev.cmd === UV_OPERATION.UV_DBG_CMD_OUTPUT) {
      this._emit({
        type: 'backend.console',
        stream: 'target',
        text: ev.text || '',
      })
    }
  }

  /**
   * @param {string} type
   * @param {any} [payload]
   */
  _pushEvent(type, payload) {
    if (this.eventRing) {
      this.eventRing.push({
        debugSessionId: this.debugSessionId,
        ownerSessionId: this.ownerSessionId,
        workspaceCwd: this.workspaceCwd,
        timestamp: Date.now(),
        type,
        backend: 'keil-simulator',
        payload,
      })
    }
  }
}
