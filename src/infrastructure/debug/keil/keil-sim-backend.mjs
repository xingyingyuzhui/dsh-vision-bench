// @ts-check

import { DEBUG_EVENT_TYPES } from '../../../domain/debug/debug-event.mjs'
import { buildSignalFunctionScript } from './debug-script-builder.mjs'
import { UV4DebugProcess } from './uv4-debug-process.mjs'
import { KeilUvscClient, UVSC_OPCODES, UVSC_STATUS } from './uvsc-client.mjs'

/**
 * Keil Simulator Debug Backend.
 * Implements the DebugBackend contract using Keil UVSC binary TCP protocol.
 * Parity with ADR-013, ADR-016 & PR-D.
 */
export class KeilSimBackend {
  /**
   * @param {{
   *   debugSessionId?: string,
   *   ownerSessionId?: string,
   *   workspaceCwd?: string,
   *   eventRing?: { push: (event: any) => any },
   *   uvscClient?: KeilUvscClient,
   *   uvsockClient?: KeilUvscClient,
   *   uv4Process?: UV4DebugProcess,
   * }} [deps]
   */
  constructor(deps = {}) {
    this.debugSessionId = deps.debugSessionId || ''
    this.ownerSessionId = deps.ownerSessionId || ''
    this.workspaceCwd = deps.workspaceCwd || ''
    this.eventRing = deps.eventRing || null
    this.uvscClient = deps.uvscClient || deps.uvsockClient || new KeilUvscClient()
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
    this._onUvscEvent = (ev) => this._handleAsyncEvent(ev)
    this.uvscClient.on('event', this._onUvscEvent)
  }

  /**
   * Internal sender helper supporting both sendRequest and sendCommand.
   * @param {number} opcode
   * @param {any} [payload]
   */
  async _send(opcode, payload = {}) {
    if (typeof this.uvscClient.sendRequest === 'function') {
      return this.uvscClient.sendRequest(opcode, payload)
    }
    return this.uvscClient.sendCommand(opcode, payload)
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

    // 2. Connect to UVSC
    if (!this.uvscClient.connected) {
      await this.uvscClient.connect(host, port)
    }

    // 3. Open project in Keil
    await this._send(UVSC_OPCODES.UV_PRJ_LOAD, {
      project: projectPath,
    })

    if (target) {
      await this._send(UVSC_OPCODES.UV_PRJ_SET_TARGET, {
        target,
      })
    }

    // 4. Enter Debug / Simulator mode
    const res = await this._send(UVSC_OPCODES.UV_DBG_ENTER, {
      simulator: true,
    })

    this.state = 'paused'
    this.currentLocation = res?.location || null

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
      if (this.uvscClient.connected) {
        await this._send(UVSC_OPCODES.UV_DBG_EXIT, {})
      }
    } catch {}

    this.uvscClient.disconnect()

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

