// @ts-check

import { EventEmitter } from 'node:events'
import { createConnection } from 'node:net'
import { decodeAsyncMessage } from './uvsock/async-codec.mjs'
import { decodeCommandResponse } from './uvsock/command-response-codec.mjs'
import { UV_OPERATION } from './uvsock/operation.mjs'
import { PacketAccumulator, encodePacket } from './uvsock/packet-codec.mjs'
import { UV_STATUS, statusToString } from './uvsock/status.mjs'
import { CHG_TYPE, encodeBkChg, encodeBkParm } from './uvsock/structures/breakpoint.mjs'
import { encodeVset } from './uvsock/structures/expression.mjs'
import { encodeAmem } from './uvsock/structures/memory.mjs'
import { encodePrjData } from './uvsock/structures/project.mjs'
import { encodeIstkEnum } from './uvsock/structures/stack.mjs'
import { encodeIvarEnum } from './uvsock/structures/variable.mjs'

export { UV_OPERATION, UV_STATUS, statusToString }

/**
 * Official ARM Keil UVSOCK TCP client adhering to UVSOCK.h 32-byte header binary wire protocol.
 */
export class UvSockClient extends EventEmitter {
  /**
   * @param {{ host?: string, port?: number, timeoutMs?: number }} [options]
   */
  constructor(options = {}) {
    super()
    this.host = options.host || '127.0.0.1'
    this.port = options.port || 5100
    this.timeoutMs = options.timeoutMs || 5000

    /** @type {import('node:net').Socket | null} */
    this.socket = null
    this.connected = false

    /** @type {Array<{ cmd: number, resolve: (res: any) => void, reject: (err: any) => void, timer: NodeJS.Timeout }>} */
    this.pendingQueue = []
    this.accumulator = new PacketAccumulator()
    /** @type {Set<(event: any) => void>} */
    this.asyncListeners = new Set()
  }

  /**
   * Connects to Keil UVSOCK server.
   *
   * @param {string} [host]
   * @param {number} [port]
   * @returns {Promise<void>}
   */
  async connect(host = this.host, port = this.port) {
    this.host = host
    this.port = port

    return new Promise((resolve, reject) => {
      const sock = createConnection({ host: this.host, port: this.port })
      let settled = false

      const fail = (/** @type {any} */ err) => {
        if (settled) return
        settled = true
        this.connected = false
        reject(err)
      }

      const timer = setTimeout(() => {
        sock.destroy()
        fail(new Error(`UVSOCK connect timeout: ${this.host}:${this.port}`))
      }, this.timeoutMs)

      sock.on('connect', () => {
        clearTimeout(timer)
        if (settled) return
        settled = true
        this.socket = sock
        this.connected = true
        resolve()
      })

      sock.on('data', (chunk) => this._onData(chunk))
      sock.on('error', (err) => {
        if (!settled) {
          fail(err)
        } else if (this.listenerCount('error') > 0) {
          this.emit('error', err)
        }
      })

      sock.on('close', () => {
        this.connected = false
        this.socket = null
        this._rejectAllPending(new Error('UVSOCK connection closed'))
        this.emit('close')
      })
    })
  }

  /**
   * Closes connection.
   */
  close() {
    this.connected = false
    if (this.socket) {
      try {
        this.socket.destroy()
      } catch {}
      this.socket = null
    }
    this._rejectAllPending(new Error('UVSOCK disconnected'))
  }

  disconnect() {
    this.close()
  }

  /**
   * Registers an async event listener.
   * @param {(event: any) => void} listener
   * @returns {() => void}
   */
  onAsync(listener) {
    this.asyncListeners.add(listener)
    return () => {
      this.asyncListeners.delete(listener)
    }
  }

