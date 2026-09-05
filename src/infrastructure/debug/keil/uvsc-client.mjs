// @ts-check

import { EventEmitter } from 'node:events'
import { createConnection } from 'node:net'
import { UVSC_OPCODES, UVSC_STATUS, decodeFrames, encodeFrame } from './uvsc-framing.mjs'

export { UVSC_OPCODES, UVSC_STATUS }

/**
 * Keil UVSC binary protocol client.
 * Connects to UV4 socket server interface using binary UVSC message framing.
 */
export class KeilUvscClient extends EventEmitter {
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
    this.nextMsgId = 1
    /** @type {Map<number, { resolve: (res: any) => void, reject: (err: any) => void, timer: NodeJS.Timeout }>} */
    this.pendingRequests = new Map()
    this.incomingBuffer = Buffer.alloc(0)
  }

  /**
   * Connects to the UV4 UVSC socket server.
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
        fail(new Error(`UVSC 连接超时: ${this.host}:${this.port}`))
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
        this.emit('error', err)
        fail(err)
      })

      sock.on('close', () => {
        this.connected = false
        this.socket = null
        this._rejectAllPending(new Error('UVSC 连接已关闭'))
        this.emit('close')
      })
    })
  }

  /**
   * Sends a binary request frame over UVSC and awaits the matching response.
   *
   * @param {number} opcode
   * @param {Buffer | string | Record<string, any>} [payload]
   * @param {{ timeoutMs?: number }} [opts]
   * @returns {Promise<any>}
   */
  async sendRequest(opcode, payload = Buffer.alloc(0), opts = {}) {
    if (!this.connected || !this.socket) {
      throw new Error('UVSC 客户端未连接')
    }

    const msgId = this.nextMsgId++
    const timeout = opts.timeoutMs || this.timeoutMs

    const packet = encodeFrame({
      msgId,
      opcode,
      status: UVSC_STATUS.OK,
      payload,
    })

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(msgId)
        reject(new Error(`UVSC 指令超时 (opcode 0x${opcode.toString(16)}, msgId ${msgId})`))
      }, timeout)

      this.pendingRequests.set(msgId, { resolve, reject, timer })
      this.socket?.write(packet)
    })
  }

  /**
   * Alias for sendRequest for backwards compatibility.
   * @param {number} opcode
   * @param {any} [payload]
   */
  async sendCommand(opcode, payload) {
    return this.sendRequest(opcode, payload)
  }

  /**
   * Processes incoming TCP data chunks through the UVSC frame decoder.
   * @param {Buffer} chunk
   */
  _onData(chunk) {
    this.incomingBuffer = Buffer.concat([this.incomingBuffer, chunk])
    const { frames, rest } = decodeFrames(this.incomingBuffer)
    this.incomingBuffer = rest

    for (const frame of frames) {
      let parsedPayload = null
      const str = frame.payload.toString('utf8')
      try {
        parsedPayload = JSON.parse(str)
      } catch {
        parsedPayload = { raw: str, bytes: Array.from(frame.payload) }
      }

      const isAsync =
        frame.msgId === 0 ||
        frame.opcode === UVSC_OPCODES.UV_ASYNC_MSG ||
        frame.opcode === UVSC_OPCODES.UV_DBG_CALLBACK ||
        frame.opcode === UVSC_OPCODES.UV_DBG_CMD_OUTPUT

      if (isAsync) {
        this.emit('event', {
          opcode: frame.opcode,
          status: frame.status,
          msgId: frame.msgId,
          payload: parsedPayload,
          rawPayload: frame.payload,
        })
      } else {
        const pending = this.pendingRequests.get(frame.msgId)
        if (pending) {
          clearTimeout(pending.timer)
          this.pendingRequests.delete(frame.msgId)

          if (frame.status !== UVSC_STATUS.OK) {
            const errRes = {
              status: frame.status,
              opcode: frame.opcode,
              error: `UVSC 指令失败: status ${frame.status}`,
              details: parsedPayload,
            }
            pending.resolve(errRes)
          } else {
            pending.resolve({
              status: UVSC_STATUS.OK,
              opcode: frame.opcode,
              ...(typeof parsedPayload === 'object' && parsedPayload !== null
                ? parsedPayload
                : { value: parsedPayload }),
            })
          }
        }
      }
    }
  }

  /**
   * Closes connection and cleans up.
   */
  disconnect() {
    this.connected = false
    if (this.socket) {
      try {
        this.socket.destroy()
      } catch {}
      this.socket = null
    }
    this._rejectAllPending(new Error('UVSC 已断开连接'))
  }

  /**
   * @param {any} err
   */
  _rejectAllPending(err) {
    for (const [msgId, item] of this.pendingRequests.entries()) {
      clearTimeout(item.timer)
      item.reject(err)
    }
    this.pendingRequests.clear()
  }
}