    await this._send(UVSC_OPCODES.UV_DBG_START_EXECUTION, {})
    return { ok: true, state: 'running' }
  }

  /**
   * Alias for continue().
   */
  async run() {
    return this.continue()
  }

  /**
   * Alias for continue().
   */
  async resume() {
    return this.continue()
  }

  /**
   * Requests pause.
   */
  async requestPause() {
    return this.pause()
  }

  /**
   * Pauses simulator execution.
   */
  async pause() {
    const res = await this._send(UVSC_OPCODES.UV_DBG_STOP_EXECUTION, {})
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

    let opcode = UVSC_OPCODES.UV_DBG_STEP_HLL
    if (mode === 'into') opcode = UVSC_OPCODES.UV_DBG_STEP_INTO
    else if (mode === 'out') opcode = UVSC_OPCODES.UV_DBG_STEP_OUT

    const res = await this._send(opcode, { mode })
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
   * @param {'halt' | 'run'} [mode]
   */
  async reset(mode = 'halt') {
    const res = await this._send(UVSC_OPCODES.UV_DBG_RESET, { mode })
    this.state = 'paused'
    this.currentLocation = res?.location || null

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

  /**
   * Resets target CPU and halts.
   */
  async resetHalt() {
    return this.reset('halt')
  }

  /**
   * Adds a breakpoint.
   * @param {import('../../../types/debug.d.ts').DebugBreakpoint} bp
   */
  async addBreakpoint(bp) {
    const res = await this._send(UVSC_OPCODES.UV_DBG_CREATE_BP, {
      file: bp.file,
      line: bp.line,
      condition: bp.condition,
    })
    const bpNum = String(res?.bpId || bp.id)
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
    await this._send(UVSC_OPCODES.UV_DBG_CHANGE_BP, { bpId: bpNum, action: 'delete' })
    this.breakpointMap.delete(bpId)
    return true
  }

  /** @param {string} id */
  async clearBreakpoint(id) {
    return this.removeBreakpoint(id)
  }

  /**
   * Adds a watchpoint.
   * @param {import('../../../types/debug.d.ts').DebugWatchpoint} wp
   */
  async addWatchpoint(wp) {
    const res = await this._send(UVSC_OPCODES.UV_DBG_EXEC_CMD, {
      command: `WS ${wp.expression}`,
      expression: wp.expression,
      accessType: wp.accessType || 'write',
    })
    const wpNum = String(res?.wpId || wp.id)
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
    await this._send(UVSC_OPCODES.UV_DBG_EXEC_CMD, {
      command: `BK ${wpNum}`,
      wpId: wpNum,
      action: 'delete',
    })
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
   * @param {number} [frame]
   * @returns {Promise<string>}
   */
  async evaluate(expr, frame = 0) {
    const res = await this._send(UVSC_OPCODES.UV_DBG_EVAL_EXPRESSION_TO_STR, {
      expression: expr,
      frame,
    })
    return res?.value != null ? String(res.value) : String(res?.result ?? '')
  }

  /**
   * Retrieves stack frames.
   * @param {number} [_depth]
   * @returns {Promise<import('../../../types/debug.d.ts').DebugStackFrame[]>}
   */
  async stack(_depth = 20) {
    try {
      const res = await this._send(UVSC_OPCODES.UV_DBG_ENUM_STACK, { depth: _depth })
      if (Array.isArray(res?.frames)) return res.frames
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
      const res = await this._send(UVSC_OPCODES.UV_DBG_ENUM_VARIABLES, {})
      if (Array.isArray(res?.variables)) return res.variables
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
    const res = await this._send(UVSC_OPCODES.UV_DBG_READ_REGISTERS, {})
    return Array.isArray(res?.registers) ? res.registers : []
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
    const res = await this._send(UVSC_OPCODES.UV_DBG_MEM_READ, {
      address,
      length,
    })
    if (typeof res?.contents === 'string') return res.contents
    if (Array.isArray(res?.bytes)) {
      return res.bytes.map((/** @type {any} */ b) => Number(b).toString(16).padStart(2, '0')).join('')
    }
    return String(res?.memory || '')
  }

  /**
   * Reads memory and returns structured object.
   * @param {string} addr
   * @param {number} length
   */
  async memory(addr, length = 32) {
    const hex = await this.readMemory(addr, length)
    const bytes = []
    for (let i = 0; i < hex.length; i += 2) {
      bytes.push(Number.parseInt(hex.slice(i, i + 2), 16))
    }
    return {
      address: addr,
      bytes,
    }
  }

  /**
   * Applies a safe Signal Function scenario script to simulator.
   *
   * @param {any} scenario
   */
  async applyScenario(scenario) {
    const script = buildSignalFunctionScript(scenario)
    await this._send(UVSC_OPCODES.UV_DBG_EXEC_CMD, {
      command: script,
    })
    // Trigger signal function execution
    await this._send(UVSC_OPCODES.UV_DBG_EXEC_CMD, {
      command: `${scenario.name}()`,
    })
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
    const p = ev.payload || {}
    if (
      ev.opcode === UVSC_OPCODES.UV_DBG_STOP_EXECUTION ||
      ev.opcode === UVSC_OPCODES.UV_ASYNC_MSG ||
      ev.opcode === UVSC_OPCODES.UV_DBG_CALLBACK ||
      p.event === 'stop'
    ) {
      this.state = 'paused'
      this.currentLocation = p.location || this.currentLocation
      const rawReason = String(p.reason || 'watchpoint-hit')
      /** @type {import('../../../types/debug-backend.d.ts').BackendStopReason} */
      let reason = 'pause'
      if (rawReason.includes('breakpoint')) reason = 'breakpoint'
      else if (rawReason.includes('watchpoint')) reason = 'watchpoint'
      else if (rawReason.includes('step')) reason = 'step'
      else if (rawReason.includes('signal')) reason = 'signal'

      this._pushEvent(DEBUG_EVENT_TYPES.PAUSED, {
        reason: rawReason,
        location: this.currentLocation,
        watchpointExpression: p.watchpointExpression,
      })

      this._emit({
        type: 'backend.stopped',
        reason,
        location: this.currentLocation || undefined,
        nativeReason: rawReason,
      })
    } else if (ev.opcode === UVSC_OPCODES.UV_DBG_CMD_OUTPUT) {
      this._emit({
        type: 'backend.console',
        stream: 'target',
        text: typeof p === 'string' ? p : p.text || p.raw || '',
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
