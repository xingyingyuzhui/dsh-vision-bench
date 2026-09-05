// @ts-check

export const UVSOCK_HEADER_SIZE = 32
export const UVSOCK_MAX_PACKET_SIZE = 64 * 1024 * 1024 // 64 MB sanity limit

/**
 * Encodes a complete 32-byte header UVSOCK packet.
 *
 * @param {{
 *   cmd: number,
 *   payload?: Buffer | Uint8Array,
 *   cycles?: bigint | number,
 *   tStamp?: number,
 *   id?: number,
 * }} packet
 * @returns {Buffer}
 */
export function encodePacket(packet) {
  const payloadBuf = packet.payload
    ? Buffer.isBuffer(packet.payload)
      ? packet.payload
      : Buffer.from(packet.payload)
    : Buffer.alloc(0)

  const dataLen = payloadBuf.length
  const totalLen = UVSOCK_HEADER_SIZE + dataLen

  const buf = Buffer.alloc(totalLen)
  buf.writeUInt32LE(totalLen >>> 0, 0)
  buf.writeUInt32LE(packet.cmd >>> 0, 4)
  buf.writeUInt32LE(dataLen >>> 0, 8)
  buf.writeBigUInt64LE(BigInt(packet.cycles ?? 0n), 12)
  buf.writeDoubleLE(Number(packet.tStamp ?? 0.0), 20)
  buf.writeUInt32LE((packet.id ?? 0) >>> 0, 28)

  if (dataLen > 0) {
    payloadBuf.copy(buf, UVSOCK_HEADER_SIZE)
  }

  return buf
}

/**
 * Decodes 32-byte header of a packet starting at offset.
 *
 * @param {Buffer} buffer
 * @param {number} [offset=0]
 * @returns {{
 *   totalLen: number,
 *   cmd: number,
 *   bufLen: number,
 *   cycles: bigint,
 *   tStamp: number,
 *   id: number,
 * }}
 */
export function decodePacketHeader(buffer, offset = 0) {
  if (buffer.length - offset < UVSOCK_HEADER_SIZE) {
    throw new RangeError(`decodePacketHeader: Buffer too short (${buffer.length - offset} < ${UVSOCK_HEADER_SIZE})`)
  }

  const totalLen = buffer.readUInt32LE(offset)
  const cmd = buffer.readUInt32LE(offset + 4)
  const bufLen = buffer.readUInt32LE(offset + 8)
  const cycles = buffer.readBigUInt64LE(offset + 12)
  const tStamp = buffer.readDoubleLE(offset + 20)
  const id = buffer.readUInt32LE(offset + 28)

  return { totalLen, cmd, bufLen, cycles, tStamp, id }
}

/**
 * Parses zero or more complete UVSOCK packets from a streaming buffer.
 *
 * @param {Buffer} buffer
 * @returns {{
 *   packets: Array<{
 *     header: {
 *       totalLen: number,
 *       cmd: number,
 *       bufLen: number,
 *       cycles: bigint,
 *       tStamp: number,
 *       id: number,
 *     },
 *     payload: Buffer,
 *   }>,
 *   rest: Buffer,
 * }}
 */
export function decodePackets(buffer) {
  /** @type {Array<{ header: ReturnType<typeof decodePacketHeader>, payload: Buffer }>} */
  const packets = []
  let cursor = 0

  while (buffer.length - cursor >= UVSOCK_HEADER_SIZE) {
    const totalLen = buffer.readUInt32LE(cursor)
    const bufLen = buffer.readUInt32LE(cursor + 8)

    // Sanity validation on totalLen and bufLen
    if (totalLen < UVSOCK_HEADER_SIZE || totalLen > UVSOCK_MAX_PACKET_SIZE) {
      // Out of sync or corrupt packet, advance by 1 byte
      cursor += 1
      continue
    }

    if (totalLen !== UVSOCK_HEADER_SIZE + bufLen) {
      cursor += 1
      continue
    }

    // Check if full packet has arrived
    if (buffer.length - cursor < totalLen) {
      break
    }

    const header = decodePacketHeader(buffer, cursor)
    const payload = buffer.subarray(cursor + UVSOCK_HEADER_SIZE, cursor + totalLen)

    packets.push({
      header,
      payload: Buffer.from(payload),
    })

    cursor += totalLen
  }

  return {
    packets,
    rest: buffer.subarray(cursor),
  }
}

/**
 * Stateful accumulator for streaming TCP data.
 */
export class PacketAccumulator {
  constructor() {
    this.buffer = Buffer.alloc(0)
  }

  /**
   * Feeds a newly received chunk and returns any newly parsed full packets.
   * @param {Buffer} chunk
   */
  feed(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    const { packets, rest } = decodePackets(this.buffer)
    this.buffer = rest
    return packets
  }

  /**
   * Resets buffered bytes.
   */
  reset() {
    this.buffer = Buffer.alloc(0)
  }
}
