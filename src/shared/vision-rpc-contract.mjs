/** Authenticated Connection RPC channel for Vision browser operations. */
export const VISION_RPC_CHANNEL = '/vision-bench'

/** Stable HTTP path → RPC endpoint mapping consumed by `post()`. */
export const VISION_HTTP_TO_RPC = Object.freeze({
  '/dsh-vision-bench/state': 'state',
  '/dsh-vision-bench/bindings': 'bindings/save',
  '/dsh-vision-bench/workspace': 'workspace/save',
  '/dsh-vision-bench/fs/list': 'fs/list',
  '/dsh-vision-bench/project/file': 'project/file',
  '/dsh-vision-bench/keil/log': 'keil/log',
  '/dsh-vision-bench/keil/artifact': 'keil/artifact',
  '/dsh-vision-bench/keil/download': 'keil/download',
  '/dsh-vision-bench/keil/scan': 'keil/scan',
  '/dsh-vision-bench/keil/targets': 'keil/targets',
  '/dsh-vision-bench/keil/map': 'keil/map',
  '/dsh-vision-bench/keil/build': 'keil/build',
  '/dsh-vision-bench/modbus/read': 'modbus/read',
  '/dsh-vision-bench/modbus/write': 'modbus/write',
  '/dsh-vision-bench/modbus/write/approve': 'modbus/write/approve',
  '/dsh-vision-bench/modbus/connect': 'modbus/connect',
  '/dsh-vision-bench/modbus/points': 'modbus/points',
  '/dsh-vision-bench/points/flags': 'points/flags',
  '/dsh-vision-bench/frames/list': 'frames/list',
  '/dsh-vision-bench/frames/clear': 'frames/clear',
  '/dsh-vision-bench/focus': 'focus',
  '/dsh-vision-bench/evidence': 'evidence',
  '/dsh-vision-bench/manual/resolve': 'manual/resolve',
  '/dsh-vision-bench/modbus/poll': 'modbus/poll',
  '/dsh-vision-bench/polling/start': 'polling/start',
  '/dsh-vision-bench/polling/stop': 'polling/stop',
  '/dsh-vision-bench/polling/status': 'polling/status',
  '/dsh-vision-bench/connection/open': 'connection/open',
  '/dsh-vision-bench/connection/close': 'connection/close',
  '/dsh-vision-bench/serial/ports': 'serial/ports',
  '/dsh-vision-bench/serial/sources': 'serial/sources',
  '/dsh-vision-bench/selfcheck': 'selfcheck',
  '/dsh-vision-bench/openocd/probe': 'openocd/probe',
  '/dsh-vision-bench/serial/feed': 'serial/feed',
  '/dsh-vision-bench/command': 'command',
})

/** @type {readonly string[]} */
export const VISION_RPC_ENDPOINTS = Object.freeze(Object.values(VISION_HTTP_TO_RPC))

/**
 * @param {string} path
 * @returns {string}
 */
export function httpPathToRpcEndpoint(path) {
  const key = String(path || '').split('?')[0]
  const endpoint = VISION_HTTP_TO_RPC[key]
  if (!endpoint) {
    throw new Error(`dsh-vision-bench: unknown RPC path ${key}`)
  }
  return endpoint
}

/**
 * @param {string} endpoint
 * @returns {boolean}
 */
export function isVisionRpcEndpoint(endpoint) {
  return VISION_RPC_ENDPOINTS.includes(endpoint)
}
