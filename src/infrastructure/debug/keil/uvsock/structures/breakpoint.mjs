// @ts-check

import { BinaryReader } from '../binary-reader.mjs'
import { BinaryWriter } from '../binary-writer.mjs'

export const BKTYPE = {
  BRKTYPE_EXEC: 1,
  BRKTYPE_READ: 2,
  BRKTYPE_WRITE: 3,
  BRKTYPE_READWRITE: 4,
  BRKTYPE_COMPLEX: 5,
}

export const CHG_TYPE = {
  CHG_KILLBP: 1,
  CHG_ENABLEBP: 2,
  CHG_DISABLEBP: 3,
}

/**
 * Encodes BKPARM structure.
 *
 * @param {{
 *   type?: number,
 *   count?: number,
 *   accSize?: number,
 *   expression?: string,
 *   command?: string,
 * }} options
 * @returns {Buffer}
 */
export function encodeBkParm(options = {}) {
  const writer = new BinaryWriter(1044)
  const type = options.type ?? BKTYPE.BRKTYPE_EXEC
  const count = options.count ?? 1
  const accSize = options.accSize ?? 0
  const expression = options.expression || ''
  const command = options.command || ''

  const exprBuf = Buffer.from(expression, 'utf8')
  const cmdBuf = Buffer.from(command, 'utf8')

  const nExpLen = exprBuf.length > 0 ? exprBuf.length + 1 : 0
  const nCmdLen = cmdBuf.length > 0 ? cmdBuf.length + 1 : 0

  writer.writeUInt32LE(type)
  writer.writeUInt32LE(count)
  writer.writeUInt32LE(accSize)
  writer.writeUInt32LE(nExpLen)
  writer.writeUInt32LE(nCmdLen)

  // 1024 bytes buffer for strings
  const strBuf = Buffer.alloc(1024)
  let offset = 0
  if (nExpLen > 0) {
    exprBuf.copy(strBuf, offset)
    offset += exprBuf.length
    strBuf[offset++] = 0
  }
  if (nCmdLen > 0) {
    cmdBuf.copy(strBuf, offset)
    offset += cmdBuf.length
    strBuf[offset++] = 0
  }

  writer.writeBytes(strBuf)
  return writer.toBuffer()
}

/**
 * Decodes BKPARM structure.
 * @param {Buffer} buffer
 */
export function decodeBkParm(buffer) {
  const reader = new BinaryReader(buffer)
  const type = reader.readUInt32LE()
  const count = reader.readUInt32LE()
  const accSize = reader.readUInt32LE()
  const nExpLen = reader.readUInt32LE()
  const nCmdLen = reader.readUInt32LE()

  const szBuffer = reader.readBytes(1024)
  let expression = ''
  let command = ''

  if (nExpLen > 1) {
    expression = szBuffer.subarray(0, nExpLen - 1).toString('utf8')
  }
  if (nCmdLen > 1) {
    const cmdStart = nExpLen
    command = szBuffer.subarray(cmdStart, cmdStart + nCmdLen - 1).toString('utf8')
  }

  return { type, count, accSize, nExpLen, nCmdLen, expression, command }
}

/**
 * Encodes BKCHG structure (40 bytes).
 *
 * @param {{
 *   type?: number,
 *   nTickMark?: number,
 * }} options
 * @returns {Buffer}
 */
export function encodeBkChg(options = {}) {
  const writer = new BinaryWriter(40)
  writer.writeUInt32LE(options.type ?? CHG_TYPE.CHG_KILLBP)
  writer.writeUInt32LE(options.nTickMark ?? 0)
  writer.writeZeroes(32) // nRes[8]
  return writer.toBuffer()
}

/**
 * Decodes BKCHG structure.
 * @param {Buffer} buffer
 */
export function decodeBkChg(buffer) {
  const reader = new BinaryReader(buffer)
  const type = reader.readUInt32LE()
  const nTickMark = reader.readUInt32LE()
  reader.readBytes(32)
  return { type, nTickMark }
}

/**
 * Decodes BKRSP structure (540 bytes).
 *
 * @param {Buffer} buffer
 * @returns {{
 *   type: number,
 *   count: number,
 *   enabled: boolean,
 *   nTickMark: number,
 *   nAddress: bigint,
 *   nExpLen: number,
 *   expression: string,
 * }}
 */
export function decodeBkRsp(buffer) {
  const reader = new BinaryReader(buffer)
  const type = reader.readUInt32LE()
  const count = reader.readUInt32LE()
  const enabledVal = reader.readUInt32LE()
  const nTickMark = reader.readUInt32LE()
  const nAddress = reader.readBigUInt64LE()
  const nExpLen = reader.readUInt32LE()
  const expression = reader.readCString(512)

  return {
    type,
    count,
    enabled: enabledVal === 1,
    nTickMark,
    nAddress,
    nExpLen,
    expression,
  }
}

/**
 * Encodes BKRSP structure (for mock/fake server use).
 *
 * @param {{
 *   type?: number,
 *   count?: number,
 *   enabled?: boolean,
 *   nTickMark?: number,
 *   nAddress?: bigint | number,
 *   expression?: string,
 * }} options
 * @returns {Buffer}
 */
export function encodeBkRsp(options = {}) {
  const writer = new BinaryWriter(540)
  writer.writeUInt32LE(options.type ?? BKTYPE.BRKTYPE_EXEC)
  writer.writeUInt32LE(options.count ?? 1)
  writer.writeUInt32LE(options.enabled ? 1 : 0)
  writer.writeUInt32LE(options.nTickMark ?? 0)
  writer.writeBigUInt64LE(BigInt(options.nAddress ?? 0n))

  const expr = options.expression || ''
  const exprBuf = Buffer.from(expr, 'utf8')
  writer.writeUInt32LE(exprBuf.length > 0 ? exprBuf.length + 1 : 0)
  writer.writeFixedCString(expr, 512)

  return writer.toBuffer()
}
