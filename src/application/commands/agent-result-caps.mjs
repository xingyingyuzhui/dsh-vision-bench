// @ts-check
export const AGENT_TEXT_CAPS = Object.freeze({
  statusBytes: 16 * 1024,
  singlePointReadBytes: 8 * 1024,
  multiPointReadBytes: 16 * 1024,
  readBytes: 16 * 1024,
  threePointConfigCommitBytes: 8 * 1024,
  framesBytes: 16 * 1024,
  trendBytes: 16 * 1024,
  alarmBytes: 16 * 1024,
  listBytes: 16 * 1024,
})

/** Server-side Agent frames page cap (client may send a larger limit). */
export const AGENT_FRAMES_MAX_LIMIT = 100

/**
 * @param {unknown} value
 * @returns {number}
 */
export function utf8ByteLength(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8')
  } catch {
    return Number.POSITIVE_INFINITY
  }
}
