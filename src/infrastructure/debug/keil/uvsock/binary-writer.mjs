// @ts-check

/**
 * Little-endian binary writer for UVSOCK wire structures.
 */
export class BinaryWriter {
  /**
   * @param {number} [initialCapacity=256]
   */
  constructor(initialCapacity = 256) {
    this.buffer = Buffer.alloc(Math.max(64, initialCapacity))
    this.offset = 0
  }

  get length() {
    return this.offset
  }

  /**
   * Grows internal buffer if needed.
   * @param {number} bytesNeeded
   */
  ensureCapacity(bytesNeeded) {
    if (this.offset + bytesNeeded > this.buffer.length) {
      const newCapacity = Math.max(this.buffer.length * 2, this.offset + bytesNeeded + 64)
      const newBuf = Buffer.alloc(newCapacity)
      this.buffer.copy(newBuf, 0, 0, this.offset)
      this.buffer = newBuf
    }
  }

  /** @param {number} val */
  writeUInt8(val) {
    this.ensureCapacity(1)
    this.buffer.writeUInt8(val & 0xff, this.offset)
    this.offset += 1
    return this
  }

  /** @param {number} val */
  writeInt8(val) {
    this.ensureCapacity(1)
    this.buffer.writeInt8(val, this.offset)
    this.offset += 1
    return this
  }

  /** @param {number} val */
  writeUInt16LE(val) {
    this.ensureCapacity(2)
    this.buffer.writeUInt16LE(val & 0xffff, this.offset)
    this.offset += 2
    return this
  }

  /** @param {number} val */
  writeInt16LE(val) {
    this.ensureCapacity(2)
    this.buffer.writeInt16LE(val, this.offset)
    this.offset += 2
    return this
  }

  /** @param {number} val */
  writeUInt32LE(val) {
    this.ensureCapacity(4)
    this.buffer.writeUInt32LE(val >>> 0, this.offset)
    this.offset += 4
    return this
  }

  /** @param {number} val */
  writeInt32LE(val) {
    this.ensureCapacity(4)
    this.buffer.writeInt32LE(val, this.offset)
    this.offset += 4
    return this
  }

  /** @param {bigint | number} val */
  writeBigUInt64LE(val) {
    this.ensureCapacity(8)
    this.buffer.writeBigUInt64LE(BigInt(val), this.offset)
    this.offset += 8
    return this
  }

  /** @param {bigint | number} val */
  writeBigInt64LE(val) {
    this.ensureCapacity(8)
    this.buffer.writeBigInt64LE(BigInt(val), this.offset)
    this.offset += 8
    return this
  }

  /** @param {number} val */
  writeDoubleLE(val) {
    this.ensureCapacity(8)
    this.buffer.writeDoubleLE(val, this.offset)
    this.offset += 8
    return this
  }

  /** @param {number} val */
  writeFloatLE(val) {
    this.ensureCapacity(4)
    this.buffer.writeFloatLE(val, this.offset)
    this.offset += 4
    return this
  }

  /**
   * Writes raw bytes from a Buffer or Uint8Array.
   * @param {Buffer | Uint8Array} bytes
   */
  writeBytes(bytes) {
    this.ensureCapacity(bytes.length)
    if (Buffer.isBuffer(bytes)) {
      bytes.copy(this.buffer, this.offset)
    } else {
      Buffer.from(bytes).copy(this.buffer, this.offset)
    }
    this.offset += bytes.length
    return this
  }

  /**
   * Writes a fixed number of zero bytes.
   * @param {number} count
   */
  writeZeroes(count) {
    if (count <= 0) return this
    this.ensureCapacity(count)
    this.buffer.fill(0, this.offset, this.offset + count)
    this.offset += count
    return this
  }

  /**
   * Writes a null-terminated string.
   * @param {string} str
   */
  writeCString(str) {
    const strBuf = Buffer.from(str, 'utf8')
    this.writeBytes(strBuf)
    this.writeUInt8(0)
    return this
  }

  /**
   * Writes a string into a fixed-length field, null-padded.
   * @param {string} str
   * @param {number} fieldLength
   */
  writeFixedCString(str, fieldLength) {
    const strBuf = Buffer.from(str, 'utf8')
    const maxCopy = Math.min(strBuf.length, fieldLength - 1)
    this.ensureCapacity(fieldLength)
    this.buffer.fill(0, this.offset, this.offset + fieldLength)
    strBuf.copy(this.buffer, this.offset, 0, maxCopy)
    this.offset += fieldLength
    return this
  }

  /**
   * Returns written buffer slice.
   * @returns {Buffer}
   */
  toBuffer() {
    return Buffer.from(this.buffer.subarray(0, this.offset))
  }
}
