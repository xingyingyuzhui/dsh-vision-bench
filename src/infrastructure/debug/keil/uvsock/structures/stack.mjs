// @ts-check

import { BinaryReader } from '../binary-reader.mjs'
import { BinaryWriter } from '../binary-writer.mjs'

/**
 * Encodes iSTKENUM request structure (32 bytes).
 *
 * @param {{
 *   bExtended?: boolean,
 *   bModified?: boolean,
 *   nTask?: number,
 * }} [options]
 * @returns {Buffer}
 */
export function encodeIstkEnum(options = {}) {
  const writer = new BinaryWriter(32)
  let flags = 0
  if (options.bExtended) flags |= 1 << 1
  if (options.bModified) flags |= 1 << 2

  writer.writeUInt32LE(flags)
  writer.writeUInt32LE(options.nTask ?? 0)
  writer.writeZeroes(24) // nRes[6]

  return writer.toBuffer()
}

/**
 * Decodes STACKENUM structure (48 bytes).
 *
 * @param {Buffer} buffer
 * @returns {{
 *   nItem: number,
 *   nAdr: bigint,
 *   nRetAdr: bigint,
 *   nVars: number,
 *   nEqual: number,
 *   nTotal: number,
 *   nTask: number,
 * }}
 */
export function decodeStackEnum(buffer) {
  const reader = new BinaryReader(buffer)
  const nItem = reader.readUInt32LE()
  const nAdr = reader.readBigUInt64LE()
  const nRetAdr = reader.readBigUInt64LE()
  const nVars = reader.readUInt32LE()
  const nEqual = reader.readUInt32LE()
  const nTotal = reader.readUInt32LE()
  const nTask = reader.readUInt32LE()
  reader.readBytes(12) // nRes[3]

  return {
    nItem,
    nAdr,
    nRetAdr,
    nVars,
    nEqual,
    nTotal,
    nTask,
  }
}

/**
 * Encodes STACKENUM structure (48 bytes, for mock/fake server).
 *
 * @param {{
 *   nItem?: number,
 *   nAdr?: bigint | number,
 *   nRetAdr?: bigint | number,
 *   nVars?: number,
 *   nEqual?: number,
 *   nTotal?: number,
 *   nTask?: number,
 * }} options
 * @returns {Buffer}
 */
export function encodeStackEnum(options = {}) {
  const writer = new BinaryWriter(48)
  writer.writeUInt32LE(options.nItem ?? 0)
  writer.writeBigUInt64LE(BigInt(options.nAdr ?? 0n))
  writer.writeBigUInt64LE(BigInt(options.nRetAdr ?? 0n))
  writer.writeUInt32LE(options.nVars ?? 0)
  writer.writeUInt32LE(options.nEqual ?? 0)
  writer.writeUInt32LE(options.nTotal ?? 0)
  writer.writeUInt32LE(options.nTask ?? 0)
  writer.writeZeroes(12)
  return writer.toBuffer()
}