  /**
   * Low-level command send helper. Sends a 32-byte header packet and awaits response.
   *
   * @param {number} cmd
   * @param {Buffer} [payload]
   * @param {{ timeoutMs?: number }} [opts]
   * @returns {Promise<any>}
   */
  async sendCommand(cmd, payload = Buffer.alloc(0), opts = {}) {
    if (!this.connected || !this.socket) {
      throw new Error('UVSOCK client is not connected')
    }

    const timeout = opts.timeoutMs || this.timeoutMs
    const packet = encodePacket({ cmd, payload })

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.pendingQueue.findIndex((p) => p.timer === timer)
        if (idx !== -1) {
          this.pendingQueue.splice(idx, 1)
        }
        reject(new Error(`UVSOCK command timeout (cmd: 0x${cmd.toString(16)})`))
      }, timeout)

      this.pendingQueue.push({ cmd, resolve, reject, timer })
      this.socket?.write(packet)
    })
  }

  /**
   * Compatibility alias for sendCommand.
   * @param {number} cmd
   * @param {Buffer} [payload]
   * @param {{ timeoutMs?: number }} [opts]
   */
  async sendRequest(cmd, payload = Buffer.alloc(0), opts = {}) {
    return this.sendCommand(cmd, payload, opts)
  }

  // ==========================================
  // Semantic UVSOCK Client API (Section 25)
  // ==========================================

  /**
   * UV_GEN_GET_VERSION (0x0001)
   */
  async getVersion() {
    const res = await this.sendCommand(UV_OPERATION.UV_GEN_GET_VERSION)
    const rawVal = res.value ?? 0
    const major = (rawVal >> 8) & 0xff
    const minor = rawVal & 0xff
    return {
      raw: rawVal,
      version: `${major}.${minor}`,
    }
  }

  /**
   * UV_PRJ_LOAD (0x1000)
   * @param {string} projectPath
   */
  async loadProject(projectPath) {
    const payload = encodePrjData({ names: projectPath })
    return this.sendCommand(UV_OPERATION.UV_PRJ_LOAD, payload)
  }

  /**
   * UV_PRJ_SET_TARGET (0x1016)
   * @param {string} targetName
   */
  async setTarget(targetName) {
    const payload = encodePrjData({ names: targetName })
    return this.sendCommand(UV_OPERATION.UV_PRJ_SET_TARGET, payload)
  }

  /**
   * UV_PRJ_GET_CUR_TARGET (0x1017)
   */
  async getCurrentTarget() {
    const res = await this.sendCommand(UV_OPERATION.UV_PRJ_GET_CUR_TARGET)
    return res.string || ''
  }

  /**
   * UV_DBG_ENTER (0x2000)
   */
  async enterDebug() {
    return this.sendCommand(UV_OPERATION.UV_DBG_ENTER)
  }

  /**
   * UV_DBG_EXIT (0x2001)
   */
  async exitDebug() {
    return this.sendCommand(UV_OPERATION.UV_DBG_EXIT)
  }

  /**
   * UV_DBG_STATUS (0x2004)
   * @returns {Promise<{ executing: boolean, stopped: boolean, raw: number }>}
   */
  async getDebugStatus() {
    const res = await this.sendCommand(UV_OPERATION.UV_DBG_STATUS)
    const executing = (res.value & 1) === 1
    return {
      executing,
      stopped: !executing,
      raw: res.value,
    }
  }

  /**
   * UV_DBG_START_EXECUTION (0x2002)
   */
  async startExecution() {
    return this.sendCommand(UV_OPERATION.UV_DBG_START_EXECUTION)
  }

  /**
   * UV_DBG_STOP_EXECUTION (0x2003)
   */
  async stopExecution() {
    return this.sendCommand(UV_OPERATION.UV_DBG_STOP_EXECUTION)
  }

  /**
   * UV_DBG_RESET (0x2005)
   */
  async reset() {
    return this.sendCommand(UV_OPERATION.UV_DBG_RESET)
  }

  /**
   * UV_DBG_STEP_HLL (0x2006) - Step Over
   */
  async stepOver() {
    return this.sendCommand(UV_OPERATION.UV_DBG_STEP_HLL)
  }

  /**
   * UV_DBG_STEP_INTO (0x2007) - Step Into
   */
  async stepInto() {
    return this.sendCommand(UV_OPERATION.UV_DBG_STEP_INTO)
  }

  /**
   * UV_DBG_STEP_OUT (0x2009) - Step Out
   */
  async stepOut() {
    return this.sendCommand(UV_OPERATION.UV_DBG_STEP_OUT)
  }

  /**
   * UV_DBG_CALC_EXPRESSION (0x200a)
   * @param {string} expr
   */
  async evaluateExpression(expr) {
    const payload = encodeVset({ str: expr })
    const res = await this.sendCommand(UV_OPERATION.UV_DBG_CALC_EXPRESSION, payload)
    return {
      expression: expr,
      value: res.expression?.val?.asString ?? String(res.expression?.val?.value ?? ''),
      type: res.expression?.val?.type,
      raw: res.expression?.val,
    }
  }

  /**
   * UV_DBG_CREATE_BP (0x2014)
   * @param {{
   *   file?: string,
   *   line?: number,
   *   expression?: string,
   *   command?: string,
   *   type?: number,
   * }} spec
   */
  async createBreakpoint(spec) {
    const expr = spec.expression || (spec.file && spec.line ? `${spec.file}\\${spec.line}` : '')
    const payload = encodeBkParm({
      expression: expr,
      command: spec.command,
      type: spec.type,
    })
    const res = await this.sendCommand(UV_OPERATION.UV_DBG_CREATE_BP, payload)
    return {
      id: res.breakpoint?.nTickMark != null ? String(res.breakpoint.nTickMark) : '1',
      tickMark: res.breakpoint?.nTickMark ?? 0,
      verified: res.ok,
      breakpoint: res.breakpoint,
    }
  }

  /**
   * UV_DBG_CHANGE_BP (0x2016)
   * @param {number | string} idOrTickMark
   */
  async deleteBreakpoint(idOrTickMark) {
    const payload = encodeBkChg({
      type: CHG_TYPE.CHG_KILLBP,
      nTickMark: Number(idOrTickMark) || 0,
    })
    return this.sendCommand(UV_OPERATION.UV_DBG_CHANGE_BP, payload)
  }

  /**
   * UV_DBG_ENUM_STACK (0x2019)
   */
  async enumStack() {
    const payload = encodeIstkEnum({ bExtended: true })
    const res = await this.sendCommand(UV_OPERATION.UV_DBG_ENUM_STACK, payload)
    return res.stack ? [res.stack] : []
  }

  /**
   * UV_DBG_ENUM_VARIABLES (0x202e)
   * @param {number} [frame=0]
   */
  async enumVariables(frame = 0) {
    const payload = encodeIvarEnum({ nFrame: frame })
    const res = await this.sendCommand(UV_OPERATION.UV_DBG_ENUM_VARIABLES, payload)
    return res.variable ? [res.variable] : []
  }

  /**
   * UV_DBG_ENUM_REGISTER_GROUPS (0x2026)
   */
  async enumRegisterGroups() {
    return this.sendCommand(UV_OPERATION.UV_DBG_ENUM_REGISTER_GROUPS)
  }

  /**
   * UV_DBG_ENUM_REGISTERS (0x2027)
   */
  async enumRegisters() {
    return this.sendCommand(UV_OPERATION.UV_DBG_ENUM_REGISTERS)
  }

  /**
   * UV_DBG_READ_REGISTERS (0x2028)
   */
  async readRegisters() {
    const res = await this.sendCommand(UV_OPERATION.UV_DBG_READ_REGISTERS)
    return res.register ? [res.register] : []
  }

  /**
   * UV_DBG_MEM_READ (0x200b)
   * @param {string | number | bigint} address
   * @param {number} [length=32]
   */
  async readMemory(address, length = 32) {
    const addr = typeof address === 'string' && address.startsWith('0x') ? BigInt(address) : BigInt(address || 0)
    const payload = encodeAmem({ address: addr, nBytes: length })
    const res = await this.sendCommand(UV_OPERATION.UV_DBG_MEM_READ, payload)
    return {
      address: `0x${addr.toString(16)}`,
      hex: res.memory?.hex || '',
      bytes: res.memory?.bytes ? Array.from(res.memory.bytes) : [],
    }
  }

  /**
   * UV_DBG_EXEC_CMD (0x2020)
   * @param {string} commandStr
   */
  async executeCommand(commandStr) {
    const buf = Buffer.alloc(commandStr.length + 1)
    buf.write(commandStr, 'utf8')
    buf[commandStr.length] = 0
    return this.sendCommand(UV_OPERATION.UV_DBG_EXEC_CMD, buf)
  }

  /**
   * UV_GEN_EXIT (0x0009)
   */
  async exit() {
    return this.sendCommand(UV_OPERATION.UV_GEN_EXIT)
  }

  // ==========================================
  // Internal Stream Handling
  // ==========================================

  /**
   * @param {Buffer} chunk
   */
  _onData(chunk) {
    const packets = this.accumulator.feed(chunk)

    for (const packet of packets) {
      const { header, payload } = packet

      // Command Response packet
      if (header.cmd === UV_OPERATION.UV_CMD_RESPONSE) {
        let decoded = null
        try {
          decoded = decodeCommandResponse(payload)
        } catch (err) {
          // Bad packet payload
          continue
        }

        // Match with pending FIFO queue or matching command
        let matchIdx = this.pendingQueue.findIndex((p) => p.cmd === decoded.cmd)
        if (matchIdx === -1 && this.pendingQueue.length > 0) {
          matchIdx = 0 // FIFO fallback
        }

        if (matchIdx !== -1) {
          const pending = this.pendingQueue.splice(matchIdx, 1)[0]
          clearTimeout(pending.timer)

          if (!decoded.ok) {
            const errMsg =
              decoded.error?.message || `UVSOCK failed with status ${decoded.statusText} (${decoded.status})`
            pending.resolve({
              ...decoded,
              ok: false,
              status: decoded.status,
              error: errMsg,
            })
          } else {
            pending.resolve(decoded)
          }
        }
      } else {
        // Asynchronous unsolicited message
        const asyncMsg = decodeAsyncMessage(packet)
        this.emit('async', asyncMsg)
        this.emit('event', asyncMsg)

        for (const listener of this.asyncListeners) {
          try {
            listener(asyncMsg)
          } catch {}
        }
      }
    }
  }

  /**
   * @param {any} err
   */
  _rejectAllPending(err) {
    for (const pending of this.pendingQueue) {
      clearTimeout(pending.timer)
      pending.reject(err)
    }
    this.pendingQueue = []
  }
}

// Backwards compatibility alias classes
export class KeilUvSockClient extends UvSockClient {}
export class KeilUvscClient extends UvSockClient {}
export const UVSC_OPCODES = UV_OPERATION
export const UVSC_STATUS = UV_STATUS
