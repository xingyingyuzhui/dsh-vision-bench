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
  | 'CONFIG_VERSION_REQUIRED'
  | 'CONFIG_INVALID'
  | 'TASK_CONFLICT'
  | 'FLASH_APPROVAL_REQUIRED'
  | 'FLASH_APPROVAL_NOT_FOUND'
  | 'FLASH_APPROVAL_EXPIRED'
  | 'FLASH_APPROVAL_SCOPE_MISMATCH'
  | 'FIRMWARE_SNAPSHOT_FAILED'
  | 'FIRMWARE_SNAPSHOT_MISMATCH'
  | 'OPENOCD_NOT_FOUND'
  | 'OPENOCD_IDENTITY_INVALID'
  | 'OPENOCD_PROBE_FAILED'
  | 'OPENOCD_PROBE_TIMEOUT'
  | 'OPENOCD_PROBE_CANCELLED'
  | 'FLASH_INTERFACE_INVALID'
  | 'FLASH_TARGET_INVALID'
  | 'FLASH_RESULT_UNVERIFIED'
  | 'FLASH_TIMEOUT'
  | 'FLASH_CANCELLED'
  | 'FLASH_FAILED'
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
