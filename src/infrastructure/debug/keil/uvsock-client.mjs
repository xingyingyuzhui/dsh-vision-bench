// @ts-check

/**
 * Compatibility wrapper for Keil UVSC client.
 * Deprecated legacy module: Use uvsc-client.mjs for real binary UVSC protocol.
 */
import { KeilUvscClient, UVSC_OPCODES, UVSC_STATUS } from './uvsc-client.mjs'

export const UVSOCK_OPCODES = UVSC_OPCODES
export const UVSOCK_STATUS = UVSC_STATUS
export class KeilUvSockClient extends KeilUvscClient {}
