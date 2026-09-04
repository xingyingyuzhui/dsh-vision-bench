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

export type AgentCommandEnvelope = {
  commandId: string
  home?: string
  cwd: string
  sessionId: string
  source: 'agent' | 'system' | 'user'
  action: string
  payload: Record<string, unknown>
  expectedConfigVersion?: number
  signal?: AbortSignal
  requireHost?: boolean
  timeoutMs?: number
  transport?: unknown
}

export type AgentCommandResult = {
  ok: boolean
  error?: string
  errorCode?: string
  commandId?: string
  action?: string
  data?: Record<string, unknown>
  previousConfigVersion?: number
  nextConfigVersion?: number
  configVersion?: number
  changedIds?: string[]
  changedPointIds?: string[]
  changedVisualizationIds?: string[]
  affectedVisualizations?: string[]
  affectedAlarms?: string[]
  taskId?: string
  transactionId?: string
  workspace?: unknown
  postCommitWarnings?: import('./http-api').PostCommitWarning[]
  origin?: string
  httpStatus?: number
  [key: string]: unknown
}

export type AgentToolResult = AgentCommandResult
