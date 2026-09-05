// @ts-check

/**
 * Compatibility wrapper for Keil UVSOCK client.
 * Deprecated: Use uvsock-client.mjs or uvsock/index.mjs for official 32-byte header UVSOCK protocol.
 */
import { UV_OPERATION, UV_STATUS, UvSockClient, statusToString } from './uvsock-client.mjs'

export const UVSC_OPCODES = UV_OPERATION
export const UVSC_STATUS = UV_STATUS
export { UV_OPERATION, UV_STATUS, statusToString }
export class KeilUvscClient extends UvSockClient {}
export class KeilUvSockClient extends UvSockClient {}
export { UvSockClient }
