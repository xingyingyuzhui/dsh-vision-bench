import type { ConfidenceLevel } from './program.d.ts'

export interface ArchifyNode {
  id: string
  label: string
  kind: 'function' | 'variable' | 'file' | 'task'
  file?: string
  line?: number
  properties?: Record<string, any>
}

export interface ArchifyEdge {
  id: string
  from: string
  to: string
  kind: 'call' | 'read' | 'write' | 'include'
  confidence?: ConfidenceLevel
  metadata?: Record<string, any>
}

export interface ArchifyGroup {
  id: string
  label: string
  memberNodeIds: string[]
}

export interface ArchifyGraphIR {
  version: string
  nodes: ArchifyNode[]
  edges: ArchifyEdge[]
  groups: ArchifyGroup[]
  metadata: Record<string, any>
}

export interface DebugStoryStep {
  stepIndex: number
  timestamp: number
  kind: string
  location?: { file: string; line: number }
  description: string
  cause?: string
  snapshotId?: string
  evidence?: any
}

export interface DebugStory {
  title: string
  rootCause?: string
  steps: DebugStoryStep[]
  narrative: string
  summary: {
    totalSteps: number
    stoppedReason?: string
    durationMs?: number
  }
}

export interface ProgramDelta {
  addedFunctions: any[]
  removedFunctions: any[]
  modifiedFunctions: any[]
  addedVariables: any[]
  removedVariables: any[]
  addedCalls: any[]
  removedCalls: any[]
  addedDataEdges: any[]
  removedDataEdges: any[]
  summary: {
    functionsDelta: number
    variablesDelta: number
    callsDelta: number
    dataEdgesDelta: number
  }
}
