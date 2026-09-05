// @ts-check

import { BinaryReader } from '../binary-reader.mjs'
import { BinaryWriter } from '../binary-writer.mjs'

/**
 * Encodes PRJDATA structure.
 *
 * @param {{
 *   names: string | string[],
 *   code?: number,
 * }} options
 * @returns {Buffer}
 */
export function encodePrjData(options) {
  const names = Array.isArray(options.names) ? options.names : [options.names || '']
  const writer = new BinaryWriter()

  // Calculate combined strings buffer with null terminators
  const nameBuffers = names.map((n) => Buffer.from(n, 'utf8'))
  const totalNamesLen = nameBuffers.reduce((sum, b) => sum + b.length + 1, 0)

  writer.writeUInt32LE(totalNamesLen)
  writer.writeUInt32LE(options.code ?? 0)

  for (const b of nameBuffers) {
    writer.writeBytes(b)
    writer.writeUInt8(0)
  }

  return writer.toBuffer()
}

/**
 * Decodes PRJDATA structure.
 *
 * @param {Buffer} buffer
 * @returns {{
 *   nLen: number,
 *   nCode: number,
 *   names: string[],
 *   name: string,
 * }}
 */
export function decodePrjData(buffer) {
  const reader = new BinaryReader(buffer)
  const nLen = reader.readUInt32LE()
  const nCode = reader.readUInt32LE()

  const namesBytes = reader.readBytes(Math.min(nLen, reader.remaining))
  const names = []
  let start = 0

  for (let i = 0; i < namesBytes.length; i++) {
    if (namesBytes[i] === 0) {
      if (i > start) {
        names.push(namesBytes.subarray(start, i).toString('utf8'))
      } else {
        names.push('')
      }
      start = i + 1
    }
  }

  return {
    nLen,
    nCode,
    names,
    name: names[0] || '',
  }
}

/**
 * Encodes SSTR structure (fixed 260 bytes: 4 bytes length + 256 bytes string).
 *
 * @param {string} str
 * @returns {Buffer}
 */
export function encodeSstr(str) {
  const writer = new BinaryWriter(260)
  const strBuf = Buffer.from(str || '', 'utf8')
  const nLen = strBuf.length + 1

  writer.writeInt32LE(nLen)
  writer.writeFixedCString(str || '', 256)
  return writer.toBuffer()
}

/**
 * Decodes SSTR structure.
 *
 * @param {Buffer} buffer
 * @returns {{
 *   nLen: number,
 *   str: string,
 * }}
 */
export function decodeSstr(buffer) {
  const reader = new BinaryReader(buffer)
  const nLen = reader.readInt32LE()
  const maxChars = Math.min(256, Math.max(0, nLen - 1))
  const str = reader.readCString(256).slice(0, maxChars)

  return { nLen, str }
}
