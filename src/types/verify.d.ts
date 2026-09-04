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
  pointId?: string
  op?: AssertionOperator
  value?: any
  min?: number
  max?: number
  durationMs?: number
  tolerance?: number
  description?: string
}

export interface ScenarioSpec {
  id: string
  name: string
  description?: string
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

export type VerifyStatus = 'pass' | 'fail' | 'error'

export interface VerifyResult {
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
}
