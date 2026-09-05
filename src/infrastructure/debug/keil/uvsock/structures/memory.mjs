// @ts-check

import { BinaryReader } from '../binary-reader.mjs'
import { BinaryWriter } from '../binary-writer.mjs'

/**
 * Encodes AMEM structure.
 *
 * @param {{
 *   address: bigint | number | string,
 *   bytes?: Buffer | Uint8Array | number[],
 *   nBytes?: number,
 *   errAddr?: bigint | number,
 *   nErr?: number,
 * }} options
 * @returns {Buffer}
 */
export function encodeAmem(options) {
  const bytesBuf = options.bytes
    ? Buffer.isBuffer(options.bytes)
      ? options.bytes
      : Buffer.from(options.bytes)
    : Buffer.alloc(0)

  const nBytes = options.nBytes !== undefined ? options.nBytes : bytesBuf.length
  const writer = new BinaryWriter(24 + bytesBuf.length)

  writer.writeBigUInt64LE(BigInt(options.address ?? 0n))
  writer.writeUInt32LE(nBytes)
  writer.writeBigUInt64LE(BigInt(options.errAddr ?? 0n))
  writer.writeUInt32LE(options.nErr ?? 0)

  if (bytesBuf.length > 0) {
    writer.writeBytes(bytesBuf)
  }

  return writer.toBuffer()
}

/**
 * Decodes AMEM structure.
 *
 * @param {Buffer} buffer
 * @returns {{
 *   nAddr: bigint,
 *   nBytes: number,
 *   errAddr: bigint,
 *   nErr: number,
 *   bytes: Buffer,
 *   hex: string,
 * }}
 */
export function decodeAmem(buffer) {
  const reader = new BinaryReader(buffer)
  const nAddr = reader.readBigUInt64LE()
  const nBytes = reader.readUInt32LE()
  const errAddr = reader.readBigUInt64LE()
  const nErr = reader.readUInt32LE()

  const available = Math.min(nBytes, reader.remaining)
  const bytes = reader.readBytes(available)
  const hex = bytes.toString('hex')

  return {
    nAddr,
    nBytes,
    errAddr,
    nErr,
    bytes,
    hex,
  }
}
