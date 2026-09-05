// @ts-check

export const UVSC_MAGIC = 0x43535655 // 'UVSC' in ASCII Little-Endian
export const UVSC_HEADER_SIZE = 16

export const UVSC_STATUS = {
  OK: 0x0000,
  ERROR: 0x0001,
  TIMEOUT: 0x0002,
  UNSUPPORTED: 0x0003,
  BUSY: 0x0004,
  NOT_IN_DEBUG: 0x0005,
}

export const UVSC_OPCODES = {
  UV_GEN_GET_VERSION: 0x0001,
  UV_PRJ_LOAD: 0x0010,
  UV_PRJ_SET_TARGET: 0x0011,
  UV_PRJ_GET_CUR_TARGET: 0x0012,
  UV_DBG_ENTER: 0x0020,
  UV_DBG_EXIT: 0x0021,
  UV_DBG_START_EXECUTION: 0x0022,
  UV_DBG_STOP_EXECUTION: 0x0023,
  UV_DBG_STATUS: 0x0024,
  UV_DBG_RESET: 0x0025,
  UV_DBG_STEP_HLL: 0x0030,
  UV_DBG_STEP_INTO: 0x0031,
  UV_DBG_STEP_OUT: 0x0032,
  UV_DBG_CALC_EXPRESSION: 0x0040,
  UV_DBG_EVAL_EXPRESSION_TO_STR: 0x0041,
  UV_DBG_CREATE_BP: 0x0050,
  UV_DBG_CHANGE_BP: 0x0051,
  UV_DBG_ENUMERATE_BP: 0x0052,
  UV_DBG_ENUM_STACK: 0x0060,
  UV_DBG_ENUM_VARIABLES: 0x0061,
  UV_DBG_READ_REGISTERS: 0x0062,
  UV_DBG_MEM_READ: 0x0063,
  UV_DBG_EXEC_CMD: 0x0070,
  UV_CMD_RESPONSE: 0x8000,
  UV_ASYNC_MSG: 0x8001,
  UV_DBG_CALLBACK: 0x8002,
  UV_DBG_CMD_OUTPUT: 0x8003,
}

/**
 * Encodes a binary UVSC packet.
 *
 * @param {{
 *   msgId: number,
 *   opcode: number,
 *   status?: number,
 *   payload?: Buffer | Uint8Array | string | Record<string, any>,
 * }} frame
 * @returns {Buffer}
 */
export function encodeFrame(frame) {
  let payloadBuf = Buffer.alloc(0)
  if (frame.payload != null) {
    if (Buffer.isBuffer(frame.payload)) {
      payloadBuf = frame.payload
    } else if (frame.payload instanceof Uint8Array) {
      payloadBuf = Buffer.from(frame.payload)
    } else if (typeof frame.payload === 'string') {
      payloadBuf = Buffer.from(frame.payload, 'utf8')
    } else {
      payloadBuf = Buffer.from(JSON.stringify(frame.payload), 'utf8')
    }
  }

  const totalLength = UVSC_HEADER_SIZE + payloadBuf.length
  const header = Buffer.alloc(UVSC_HEADER_SIZE)
  header.writeUInt32LE(UVSC_MAGIC, 0)
  header.writeUInt32LE(totalLength, 4)
  header.writeUInt32LE(frame.msgId >>> 0, 8)
  header.writeUInt16LE(frame.opcode & 0xffff, 12)
  header.writeUInt16LE((frame.status ?? UVSC_STATUS.OK) & 0xffff, 14)

  return Buffer.concat([header, payloadBuf])
}

/**
 * Parses zero or more complete UVSC frames from an incoming buffer.
 *
 * @param {Buffer} buffer
 * @returns {{
 *   frames: Array<{
 *     magic: number,
 *     length: number,
 *     msgId: number,
 *     opcode: number,
 *     status: number,
 *     payload: Buffer,
 *   }>,
 *   rest: Buffer,
 * }}
 */
export function decodeFrames(buffer) {
  const frames = []
  let cursor = 0

  while (buffer.length - cursor >= UVSC_HEADER_SIZE) {
    const magic = buffer.readUInt32LE(cursor)
    if (magic !== UVSC_MAGIC) {
      cursor += 1
      continue
    }

    const totalLength = buffer.readUInt32LE(cursor + 4)
    if (totalLength < UVSC_HEADER_SIZE || totalLength > 64 * 1024 * 1024) {
      cursor += 4
      continue
    }

    if (buffer.length - cursor < totalLength) {
      break
    }

    const msgId = buffer.readUInt32LE(cursor + 8)
    const opcode = buffer.readUInt16LE(cursor + 12)
    const status = buffer.readUInt16LE(cursor + 14)
    const payload = buffer.subarray(cursor + UVSC_HEADER_SIZE, cursor + totalLength)

    frames.push({
      magic,
      length: totalLength,
      msgId,
      opcode,
      status,
      payload: Buffer.from(payload),
    })

    cursor += totalLength
  }

  return {
    frames,
    rest: buffer.subarray(cursor),
  }
}
