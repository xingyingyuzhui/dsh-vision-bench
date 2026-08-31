// @ts-check
/** Unified Modbus / Vision Bench error codes (HTTP + Agent share these). */
export const ERROR_CODES = {
  PORT_IN_USE: 'PORT_IN_USE',
  TARGET_REQUIRED: 'TARGET_REQUIRED',
  TARGET_MISMATCH: 'TARGET_MISMATCH',
  DEVICE_DISABLED: 'DEVICE_DISABLED',
  ENDPOINT_DRIFT: 'ENDPOINT_DRIFT',
  STALE_VALUE: 'STALE_VALUE',
  WRITE_READBACK_MISMATCH: 'WRITE_READBACK_MISMATCH',
  POINT_NOT_FOUND: 'POINT_NOT_FOUND',
  CONNECTION_NOT_FOUND: 'CONNECTION_NOT_FOUND',
  DEVICE_NOT_FOUND: 'DEVICE_NOT_FOUND',
  UNIT_ID_INVALID: 'UNIT_ID_INVALID',
  CONFIG_DRIFT: 'CONFIG_DRIFT',
  CONFIG_VERSION_REQUIRED: 'CONFIG_VERSION_REQUIRED',
  CONFLICT: 'CONFLICT',
  WRITE_OUTCOME_UNKNOWN: 'WRITE_OUTCOME_UNKNOWN',
  IO_RUNTIME_UNAVAILABLE: 'IO_RUNTIME_UNAVAILABLE',
}

/**
 * @param {string} errorCode
 * @param {string} error
 * @param {Record<string, unknown>} [details]
 * @param {boolean} [retryable]
 */
export function fail(errorCode, error, details = {}, retryable = false) {
  return {
    ok: false,
    errorCode,
    error,
    retryable,
    details,
  }
}
