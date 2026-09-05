// @ts-check

import { BinaryReader } from '../binary-reader.mjs'
import { BinaryWriter } from '../binary-writer.mjs'
import { decodeSstr, encodeSstr } from './project.mjs'

export const VTT_TYPE = {
  VTT_void: 0,
  VTT_bit: 1,
  VTT_char: 2,
  VTT_uchar: 3,
  VTT_int: 4,
  VTT_uint: 5,
  VTT_short: 6,
  VTT_ushort: 7,
  VTT_long: 8,
  VTT_ulong: 9,
  VTT_float: 10,
  VTT_double: 11,
  VTT_ptr: 12,
  VTT_union: 13,
  VTT_struct: 14,
  VTT_func: 15,
  VTT_string: 16,
  VTT_enum: 17,
  VTT_field: 18,
  VTT_int64: 19,
  VTT_uint64: 20,
}

/**
 * Encodes TVAL structure (12 bytes: 4 bytes type + 8 bytes value union).
 *
 * @param {{
 *   type?: number,
 *   value?: any,
 * }} options
 * @returns {Buffer}
 */
export function encodeTval(options = {}) {
  const writer = new BinaryWriter(12)
  const type = options.type ?? VTT_TYPE.VTT_int
  const val = options.value ?? 0

  writer.writeUInt32LE(type)

  const uWriter = new BinaryWriter(8)
  switch (type) {
    case VTT_TYPE.VTT_char:
      uWriter.writeInt8(Number(val))
      uWriter.writeZeroes(7)
      break
    case VTT_TYPE.VTT_uchar:
    case VTT_TYPE.VTT_bit:
      uWriter.writeUInt8(Number(val))
      uWriter.writeZeroes(7)
      break
    case VTT_TYPE.VTT_short:
      uWriter.writeInt16LE(Number(val))
      uWriter.writeZeroes(6)
      break
    case VTT_TYPE.VTT_ushort:
      uWriter.writeUInt16LE(Number(val))
      uWriter.writeZeroes(6)
      break
    case VTT_TYPE.VTT_int:
    case VTT_TYPE.VTT_long:
      uWriter.writeInt32LE(Number(val))
      uWriter.writeZeroes(4)
      break
    case VTT_TYPE.VTT_uint:
    case VTT_TYPE.VTT_ulong:
    case VTT_TYPE.VTT_ptr:
      uWriter.writeUInt32LE(Number(val))
      uWriter.writeZeroes(4)
      break
    case VTT_TYPE.VTT_float:
      uWriter.writeFloatLE(Number(val))
      uWriter.writeZeroes(4)
      break
    case VTT_TYPE.VTT_double:
      uWriter.writeDoubleLE(Number(val))
      break
    case VTT_TYPE.VTT_int64:
      uWriter.writeBigInt64LE(BigInt(val))
      break
    case VTT_TYPE.VTT_uint64:
      uWriter.writeBigUInt64LE(BigInt(val))
      break
    default:
      uWriter.writeZeroes(8)
      break
  }

  writer.writeBytes(uWriter.toBuffer().subarray(0, 8))
  return writer.toBuffer()
}

/**
 * Decodes TVAL structure (12 bytes).
 *
 * @param {Buffer} buffer
 * @returns {{
 *   type: number,
 *   value: any,
 *   asString: string,
 * }}
 */
export function decodeTval(buffer) {
  const reader = new BinaryReader(buffer)
  const type = reader.readUInt32LE()
  /** @type {any} */
  let value = 0
  let asString = ''

  switch (type) {
    case VTT_TYPE.VTT_char:
      value = reader.readInt8()
      reader.readBytes(7)
      asString = String(value)
      break
    case VTT_TYPE.VTT_uchar:
    case VTT_TYPE.VTT_bit:
      value = reader.readUInt8()
      reader.readBytes(7)
      asString = String(value)
      break
    case VTT_TYPE.VTT_short:
      value = reader.readInt16LE()
      reader.readBytes(6)
      asString = String(value)
      break
    case VTT_TYPE.VTT_ushort:
      value = reader.readUInt16LE()
      reader.readBytes(6)
      asString = String(value)
      break
    case VTT_TYPE.VTT_int:
    case VTT_TYPE.VTT_long:
      value = reader.readInt32LE()
      reader.readBytes(4)
      asString = String(value)
      break
    case VTT_TYPE.VTT_uint:
    case VTT_TYPE.VTT_ulong:
      value = reader.readUInt32LE()
      reader.readBytes(4)
      asString = String(value)
      break
    case VTT_TYPE.VTT_ptr:
      value = reader.readUInt32LE()
      reader.readBytes(4)
      asString = `0x${value.toString(16).padStart(8, '0')}`
      break
    case VTT_TYPE.VTT_float:
      value = reader.readFloatLE()
      reader.readBytes(4)
      asString = String(value)
      break
    case VTT_TYPE.VTT_double:
      value = reader.readDoubleLE()
      asString = String(value)
      break
    case VTT_TYPE.VTT_int64:
      value = reader.readBigInt64LE()
      asString = value.toString()
      break
    case VTT_TYPE.VTT_uint64:
      value = reader.readBigUInt64LE()
      asString = value.toString()
      break
    default:
      reader.readBytes(8)
      value = 0
      asString = 'void'
      break
  }

  return { type, value, asString }
}

/**
 * Encodes VSET structure (272 bytes: 12 bytes TVAL + 260 bytes SSTR).
 *
 * @param {{
 *   str: string,
 *   type?: number,
 *   value?: any,
 * }} options
 * @returns {Buffer}
 */
export function encodeVset(options) {
  const tvalBuf = encodeTval({ type: options.type, value: options.value })
  const sstrBuf = encodeSstr(options.str || '')
  return Buffer.concat([tvalBuf, sstrBuf])
}

/**
 * Decodes VSET structure.
 *
 * @param {Buffer} buffer
 * @returns {{
 *   val: ReturnType<typeof decodeTval>,
 *   str: string,
 * }}
 */
export function decodeVset(buffer) {
  const val = decodeTval(buffer.subarray(0, 12))
  const sstr = decodeSstr(buffer.subarray(12, 272))
  return { val, str: sstr.str }
}
