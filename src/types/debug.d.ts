export type DebugBackendKind = 'gdb-openocd' | 'keil-simulator' | 'fake'

export type DebugRunState = 'idle' | 'starting' | 'ready' | 'running' | 'paused' | 'stopping' | 'failed'

export interface SourceLocation {
  file: string
  line: number
  column?: number
  function?: string
  address?: string
}

export interface DebugBreakpoint {
  id: string
  file: string
  line: number
  condition?: string
  hitCount?: number
  verified: boolean
}

export interface DebugWatchpoint {
  id: string
  expression: string
  accessType?: 'read' | 'write' | 'readWrite'
  hitCount?: number
  verified: boolean
}

export interface DebugStackFrame {
  level: number
  function: string
  file?: string
  line?: number
  address?: string
}

export interface DebugVariable {
  name: string
  value: string
  type?: string
  children?: DebugVariable[]
}

export interface DebugRegister {
  name: string
  value: string
}

export interface DebugEvent {
  id: string
  cursor: number
  debugSessionId: string
  workspaceCwd: string
  ownerSessionId: string
  timestamp: number
  type: string
  backend: DebugBackendKind
  payload?: any
}

export interface DebugSnapshot {
  id: string
  createdAt: number
  reason: string
  location?: SourceLocation | null
  stack?: DebugStackFrame[]
  locals?: DebugVariable[]
  watches?: DebugVariable[]
  registers?: DebugRegister[]
  selectedGlobals?: DebugVariable[]
  sourceContext?: string
  firmwareHash?: string
  backend: DebugBackendKind
  breakpointId?: string
  watchpointId?: string
}

export interface DebugSessionView {
  debugSessionId: string
  workspaceCwd: string
  ownerSessionId: string
  backend: DebugBackendKind
  state: DebugRunState
  isStopping?: boolean
  location?: SourceLocation | null
  stack?: DebugStackFrame[]
  variables?: DebugVariable[]
  breakpoints?: DebugBreakpoint[]
  watchpoints?: DebugWatchpoint[]
  snapshots?: DebugSnapshot[]
  stopReason?: string
  targetKey: string
  createdAt: number
  updatedAt: number
}
