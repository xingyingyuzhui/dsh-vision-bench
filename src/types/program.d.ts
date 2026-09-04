export type ConfidenceLevel = 'exact' | 'parsed' | 'inferred' | 'unresolved'

export interface ProgramLocation {
  file: string
  line: number
  column?: number
  endLine?: number
  endColumn?: number
}

export interface ProgramFile {
  id: string
  name: string
  rel: string
  kind: string
  group?: string
  inside: boolean
  exists: boolean
  readable: boolean
  reason?: string
  functionCount?: number
}

export interface ProgramFunction {
  id: string
  fileId: string
  name: string
  line: number
  endLine?: number
  returnType?: string
  parameters?: Array<{ name: string; type?: string }>
  isStatic?: boolean
  isInline?: boolean
  isInterrupt?: boolean
}

export interface ProgramVariable {
  id: string
  name: string
  scope: string
  type?: string
  fileId?: string
  line?: number
  isStatic?: boolean
  isConst?: boolean
  isVolatile?: boolean
}

export interface ProgramCallEdge {
  id: string
  callerId: string
  calleeId?: string
  calleeName: string
  confidence: ConfidenceLevel
  location: ProgramLocation
}

export interface ProgramIncludeEdge {
  id: string
  fromFileId: string
  toFileId?: string
  headerName: string
  resolved: boolean
  confidence: ConfidenceLevel
}

export interface ProgramDataEdge {
  id: string
  kind: 'read' | 'write'
  accessorId: string
  variableId?: string
  variableName: string
  confidence: ConfidenceLevel
  location: ProgramLocation
}

export interface ProgramCondition {
  id: string
  functionId: string
  type: 'if' | 'switch' | 'while' | 'for' | 'ternary'
  referencedVariableIds?: string[]
  location: ProgramLocation
}

export interface ProgramTask {
  id: string
  name: string
  kind: 'task' | 'interrupt' | 'timer'
  entryFunctionId?: string
  priority?: number
}

export interface ProgramModel {
  project: string
  target: string
  files: ProgramFile[]
  functions: ProgramFunction[]
  variables: ProgramVariable[]
  callEdges: ProgramCallEdge[]
  includeEdges: ProgramIncludeEdge[]
  readEdges: ProgramDataEdge[]
  writeEdges: ProgramDataEdge[]
  conditions: ProgramCondition[]
  tasks: ProgramTask[]
  metadata: Record<string, any>
}
