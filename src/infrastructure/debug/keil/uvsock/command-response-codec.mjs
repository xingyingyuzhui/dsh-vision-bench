// @ts-check

import { BinaryReader } from './binary-reader.mjs'
import { BinaryWriter } from './binary-writer.mjs'
import { UV_OPERATION } from './operation.mjs'
import { UV_STATUS, statusToString } from './status.mjs'
import { decodeBkRsp, encodeBkRsp } from './structures/breakpoint.mjs'
import { decodeVset, encodeVset } from './structures/expression.mjs'
import { decodeAmem, encodeAmem } from './structures/memory.mjs'
import { decodeSstr, encodeSstr } from './structures/project.mjs'
import { decodeRegEnum, encodeRegEnum } from './structures/register.mjs'
import { decodeStackEnum, encodeStackEnum } from './structures/stack.mjs'
import { decodeVarInfo, encodeVarInfo } from './structures/variable.mjs'

/**
 * Encodes an official UVSOCK_CMD_RESPONSE payload.
 *
 * @param {{
 *   cmd: number,
 *   status?: number,
 *   payloadBuffer?: Buffer,
 *   errorMessage?: string,
 * }} options
 * @returns {Buffer}
 */
export function encodeCommandResponse(options) {
  const writer = new BinaryWriter()
  const status = options.status ?? UV_STATUS.UV_STATUS_SUCCESS
  writer.writeUInt32LE(options.cmd >>> 0)
  writer.writeUInt32LE(status >>> 0)

  if (status !== UV_STATUS.UV_STATUS_SUCCESS) {
    // Encode UVSOCK_ERROR_RESPONSE
    const msg = options.errorMessage || statusToString(status)
    const msgBuf = Buffer.from(msg, 'utf8')
    const strLen = msgBuf.length + 1
    writer.writeUInt32LE(0) // nRes1
    writer.writeUInt32LE(0) // nRes2
    writer.writeUInt32LE(strLen) // StrLen
    writer.writeBytes(msgBuf)
    writer.writeUInt8(0)
  } else if (options.payloadBuffer && options.payloadBuffer.length > 0) {
    writer.writeBytes(options.payloadBuffer)
  }

  return writer.toBuffer()
}

/**
 * Decodes an official UVSOCK_CMD_RESPONSE payload (from UV_CMD_RESPONSE or UV_ASYNC_MSG).
 *
 * @param {Buffer} buffer
 * @returns {{
 *   cmd: number,
 *   status: number,
 *   ok: boolean,
 *   statusText: string,
 *   value?: number,
 *   string?: string,
 *   memory?: ReturnType<typeof decodeAmem>,
 *   expression?: ReturnType<typeof decodeVset>,
 *   breakpoint?: ReturnType<typeof decodeBkRsp>,
 *   stack?: ReturnType<typeof decodeStackEnum>,
 *   register?: ReturnType<typeof decodeRegEnum>,
 *   variable?: ReturnType<typeof decodeVarInfo>,
 *   cycles?: bigint,
 *   tStamp?: number,
 *   error?: { nRes1: number, nRes2: number, message: string },
 *   raw?: Buffer,
 * }}
 */
