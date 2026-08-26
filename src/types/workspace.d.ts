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

export type AlarmState = Record<
  string,
  {
    condition?: 'active' | 'recovered' | string
    acknowledged?: boolean
    ackedAt?: number
    ackedBy?: string
  }
>

export type VisualizationComponent = {
  id: string
  name: string
  type: 'line' | 'bar' | 'value' | 'switch' | string
  pointIds: string[]
  order?: number
  settings?: Record<string, unknown>
}

export type WorkspaceConfig = {
  layoutVersion?: number
  keil?: Record<string, unknown>
  session?: { boundId?: string }
  configDrafts?: unknown[]
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

export type WorkspaceRuntime = {
  layoutVersion?: number
  modbus: {
    values?: PointValue[]
    alarmState?: AlarmState
    alarmActive?: AlarmState
    framesByConnection?: Record<string, unknown[]>
    trend?: Record<string, unknown>
  }
  focus?: unknown
  tasks?: unknown[]
  log?: unknown[]
  timeline?: unknown[]
  manualRequests?: unknown[]
}
