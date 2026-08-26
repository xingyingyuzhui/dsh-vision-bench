export type AgentReference = {
  kind: 'connection' | 'device' | 'point' | 'frame' | 'component' | string
  connectionId?: string
  deviceId?: string
  pointId?: string
  frameId?: string
  componentId?: string
  name?: string
  configVersion?: number
  timeRange?: { from?: number; to?: number }
}

export type AgentToolResult = {
  ok: boolean
  error?: string
  errorCode?: string
  [key: string]: unknown
}
