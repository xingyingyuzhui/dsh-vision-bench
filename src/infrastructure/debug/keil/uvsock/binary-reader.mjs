// @ts-check

/**
 * Little-endian binary reader for UVSOCK wire structures.
 */
export class BinaryReader {
  /**
   * @param {Buffer} buffer
   * @param {number} [initialOffset=0]
   */
  constructor(buffer, initialOffset = 0) {
    this.buffer = buffer
    this.offset = initialOffset
  }

  get remaining() {
    return Math.max(0, this.buffer.length - this.offset)
  }

  /**
   * Asserts that at least `bytes` remain in buffer.
   * @param {number} bytes
   */
  ensure(bytes) {
    if (this.offset + bytes > this.buffer.length) {
      throw new RangeError(
        `BinaryReader: Unexpected end of buffer (need ${bytes} bytes, have ${this.remaining} at offset ${this.offset})`,
      )
    }
  }

  readUInt8() {
    this.ensure(1)
    const val = this.buffer.readUInt8(this.offset)
    this.offset += 1
    return val
  }

  readInt8() {
    this.ensure(1)
    const val = this.buffer.readInt8(this.offset)
    this.offset += 1
    return val
  }

  readUInt16LE() {
    this.ensure(2)
    const val = this.buffer.readUInt16LE(this.offset)
    this.offset += 2
    return val
  }

  readInt16LE() {
    this.ensure(2)
    const val = this.buffer.readInt16LE(this.offset)
    this.offset += 2
    return val
  }

  readUInt32LE() {
    this.ensure(4)
    const val = this.buffer.readUInt32LE(this.offset)
    this.offset += 4
    return val
  }

  readInt32LE() {
    this.ensure(4)
    const val = this.buffer.readInt32LE(this.offset)
    this.offset += 4
    return val
  }

  readBigUInt64LE() {
    this.ensure(8)
    const val = this.buffer.readBigUInt64LE(this.offset)
    this.offset += 8
    return val
  }

  readBigInt64LE() {
    this.ensure(8)
    const val = this.buffer.readBigInt64LE(this.offset)
    this.offset += 8
    return val
  }

  readDoubleLE() {
    this.ensure(8)
    const val = this.buffer.readDoubleLE(this.offset)
    this.offset += 8
    return val
  }

  readFloatLE() {
    this.ensure(4)
    const val = this.buffer.readFloatLE(this.offset)
    this.offset += 4
    return val
  }

  /**
   * Reads a fixed number of bytes as a Buffer slice.
   * @param {number} length
   * @returns {Buffer}
   */
  readBytes(length) {
    this.ensure(length)
    const slice = this.buffer.subarray(this.offset, this.offset + length)
    this.offset += length
    return Buffer.from(slice)
  }

  /**
   * Reads a null-terminated string within a fixed-size field or the remainder of the buffer.
   * @param {number} [maxLength]
   * @returns {string}
   */
  readCString(maxLength) {
    const len = maxLength !== undefined ? Math.min(maxLength, this.remaining) : this.remaining
    this.ensure(len)
    const slice = this.buffer.subarray(this.offset, this.offset + len)
    const nullIdx = slice.indexOf(0)
    const strLen = nullIdx !== -1 ? nullIdx : len
    const str = slice.subarray(0, strLen).toString('utf8')
    this.offset += len
    return str
  }

  /**
   * Reads remaining bytes up to buffer length.
   * @returns {Buffer}
   */
  readRemaining() {
    const slice = this.buffer.subarray(this.offset)
    this.offset = this.buffer.length
    return Buffer.from(slice)
  }
}
