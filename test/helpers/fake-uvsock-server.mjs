// @ts-check

import { createServer } from 'node:net'
import {
  PacketAccumulator,
  UV_OPERATION,
  UV_STATUS,
  encodeAmem,
  encodeBkRsp,
  encodeCommandResponse,
  encodePacket,
  encodeSstr,
  encodeVset,
} from '../../src/infrastructure/debug/keil/uvsock/index.mjs'

/**
 * Fake ARM Keil UVSOCK TCP Server for unit and integration testing.
 */
export class FakeUvSockServer {
  /**
   * @param {{ port?: number }} [options]
   */
  constructor(options = {}) {
    this.port = options.port || 0
    this.host = '127.0.0.1'

    /** @type {import('node:net').Server | null} */
    this.server = null
    /** @type {Set<import('node:net').Socket>} */
    this.sockets = new Set()
    /** @type {Array<{ cmd: number, payload: Buffer }>} */
    this.receivedCommands = []
  }

  /**
   * Starts listening.
   * @returns {Promise<{ port: number, host: string }>}
   */
  async start() {
    return new Promise((resolve, reject) => {
      const srv = createServer((sock) => {
        this.sockets.add(sock)
        const acc = new PacketAccumulator()

        sock.on('data', (chunk) => {
          const packets = acc.feed(chunk)
          for (const packet of packets) {
            this.receivedCommands.push({
              cmd: packet.header.cmd,
              payload: packet.payload,
            })
            this._handleClientCommand(sock, packet)
          }
        })

        sock.on('close', () => {
          this.sockets.delete(sock)
        })

        sock.on('error', () => {
          this.sockets.delete(sock)
        })
      })

      srv.listen(this.port, this.host, () => {
        const addr = srv.address()
        if (addr && typeof addr === 'object') {
          this.port = addr.port
        }
        this.server = srv
        resolve({ port: this.port, host: this.host })
      })

      srv.on('error', reject)
    })
  }

  /**
   * Stops the server.
   */
  async stop() {
    for (const sock of this.sockets) {
      try {
        sock.destroy()
      } catch {}
    }
    this.sockets.clear()

    if (this.server) {
      await new Promise((resolve) => this.server?.close(() => resolve(undefined)))
      this.server = null
    }
  }

  /**
   * Sends an async message to all connected clients.
   * @param {number} cmd
   * @param {Buffer} [payload]
   */
  broadcastAsync(cmd, payload = Buffer.alloc(0)) {
    const packet = encodePacket({ cmd, payload })
    for (const sock of this.sockets) {
      try {
        sock.write(packet)
      } catch {}
    }
  }

  /**
   * Sends an async stop event (breakpoint/watchpoint).
   * @param {string} [reason='watchpoint-hit']
   */
  sendAsyncStop(reason = 'watchpoint-hit') {
    const respPayload = encodeCommandResponse({
      cmd: UV_OPERATION.UV_DBG_STOP_EXECUTION,
      status: UV_STATUS.UV_STATUS_TARGET_STOPPED,
      errorMessage: reason,
    })
    const packet = encodePacket({
      cmd: UV_OPERATION.UV_ASYNC_MSG,
      payload: respPayload,
    })
    for (const sock of this.sockets) {
      try {
        sock.write(packet)
      } catch {}
    }
  }

  /**
   * Handles incoming client commands and generates matching UV_CMD_RESPONSE packets.
   * @param {import('node:net').Socket} sock
   * @param {{ header: any, payload: Buffer }} packet
   */
  _handleClientCommand(sock, packet) {
    const cmd = packet.header.cmd
    let respData = Buffer.alloc(0)

    switch (cmd) {
      case UV_OPERATION.UV_GEN_GET_VERSION: {
        const valBuf = Buffer.alloc(4)
        valBuf.writeUInt32LE(0x020c, 0) // Version 2.12
        respData = encodeCommandResponse({ cmd, status: UV_STATUS.UV_STATUS_SUCCESS, payloadBuffer: valBuf })
        break
      }

      case UV_OPERATION.UV_PRJ_LOAD:
      case UV_OPERATION.UV_PRJ_SET_TARGET:
      case UV_OPERATION.UV_DBG_ENTER:
      case UV_OPERATION.UV_DBG_EXIT:
      case UV_OPERATION.UV_DBG_START_EXECUTION:
      case UV_OPERATION.UV_DBG_STOP_EXECUTION:
      case UV_OPERATION.UV_DBG_RESET:
      case UV_OPERATION.UV_DBG_STEP_HLL:
      case UV_OPERATION.UV_DBG_STEP_INTO:
      case UV_OPERATION.UV_DBG_STEP_OUT:
      case UV_OPERATION.UV_DBG_CHANGE_BP:
      case UV_OPERATION.UV_DBG_EXEC_CMD:
      case UV_OPERATION.UV_GEN_EXIT:
        respData = encodeCommandResponse({ cmd, status: UV_STATUS.UV_STATUS_SUCCESS })
        break

      case UV_OPERATION.UV_DBG_STATUS: {
        const valBuf = Buffer.alloc(4)
        valBuf.writeUInt32LE(0, 0) // Stopped
        respData = encodeCommandResponse({ cmd, status: UV_STATUS.UV_STATUS_SUCCESS, payloadBuffer: valBuf })
        break
      }

      case UV_OPERATION.UV_PRJ_GET_CUR_TARGET: {
        const sstr = encodeSstr('Target 1')
        respData = encodeCommandResponse({ cmd, status: UV_STATUS.UV_STATUS_SUCCESS, payloadBuffer: sstr })
        break
      }

      case UV_OPERATION.UV_DBG_CALC_EXPRESSION: {
        const vset = encodeVset({ str: 'result', value: 42 })
        respData = encodeCommandResponse({ cmd, status: UV_STATUS.UV_STATUS_SUCCESS, payloadBuffer: vset })
        break
      }

      case UV_OPERATION.UV_DBG_CREATE_BP: {
        const bkrsp = encodeBkRsp({ nTickMark: 101, enabled: true })
        respData = encodeCommandResponse({ cmd, status: UV_STATUS.UV_STATUS_SUCCESS, payloadBuffer: bkrsp })
        break
      }

      case UV_OPERATION.UV_DBG_MEM_READ: {
        const mem = encodeAmem({ address: 0x20000000n, bytes: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]) })
        respData = encodeCommandResponse({ cmd, status: UV_STATUS.UV_STATUS_SUCCESS, payloadBuffer: mem })
        break
      }

      default:
        respData = encodeCommandResponse({ cmd, status: UV_STATUS.UV_STATUS_SUCCESS })
        break
    }

    const respPacket = encodePacket({
      cmd: UV_OPERATION.UV_CMD_RESPONSE,
      payload: respData,
    })

    try {
      sock.write(respPacket)
    } catch {}
  }
}
