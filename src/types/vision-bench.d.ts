/**
 * Shared Vision Bench domain/API types (incremental checkJs surface).
 * Expand in phase 6; keep compatibility aliases out of domain objects.
 */

export type ConnectionId = string
export type DeviceId = string
export type PointId = string

export type VisionBenchErrorCode =
  | 'UNIT_ID_INVALID'
  | 'CONNECTION_NOT_FOUND'
  | 'DEVICE_NOT_FOUND'
  | 'POINT_NOT_FOUND'
  | 'TARGET_MISMATCH'
  | 'CONFIG_DRIFT'
  | 'CONFIG_INVALID'
  | 'ENDPOINT_DRIFT'
  | 'PORT_IN_USE'
  | 'WRITE_OUTCOME_UNKNOWN'
  | 'WRITE_READBACK_MISMATCH'
  | 'IO_RUNTIME_UNAVAILABLE'
  | 'HOST_UNAVAILABLE'
  | 'HOST_TIMEOUT'
  | 'HOST_UNAUTHORIZED'
  | 'HOST_FORBIDDEN'
  | 'HOST_INVALID_RESPONSE'
  | 'HOST_HTTP_STATUS_ERROR'
  | 'WORKSPACE_WRITE_FAILED'
  | 'COMMAND_ID_REUSE'
  | 'UNKNOWN_ACTION'
  | 'OP_REMOVED'

export interface VisionBenchError {
  ok: false
  errorCode: VisionBenchErrorCode | string
  error: string
  retryable?: boolean
  details?: Record<string, unknown>
}

export type VisionBenchOk<T extends object = object> = { ok: true } & T

export type VisionBenchResult<T extends object = object> = VisionBenchOk<T> | VisionBenchError
