import type {
  DebugBackendKind,
  DebugBreakpoint,
  DebugRegister,
  DebugStackFrame,
  DebugVariable,
  DebugWatchpoint,
  SourceLocation,
} from './debug.d.ts'

export type BackendStopReason =
  | 'breakpoint'
  | 'watchpoint'
  | 'step'
  | 'signal'
  | 'exception'
  | 'manual'
  | 'pause'
  | 'exit'
  | 'reset'
  | 'unknown'

export type DebugBackendEvent =
  | {
      type: 'backend.running'
      threadId?: string
    }
  | {
      type: 'backend.stopped'
      reason: BackendStopReason
      location?: SourceLocation
      nativeReason?: string
      breakpointNumber?: string
      watchpointNumber?: string
      threadId?: string
    }
  | {
      type: 'backend.console'
      stream: 'console' | 'target' | 'log'
      text: string
    }
  | {
      type: 'backend.exited'
      code?: number
      signal?: string
      unexpected: boolean
    }
  | {
      type: 'backend.error'
      code?: string
      message: string
      fatal?: boolean
    }

export interface DebugBackendCapabilities {
  breakpoints?: boolean
  watchpoints?: boolean
  memoryRead?: boolean
  registers?: boolean
  simulatorSignals?: boolean
  [key: string]: any
}

export interface DebugBackend {
  start(spec?: any): Promise<any>
  stop(): Promise<any>

  continue(): Promise<any>
  requestPause(): Promise<any>
  pause?(): Promise<any>

  stepOver(): Promise<any>
  stepInto(): Promise<any>
  stepOut(): Promise<any>
  step?(stepType?: 'over' | 'into' | 'out'): Promise<any>

  resetHalt(): Promise<any>

  addBreakpoint(bp: DebugBreakpoint): Promise<any>
  removeBreakpoint(bp: DebugBreakpoint | string): Promise<any>

  addWatchpoint(wp: DebugWatchpoint): Promise<any>
  removeWatchpoint(wp: DebugWatchpoint | string): Promise<any>

  stack(depth?: number): Promise<DebugStackFrame[]>
  locals(frame?: number): Promise<DebugVariable[]>
  registers(): Promise<DebugRegister[]>
  evaluate(expr: string, frame?: number): Promise<any>
  readMemory(address: string, length?: number): Promise<any>

  subscribe(listener: (event: DebugBackendEvent) => void): () => void
  capabilities?(): DebugBackendCapabilities
}
