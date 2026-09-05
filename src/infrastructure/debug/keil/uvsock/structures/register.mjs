// @ts-check

import { BinaryReader } from '../binary-reader.mjs'
import { BinaryWriter } from '../binary-writer.mjs'

/**
 * Decodes REGENUM structure (53 bytes).
 *
 * @param {Buffer} buffer
 * @returns {{
 *   nGi: number,
 *   nItem: number,
 *   name: string,
 *   isPC: boolean,
 *   canChg: boolean,
 *   value: string,
 * }}
 */
export function decodeRegEnum(buffer) {
  const reader = new BinaryReader(buffer)
  const nGi = reader.readUInt16LE()
  const nItem = reader.readUInt16LE()
  const name = reader.readCString(16)
  const flags = reader.readUInt8()
  const isPC = (flags & 0x01) === 1
  const canChg = ((flags >> 1) & 0x01) === 1
  const value = reader.readCString(32)

  return {
    nGi,
    nItem,
    name,
    isPC,
    canChg,
    value,
  }
}

/**
 * Encodes REGENUM structure (53 bytes, for mock/fake server).
 *
 * @param {{
 *   nGi?: number,
 *   nItem?: number,
 *   name?: string,
 *   isPC?: boolean,
 *   canChg?: boolean,
 *   value?: string,
 * }} options
 * @returns {Buffer}
 */
export function encodeRegEnum(options = {}) {
  const writer = new BinaryWriter(53)
  writer.writeUInt16LE(options.nGi ?? 0)
  writer.writeUInt16LE(options.nItem ?? 0)
  writer.writeFixedCString(options.name || '', 16)

  let flags = 0
  if (options.isPC) flags |= 0x01
  if (options.canChg) flags |= 0x02
  writer.writeUInt8(flags)

  writer.writeFixedCString(options.value || '', 32)
  return writer.toBuffer()
}