export function decodeCommandResponse(buffer) {
  if (buffer.length < 8) {
    throw new RangeError(`decodeCommandResponse: buffer too short (${buffer.length} < 8)`)
  }

  const reader = new BinaryReader(buffer)
  const cmd = reader.readUInt32LE()
  const status = reader.readUInt32LE()
  const ok = status === UV_STATUS.UV_STATUS_SUCCESS
  const statusText = statusToString(status)

  if (!ok) {
    let message = statusText
    let nRes1 = 0
    let nRes2 = 0
    if (reader.remaining >= 12) {
      nRes1 = reader.readUInt32LE()
      nRes2 = reader.readUInt32LE()
      const strLen = reader.readUInt32LE()
      if (strLen > 0 && reader.remaining > 0) {
        message = reader.readCString(strLen) || message
      }
    }
    return {
      cmd,
      status,
      ok: false,
      statusText,
      error: { nRes1, nRes2, message },
    }
  }

  const dataSlice = buffer.subarray(8)

  // Disambiguate based on responding cmd
  switch (cmd) {
    case UV_OPERATION.UV_GEN_GET_VERSION:
    case UV_OPERATION.UV_DBG_STATUS:
    case UV_OPERATION.UV_PRJ_ACTIVE_FILES: {
      const val = dataSlice.length >= 4 ? dataSlice.readUInt32LE(0) : 0
      return { cmd, status, ok: true, statusText, value: val }
    }

    case UV_OPERATION.UV_PRJ_GET_CUR_TARGET:
    case UV_OPERATION.UV_PRJ_GET_OUTPUTNAME:
    case UV_OPERATION.UV_PRJ_SET_OUTPUTNAME:
    case UV_OPERATION.UV_DBG_CMD_OUTPUT:
    case UV_OPERATION.UV_PRJ_ENUM_GROUPS_ENU:
    case UV_OPERATION.UV_PRJ_ENUM_FILES_ENU:
    case UV_OPERATION.UV_PRJ_ENUM_TARGETS_ENU: {
      if (dataSlice.length >= 4) {
        const s = decodeSstr(dataSlice)
        return { cmd, status, ok: true, statusText, string: s.str }
      }
      return { cmd, status, ok: true, statusText, string: '' }
    }

    case UV_OPERATION.UV_DBG_MEM_READ:
    case UV_OPERATION.UV_DBG_MEM_WRITE:
    case UV_OPERATION.UV_DBG_DSM_READ: {
      if (dataSlice.length >= 24) {
        const mem = decodeAmem(dataSlice)
        return { cmd, status, ok: true, statusText, memory: mem }
      }
      break
    }

    case UV_OPERATION.UV_DBG_CALC_EXPRESSION:
    case UV_OPERATION.UV_DBG_VTR_GET: {
      if (dataSlice.length >= 12) {
        const expr = decodeVset(dataSlice)
        return { cmd, status, ok: true, statusText, expression: expr }
      }
      break
    }

    case UV_OPERATION.UV_DBG_CREATE_BP:
    case UV_OPERATION.UV_DBG_CHANGE_BP:
    case UV_OPERATION.UV_DBG_BP_ENUMERATED: {
      if (dataSlice.length >= 28) {
        const bp = decodeBkRsp(dataSlice)
        return { cmd, status, ok: true, statusText, breakpoint: bp }
      }
      break
    }

    case UV_OPERATION.UV_DBG_ENUM_STACK_ENU: {
      if (dataSlice.length >= 36) {
        const stk = decodeStackEnum(dataSlice)
        return { cmd, status, ok: true, statusText, stack: stk }
      }
      break
    }

    case UV_OPERATION.UV_DBG_ENUM_REGISTERS_ENU: {
      if (dataSlice.length >= 20) {
        const reg = decodeRegEnum(dataSlice)
        return { cmd, status, ok: true, statusText, register: reg }
      }
      break
    }

    case UV_OPERATION.UV_DBG_ENUM_VARIABLES_ENU:
    case UV_OPERATION.UV_DBG_EVAL_WATCH_EXPRESSION: {
      if (dataSlice.length >= 20) {
        const v = decodeVarInfo(dataSlice)
        return { cmd, status, ok: true, statusText, variable: v }
      }
      break
    }

    case UV_OPERATION.UV_DBG_TIME_INFO: {
      if (dataSlice.length >= 16) {
        const cycles = dataSlice.readBigUInt64LE(0)
        const tStamp = dataSlice.readDoubleLE(8)
        return { cmd, status, ok: true, statusText, cycles, tStamp }
      }
      break
    }

    default:
      break
  }

  return {
    cmd,
    status,
    ok: true,
    statusText,
    raw: Buffer.from(dataSlice),
  }
}
