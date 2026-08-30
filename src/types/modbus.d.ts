import type {
  AlarmState,
  Connection,
  ConnectionEndpoint,
  Device,
  FrameRecord,
  Point,
  PointValue,
  VisualizationComponent,
} from './workspace'

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

/** Normalized v3 state returned by the legacy compatibility normalizer. */
export type ModbusWorkspace = {
  version: number
  configVersion: number
  connections: Connection[]
  devices: Device[]
  points: Point[]
  values: PointValue[]
  conn?: ConnectionEndpoint
  activeConnectionId?: string
  activeDeviceId?: string
  polling?: Record<string, unknown>
  pollingByConnection?: Record<string, Record<string, unknown>>
  framesByConnection?: Record<string, FrameRecord[]>
  alarmState?: AlarmState
  alarmActive?: AlarmState
  visualization?: { schemaVersion?: number; components?: VisualizationComponent[] }
  [key: string]: unknown
}

/** Compatibility command body accepted at the legacy UI/Agent boundary. */
export type ModbusCommandBody = Record<string, any>

export type ModbusOperationOptions = {
  signal?: AbortSignal
  transport?: ModbusTransport
  connectionId?: string
  connId?: string
  [key: string]: unknown
}

export type CapturedFrames = {
  request?: string
  response?: string
  requestHex?: string
  responseHex?: string
  trace?: unknown[]
  frameFormat?: string
}

export type TransportError = { code?: string; message?: string; [key: string]: unknown }

export type TransportResult = {
  ok?: boolean
  data?: unknown[]
  result?: { details?: { raw?: unknown[]; frames?: CapturedFrames } }
  frames?: CapturedFrames
  transactionId?: string
  durationMs?: number
  error?: TransportError
}

export type ReadBatch = {
  fc: number
  address: number
  count: number
  connectionId?: string
  deviceId?: string
  [key: string]: unknown
}

export type ModbusTransport = {
  openConnection(input: Record<string, unknown>): Promise<TransportResult>
  closeConnection(input: Record<string, unknown>): Promise<TransportResult>
  read(input: Record<string, unknown>, options?: Record<string, unknown>): Promise<TransportResult>
  write(input: Record<string, unknown>, options?: Record<string, unknown>): Promise<TransportResult>
}

export type TransactionFrameExtra = {
  at?: number
  connectionId?: string
  deviceId?: string
  deviceName?: string
  taskId?: string
  transactionId?: string
  frameId?: string
  sessionId?: string
  toolCallId?: string
  port?: string
  source?: string
  direction?: string
  frameFormat?: string
  unitId?: number
  functionCode?: number
  durationMs?: number
  status?: string
  error?: string
}

export type WriteCompletionExtra = {
  frames?: CapturedFrames | null
  frame?: Record<string, any> | null
  simulated?: boolean
  readback?: unknown[]
  durationMs?: number
  error?: string
  transactionId?: string
  at?: number
  pointValues?: PointValue[]
  errorCode?: string
  readbackMismatch?: boolean
  readbackOk?: boolean
  readbackTried?: boolean
  framesByConnection?: Record<string, FrameRecord[]>
  values?: PointValue[]
  outcomeUnknown?: boolean
  transportErrorCode?: string
  retryable?: boolean
}
