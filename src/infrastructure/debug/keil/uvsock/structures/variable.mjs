// @ts-check

import { BinaryReader } from '../binary-reader.mjs'
import { BinaryWriter } from '../binary-writer.mjs'
import { decodeSstr, encodeSstr } from './project.mjs'

/**
 * Encodes IVARENUM request structure (16 bytes).
 *
 * @param {{
 *   nID?: number,
 *   nFrame?: number,
 *   nTask?: number,
 *   count?: number,
 *   bChanged?: boolean,
 * }} [options]
 * @returns {Buffer}
 */
export function encodeIvarEnum(options = {}) {
  const writer = new BinaryWriter(16)
  writer.writeInt32LE(options.nID ?? 0)
  writer.writeInt32LE(options.nFrame ?? 0)
  writer.writeInt32LE(options.nTask ?? 0)

  let flags = ((options.count ?? 100) & 0xffff) >>> 0
  if (options.bChanged) {
    flags |= 1 << 16
  }
  writer.writeUInt32LE(flags)

  return writer.toBuffer()
}

/**
 * Decodes VARINFO structure (1060 bytes).
 *
 * @param {Buffer} buffer
 * @returns {{
 *   nID: number,
 *   index: number,
 *   count: number,
 *   typeSize: number,
 *   flags: number,
 *   value: string,
 *   type: string,
 *   name: string,
 *   qualifiedName: string,
 * }}
 */
export function decodeVarInfo(buffer) {
  const reader = new BinaryReader(buffer)
  const nID = reader.readInt32LE()
  const index = reader.readInt32LE()
  const count = reader.readInt32LE()
  const typeSize = reader.readInt32LE()
  const flags = reader.readUInt32LE()

  const valueBuf = reader.readBytes(260)
  const typeBuf = reader.readBytes(260)
  const nameBuf = reader.readBytes(260)
  const qNameBuf = reader.readBytes(260)

  return {
    nID,
    index,
    count,
    typeSize,
    flags,
    value: decodeSstr(valueBuf).str,
    type: decodeSstr(typeBuf).str,
    name: decodeSstr(nameBuf).str,
    qualifiedName: decodeSstr(qNameBuf).str,
  }
}

/**
 * Encodes VARINFO structure (1060 bytes, for mock/fake server).
 *
 * @param {{
 *   nID?: number,
 *   index?: number,
 *   count?: number,
 *   typeSize?: number,
 *   flags?: number,
 *   value?: string,
 *   type?: string,
 *   name?: string,
 *   qualifiedName?: string,
 * }} options
 * @returns {Buffer}
 */
export function encodeVarInfo(options = {}) {
  const writer = new BinaryWriter(1060)
  writer.writeInt32LE(options.nID ?? 1)
  writer.writeInt32LE(options.index ?? 0)
  writer.writeInt32LE(options.count ?? 0)
  writer.writeInt32LE(options.typeSize ?? 4)
  writer.writeUInt32LE(options.flags ?? 0)

  writer.writeBytes(encodeSstr(options.value || ''))
  writer.writeBytes(encodeSstr(options.type || 'int'))
  writer.writeBytes(encodeSstr(options.name || ''))
  writer.writeBytes(encodeSstr(options.qualifiedName || options.name || ''))

  return writer.toBuffer()
}
