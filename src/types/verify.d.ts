export type AssertionType =
  | 'debug.expression'
  | 'modbus.point'
  | 'no.exception'
  | 'no.alarm'
  | 'range'
  | 'changed'
  | 'stable-for-duration'

export type AssertionOperator = '==' | '!=' | '>' | '>=' | '<' | '<=' | 'in' | 'matches'

export interface AssertionSpec {
  id?: string
  type: AssertionType
  expr?: string
  expression?: string
  pointId?: string
  source?: {
    type?: string
    pointId?: string
    expr?: string
    expression?: string
  }
  op?: AssertionOperator
  operator?: AssertionOperator
  value?: any
  expected?: any
  min?: number
  max?: number
  durationMs?: number
  sampleIntervalMs?: number
  tolerance?: number
  maxAgeMs?: number
  description?: string
}

export interface ScenarioSpec {
  id?: string
  name: string
  description?: string
  timeoutMs?: number
  assertions: AssertionSpec[]
  targetSpec?: Record<string, any>
  setup?: {
    signals?: any[]
    modbusWrites?: Array<{ pointId: string; value: any }>
    delayMs?: number
  }
}

export interface AssertionResult {
  id: string
  type: AssertionType
  pass: boolean
  actual: any
  expected: any
  op?: string
  message: string
  timestamp: number
}

export type VerifyStatus = 'pass' | 'fail' | 'error' | 'timeout' | 'cancelled'

export interface VerifyResult {
  verificationRunId?: string
  scenarioId: string
  scenarioName: string
  status: VerifyStatus
  passedCount: number
  failedCount: number
  totalCount: number
  durationMs: number
  assertions: AssertionResult[]
  evidence: Array<Record<string, any>>
  summary: string
  timestamp: number
  artifact?: {
    path?: string
    sha256?: string
    sizeBytes?: number
  }
  artifactPath?: string
  artifactSha256?: string
  debug?: {
    debugSessionId?: string
    backend?: string
    firmwareHash?: string
    targetIdentity?: string
  }
  backend?: string
  debugSessionId?: string
  firmwareHash?: string
  targetIdentity?: string
  snapshots?: any[]
  startedAt?: number
  finishedAt?: number
  startAt?: number
  endAt?: number
  telemetrySamples?: Array<{ pointId?: string; expr?: string; timestamp: number; value: any }>
}
