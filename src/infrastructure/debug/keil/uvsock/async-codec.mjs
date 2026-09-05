// @ts-check

import { decodeCommandResponse } from './command-response-codec.mjs'
import { UV_OPERATION } from './operation.mjs'
import { decodeSstr } from './structures/project.mjs'

/**
 * Decodes an asynchronous UVSOCK packet.
 *
 * @param {{
 *   header: {
 *     totalLen: number,
 *     cmd: number,
 *     bufLen: number,
 *     cycles: bigint,
 *     tStamp: number,
 *     id: number,
 *   },
 *   payload: Buffer,
 * }} packet
 * @returns {{
 *   type: string,
 *   cmd: number,
 *   status?: number,
 *   text?: string,
 *   details?: any,
 *   cycles?: bigint,
 *   tStamp?: number,
 * }}
 */
export function decodeAsyncMessage(packet) {
  const { header, payload } = packet

  if (header.cmd === UV_OPERATION.UV_ASYNC_MSG && payload.length >= 8) {
    const decoded = decodeCommandResponse(payload)
    return {
      type: 'async_response',
      cmd: decoded.cmd,
      status: decoded.status,
      details: decoded,
      cycles: header.cycles,
      tStamp: header.tStamp,
    }
  }

  // Handle direct asynchronous messages
  switch (header.cmd) {
    case UV_OPERATION.UV_PRJ_BUILD_OUTPUT: {
      const s = payload.length >= 4 ? decodeSstr(payload) : { str: '' }
      return {
        type: 'build_output',
        cmd: header.cmd,
        text: s.str,
        cycles: header.cycles,
        tStamp: header.tStamp,
      }
    }

    case UV_OPERATION.UV_PRJ_BUILD_COMPLETE: {
      const code = payload.length >= 4 ? payload.readUInt32LE(0) : 0
      return {
        type: 'build_complete',
        cmd: header.cmd,
        details: { code },
        cycles: header.cycles,
        tStamp: header.tStamp,
      }
    }

    case UV_OPERATION.UV_DBG_STOP_EXECUTION: {
      let reason = 'stopped'
      if (payload.length >= 4) {
        try {
          const inner = decodeCommandResponse(payload)
          reason = inner.error?.message || 'stopped'
        } catch {}
      }
      return {
        type: 'stop_execution',
        cmd: header.cmd,
        text: reason,
        cycles: header.cycles,
        tStamp: header.tStamp,
      }
    }

    default:
      return {
        type: 'raw_async',
        cmd: header.cmd,
        details: { length: payload.length },
        cycles: header.cycles,
        tStamp: header.tStamp,
      }
  }
}
