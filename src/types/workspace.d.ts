/** Core workspace config / runtime shapes for Vision Bench 0.21. */

export type ConnectionEndpoint = {
  mode: 'rtu' | 'tcp' | string
  port?: string
  baudrate?: number
  bytesize?: number
  parity?: string
  stopbits?: number
  host?: string
  tcpPort?: number
  sim?: boolean
}

export type Connection = {
  id: string
  name: string
  role?: 'client' | 'server' | 'master' | 'slave' | string
  enabled?: boolean
  conn: ConnectionEndpoint
}

export type Device = {
  id: string
  connectionId: string
  name: string
  unitId: number
  enabled?: boolean
}

export type Point = {
  id: string
  connectionId: string
  /** @deprecated use connectionId */
  connId?: string
  deviceId: string
  name: string
  function: number
  address: number
  scale?: number
  offset?: number
  unit?: string
  alarmMin?: number | null
  alarmMax?: number | null
  monitorEnabled?: boolean
  alarmEnabled?: boolean
  /** @deprecated use monitorEnabled */
  trendEnabled?: boolean
}

export type PointValue = {
  key?: string
  pointId?: string
  value?: number | boolean | null
  raw?: number | null
  ok: boolean
  at?: number
  error?: string
}

export type TaskRecord = {
  id: string
  type?: string
  startedAt?: number
  endedAt?: number
  [key: string]: unknown
}

export type TimelineRecord = {
  id?: string
  at?: number
  [key: string]: unknown
}

export type AlarmState = Record<
  string,
  {
    condition?: 'active' | 'recovered' | string
    acknowledged?: boolean
    ackedAt?: number
    ackedBy?: string
  }
>

export type VisualizationLayout = {
  x: number
  y: number
  w: number
  h: number
}

export type VisualizationComponent = {
  id: string
  name: string
  type: 'line' | 'bar' | 'value' | 'switch' | string
  pointIds: string[]
  order?: number
  settings?: Record<string, unknown>
  layout?: VisualizationLayout
}

export type WorkspaceConfig = {
  layoutVersion?: number
  keil?: Record<string, unknown>
  session?: { boundId?: string }
  modbus: {
    version: number
    configVersion: number
    connections: Connection[]
    devices: Device[]
    points: Point[]
    pollingByConnection?: Record<string, unknown>
    visualization?: { schemaVersion?: number; components?: VisualizationComponent[] }
    activeConnectionId?: string
    activeDeviceId?: string
  }
}

export type TrendSample = {
  at: number
  value?: number | boolean | null
  raw?: number | null
  ok?: boolean
}

export type TrendSeries = {
  pointId: string
  samples?: TrendSample[]
}

export type FrameRecord = {
  id?: string
  frameId?: string
  transactionId?: string
  t?: number
  at?: number
  connectionId?: string
  deviceId?: string
  direction?: 'tx' | 'rx' | string
  function?: number
  ok?: boolean
  raw?: string
  decoded?: string
}

export type WorkspaceRuntime = {
  layoutVersion?: number
  modbus: {
    values?: PointValue[]
    alarmState?: AlarmState
    alarmActive?: AlarmState
    framesByConnection?: Record<string, FrameRecord[]>
    trend?: Record<string, TrendSeries | TrendSample[] | unknown>
  }
  focus?: unknown
  tasks?: TaskRecord[]
  log?: unknown[]
  timeline?: TimelineRecord[]
  manualRequests?: unknown[]
}

export type VisionWorkspace = WorkspaceConfig & WorkspaceRuntime
