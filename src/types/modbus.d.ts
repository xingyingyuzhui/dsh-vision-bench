import type { Connection, ConnectionEndpoint, Device, Point, PointValue } from './workspace'

export type FunctionCode = 1 | 2 | 3 | 4 | 5 | 6 | 15 | 16 | number

export type ModbusEndpointFingerprint = {
  mode?: string
  port?: string
  baudrate?: number
  bytesize?: number
  parity?: string
  stopbits?: number
  host?: string
  tcpPort?: number
  unitId?: number
}

export type VisionBenchError = {
  ok: false
  errorCode: string
  error: string
  retryable?: boolean
  details?: Record<string, unknown>
}

export type VisionBenchOk<T extends Record<string, unknown> = Record<string, unknown>> = {
  ok: true
} & T

export type VisionBenchResult<T extends Record<string, unknown> = Record<string, unknown>> =
  | VisionBenchOk<T>
  | VisionBenchError

export type { Connection, ConnectionEndpoint, Device, Point, PointValue }
