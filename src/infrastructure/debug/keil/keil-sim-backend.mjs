// @ts-check

import { DEBUG_EVENT_TYPES } from '../../../domain/debug/debug-event.mjs'
import { buildSignalFunctionScript } from './debug-script-builder.mjs'
import { KeilUvSockClient, UVSOCK_OPCODES } from './uvsock-client.mjs'

/**
 * Keil Simulator Debug Backend.
 * Implements the DebugBackend contract using Keil UVSOCK TCP protocol.
 * Parity with ADR-013 & Phase 12.
 */
export class KeilSimBackend {
  /**
   * @param {{
   *   debugSessionId?: string,
   *   ownerSessionId?: string,
   *   workspaceCwd?: string,
   *   eventRing?: { push: (event: any) => any },
   *   uvsockClient?: KeilUvSockClient,
   *   uv4Spawner?: (args: string[], options: any) => any,
   * }} [deps]
   */
  constructor(deps = {}) {
    this.debugSessionId = deps.debugSessionId || ''
    this.ownerSessionId = deps.ownerSessionId || ''
    this.workspaceCwd = deps.workspaceCwd || ''
    this.eventRing = deps.eventRing || null
    this.uvsockClient = deps.uvsockClient || new KeilUvSockClient()
    this.uv4Spawner = deps.uv4Spawner || null

    /** @type {any} */
    this.uv4Process = null
    /** @type {import('../../../types/debug.d.ts').SourceLocation | null} */
    this.currentLocation = null
    /** @type {Map<string, string>} */
    this.breakpointMap = new Map()
    /** @type {Map<string, string>} */
    this.watchpointMap = new Map()
    this.state = 'idle'
    this.firmwareHash = ''

    /** @param {any} ev */
    this._onUvSockEvent = (ev) => this._handleAsyncEvent(ev)
    this.uvsockClient.on('event', this._onUvSockEvent)
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
   *   },
   * }} [spec]
   */
  async start(spec = {}) {
    this.state = 'starting'
    const targetSpec = spec.targetSpec || {}
    const projectPath = targetSpec.projectPath || ''
    const target = targetSpec.target || ''
    const host = targetSpec.host || '127.0.0.1'
    const port = targetSpec.port || 5100
    this.firmwareHash = targetSpec.firmwareHash || ''

    if (!projectPath) {
      throw new Error('启动 Keil 仿真调试必须指定工程文件 (projectPath)')
    }

    // 1. Connect to UVSOCK
    if (!this.uvsockClient.connected) {
      await this.uvsockClient.connect(host, port)
    }

    // 2. Open project in Keil
    await this.uvsockClient.sendCommand(UVSOCK_OPCODES.OPEN_PROJECT, {
      project: projectPath,
      target,
    })

    // 3. Start Debug / Simulator mode
    const res = await this.uvsockClient.sendCommand(UVSOCK_OPCODES.START_DEBUG, {
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
      if (this.uvsockClient.connected) {
        await this.uvsockClient.sendCommand(UVSOCK_OPCODES.STOP_DEBUG, {})
      }
    } catch {}

    this.uvsockClient.disconnect()

    if (this.uv4Process) {
      try {
        this.uv4Process.kill()
      } catch {}
      this.uv4Process = null
    }

    this.state = 'idle'
    this._pushEvent(DEBUG_EVENT_TYPES.SESSION_STOPPED, { backend: 'keil-simulator' })

    return { ok: true, state: this.state }
  }

  /**
   * Continues simulator execution.
   */
  async continue() {
    this.state = 'running'
    this._pushEvent(DEBUG_EVENT_TYPES.RUNNING, {})
    await this.uvsockClient.sendCommand(UVSOCK_OPCODES.RUN, {})
    return { ok: true, state: 'running' }
  }

  /**
   * Alias for continue().
   */
  async run() {
    return this.continue()
  }

  /**
   * Pauses simulator execution.
   */
  async pause() {
    const res = await this.uvsockClient.sendCommand(UVSOCK_OPCODES.PAUSE, {})
    this.state = 'paused'
    this.currentLocation = res?.location || this.currentLocation
    this._pushEvent(DEBUG_EVENT_TYPES.PAUSED, {
      reason: 'manual',
      location: this.currentLocation,
    })
    return { ok: true, state: 'paused', location: this.currentLocation }
  }

  /**
   * Steps simulator by mode.
   * @param {'into' | 'over' | 'out'} [mode]
   */
  async step(mode = 'into') {
    const res = await this.uvsockClient.sendCommand(UVSOCK_OPCODES.STEP, { mode })
    this.state = 'paused'
    this.currentLocation = res?.location || this.currentLocation
    this._pushEvent(DEBUG_EVENT_TYPES.PAUSED, {
      reason: 'step',
      location: this.currentLocation,
    })
    return { ok: true, state: 'paused', location: this.currentLocation }
  }

  /**
   * Resets simulator CPU.
   * @param {'halt' | 'run'} [mode]
   */
  async reset(mode = 'halt') {
    const res = await this.uvsockClient.sendCommand(UVSOCK_OPCODES.RESET, { mode })
    this.state = 'paused'
    this.currentLocation = res?.location || null
    this._pushEvent(DEBUG_EVENT_TYPES.PAUSED, {
      reason: 'reset',
      location: this.currentLocation,
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
    const res = await this.uvsockClient.sendCommand(UVSOCK_OPCODES.SET_BP, {
      file: bp.file,
      line: bp.line,
      condition: bp.condition,
    })
    const bpNum = String(res?.bpId || bp.id)
    this.breakpointMap.set(bp.id, bpNum)
    return { ...bp, verified: true }
  }

  /**
   * Removes a breakpoint.
   * @param {string | { id: string }} bpOrId
   */
  async removeBreakpoint(bpOrId) {
    const bpId = typeof bpOrId === 'object' && bpOrId !== null ? bpOrId.id : String(bpOrId || '')
    const bpNum = this.breakpointMap.get(bpId) || bpId
    await this.uvsockClient.sendCommand(UVSOCK_OPCODES.DEL_BP, { bpId: bpNum })
    this.breakpointMap.delete(bpId)
    return true
  }

  /**
   * Adds a watchpoint.
   * @param {import('../../../types/debug.d.ts').DebugWatchpoint} wp
   */
  async addWatchpoint(wp) {
    const res = await this.uvsockClient.sendCommand(UVSOCK_OPCODES.SET_WP, {
      expression: wp.expression,
      accessType: wp.accessType || 'write',
    })
    const wpNum = String(res?.wpId || wp.id)
    this.watchpointMap.set(wp.id, wpNum)
    return { ...wp, verified: true }
  }

  /**
   * Removes a watchpoint.
   * @param {string | { id: string }} wpOrId
   */
  async removeWatchpoint(wpOrId) {
    const wpId = typeof wpOrId === 'object' && wpOrId !== null ? wpOrId.id : String(wpOrId || '')
    const wpNum = this.watchpointMap.get(wpId) || wpId
    await this.uvsockClient.sendCommand(UVSOCK_OPCODES.DEL_WP, { wpId: wpNum })
    this.watchpointMap.delete(wpId)
    return true
  }

  /**
   * Evaluates an expression in current scope.
   * @param {string} expr
   * @param {number} [frame]
   * @returns {Promise<string>}
   */
  async evaluate(expr, frame = 0) {
    const res = await this.uvsockClient.sendCommand(UVSOCK_OPCODES.EVAL, {
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
    const res = await this.uvsockClient.sendCommand(UVSOCK_OPCODES.READ_REGS, {})
    return Array.isArray(res?.registers) ? res.registers : []
  }

  /**
   * Reads memory and returns hex string representation.
   * @param {string} address
   * @param {number} [length]
   * @returns {Promise<string>}
   */
  async readMemory(address, length = 32) {
    const res = await this.uvsockClient.sendCommand(UVSOCK_OPCODES.READ_MEM, {
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
    await this.uvsockClient.sendCommand(UVSOCK_OPCODES.EXEC_CMD, {
      command: script,
    })
    // Trigger signal function execution
    await this.uvsockClient.sendCommand(UVSOCK_OPCODES.EXEC_CMD, {
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
    if (ev.opcode === UVSOCK_OPCODES.PAUSE || p.event === 'stop') {
      this.state = 'paused'
      this.currentLocation = p.location || this.currentLocation
      this._pushEvent(DEBUG_EVENT_TYPES.PAUSED, {
        reason: p.reason || 'watchpoint-hit',
        location: this.currentLocation,
        watchpointExpression: p.watchpointExpression,
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
