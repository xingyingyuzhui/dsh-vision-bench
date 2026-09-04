// @ts-check

import { EventEmitter } from 'node:events'
import { createConnection } from 'node:net'

/**
 * UVSOCK Command Opcode Constants
 */
export const UVSOCK_OPCODES = {
  PING: 0x01,
  OPEN_PROJECT: 0x02,
  START_DEBUG: 0x03,
  STOP_DEBUG: 0x04,
  RUN: 0x05,
  PAUSE: 0x06,
  STEP: 0x07,
  RESET: 0x08,
  SET_BP: 0x09,
  DEL_BP: 0x0a,
  SET_WP: 0x0b,
  DEL_WP: 0x0c,
  EVAL: 0x0d,
  READ_REGS: 0x0e,
  READ_MEM: 0x0f,
  EXEC_CMD: 0x10,
}

/**
 * UVSOCK Response Status
 */
export const UVSOCK_STATUS = {
  OK: 0x00,
  ERROR: 0x01,
  TIMEOUT: 0x02,
  UNSUPPORTED: 0x03,
}

/**
 * Keil UVSOCK TCP protocol client.
 * Connects to UV4's socket server interface to drive simulation.
 */
export class KeilUvSockClient extends EventEmitter {
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
    this.nextSeq = 1
    /** @type {Map<number, { resolve: (res: any) => void, reject: (err: any) => void, timer: NodeJS.Timeout }>} */
    this.pendingCommands = new Map()
    this.incomingBuffer = Buffer.alloc(0)
  }

  /**
   * Connects to the UV4 socket server.
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
        fail(new Error(`UVSOCK 连接超时: ${this.host}:${this.port}`))
      }, this.timeoutMs)

      sock.on('connect', () => {
        clearTimeout(timer)
        if (settled) return
        settled = true
        this.socket = sock
        this.connected = true
        resolve()
      })

      sock.on('data', (data) => this._onData(data))
      sock.on('error', (err) => {
        this.emit('error', err)
        fail(err)
      })
      sock.on('close', () => {
        this.connected = false
        this.socket = null
        this._rejectAllPending(new Error('UVSOCK 连接已关闭'))
        this.emit('close')
      })
    })
  }

  /**
   * Sends a structured command packet over UVSOCK and awaits response.
   *
   * @param {number} opcode
   * @param {Record<string, any>} [payload]
   * @returns {Promise<any>}
   */
  async sendCommand(opcode, payload = {}) {
    if (!this.connected || !this.socket) {
      throw new Error('UVSOCK 客户端未连接')
    }

    const seq = this.nextSeq++
    const payloadStr = JSON.stringify(payload)
    const payloadBuf = Buffer.from(payloadStr, 'utf8')

    // Packet Header: [seq: 4 bytes uint32][opcode: 2 bytes uint16][payloadLen: 4 bytes uint32]
    const header = Buffer.alloc(10)
    header.writeUInt32BE(seq, 0)
    header.writeUInt16BE(opcode, 4)
    header.writeUInt32BE(payloadBuf.length, 6)

    const packet = Buffer.concat([header, payloadBuf])

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCommands.delete(seq)
        reject(new Error(`UVSOCK 指令超时 (opcode 0x${opcode.toString(16)}, seq ${seq})`))
      }, this.timeoutMs)

      this.pendingCommands.set(seq, { resolve, reject, timer })
      this.socket?.write(packet)
    })
  }

  /**
   * Internal data framing parser.
   * @param {Buffer} chunk
   */
  _onData(chunk) {
    this.incomingBuffer = Buffer.concat([this.incomingBuffer, chunk])

    while (this.incomingBuffer.length >= 10) {
      const seq = this.incomingBuffer.readUInt32BE(0)
      const opcode = this.incomingBuffer.readUInt16BE(4)
      const payloadLen = this.incomingBuffer.readUInt32BE(6)

      if (this.incomingBuffer.length < 10 + payloadLen) {
        break // Wait for more data
      }

      const payloadBuf = this.incomingBuffer.subarray(10, 10 + payloadLen)
      this.incomingBuffer = this.incomingBuffer.subarray(10 + payloadLen)

      let parsedPayload = {}
      try {
        parsedPayload = JSON.parse(payloadBuf.toString('utf8'))
      } catch {
        parsedPayload = { raw: payloadBuf.toString('utf8') }
      }

      // If seq is 0, it's an asynchronous unsolicited notification event
      if (seq === 0) {
        this.emit('event', { opcode, payload: parsedPayload })
      } else {
        const pending = this.pendingCommands.get(seq)
        if (pending) {
          clearTimeout(pending.timer)
          this.pendingCommands.delete(seq)
          pending.resolve(parsedPayload)
        }
      }
    }
  }

  /**
   * Closes the connection and cancels pending promises.
   */
  disconnect() {
    this.connected = false
    if (this.socket) {
      try {
        this.socket.destroy()
      } catch {}
      this.socket = null
    }
    this._rejectAllPending(new Error('UVSOCK 已断开连接'))
  }

  /** @param {any} err */
  _rejectAllPending(err) {
    for (const [seq, item] of this.pendingCommands.entries()) {
      clearTimeout(item.timer)
      item.reject(err)
    }
    this.pendingCommands.clear()
  }
}
