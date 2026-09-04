// @ts-check

/**
 * Normalizes relative file paths to use forward slashes and removes leading dot-slashes.
 * @param {string} p
 * @returns {string}
 */
export function normalizeRelPath(p) {
  if (!p) return ''
  let cleaned = String(p).replaceAll('\\', '/').trim()
  while (cleaned.startsWith('./')) {
    cleaned = cleaned.slice(2)
  }
  return cleaned
}

/**
 * Generates a stable file ID.
 * Format: `file:<normalized-rel-path>`
 * @param {string} relPath
 * @returns {string}
 */
export function makeFileId(relPath) {
  return `file:${normalizeRelPath(relPath)}`
}

/**
 * Generates a stable function ID.
 * Format: `fn:<file>:<name>:<line>`
 * @param {string} fileRelPath
 * @param {string} name
 * @param {number} line
 * @returns {string}
 */
export function makeFunctionId(fileRelPath, name, line) {
  return `fn:${normalizeRelPath(fileRelPath)}:${name}:${line}`
}

/**
 * Generates a stable variable ID.
 * Format: `var:<scope>:<name>`
 * @param {string} scope - 'global' or fileId or fnId
 * @param {string} name
 * @returns {string}
 */
export function makeVariableId(scope, name) {
  return `var:${scope}:${name}`
}

/**
 * Generates a stable call edge ID.
 * Format: `call:<callerId>-><calleeId|calleeName>@<line>`
 * @param {string} callerId
 * @param {string} calleeNameOrId
 * @param {number} line
 * @returns {string}
 */
export function makeCallEdgeId(callerId, calleeNameOrId, line) {
  return `call:${callerId}->${calleeNameOrId}@${line}`
}

/**
 * Generates a stable include edge ID.
 * Format: `inc:<fromFileRel>-><toFileRelOrName>`
 * @param {string} fromFileRel
 * @param {string} toFileRelOrName
 * @returns {string}
 */
export function makeIncludeEdgeId(fromFileRel, toFileRelOrName) {
  return `inc:${normalizeRelPath(fromFileRel)}->${normalizeRelPath(toFileRelOrName)}`
}

/**
 * Generates a stable data edge ID.
 * Format: `data:<kind>:<accessorId>-><varId|varName>@<line>`
 * @param {'read' | 'write'} kind
 * @param {string} accessorId
 * @param {string} varNameOrId
 * @param {number} line
 * @returns {string}
 */
export function makeDataEdgeId(kind, accessorId, varNameOrId, line) {
  return `data:${kind}:${accessorId}->${varNameOrId}@${line}`
}

/**
 * Generates a stable condition ID.
 * Format: `cond:<fnId>:<type>@<line>`
 * @param {string} fnId
 * @param {string} type
 * @param {number} line
 * @returns {string}
 */
export function makeConditionId(fnId, type, line) {
  return `cond:${fnId}:${type}@${line}`
}

/**
 * Creates an empty or partial ProgramModel with canonical defaults.
 * @param {Partial<import('../../types/program.d.ts').ProgramModel>} [spec]
 * @returns {import('../../types/program.d.ts').ProgramModel}
 */
export function createProgramModel(spec = {}) {
  return {
    project: spec.project || '',
    target: spec.target || '',
    files: Array.isArray(spec.files) ? [...spec.files] : [],
    functions: Array.isArray(spec.functions) ? [...spec.functions] : [],
    variables: Array.isArray(spec.variables) ? [...spec.variables] : [],
    callEdges: Array.isArray(spec.callEdges) ? [...spec.callEdges] : [],
    includeEdges: Array.isArray(spec.includeEdges) ? [...spec.includeEdges] : [],
    readEdges: Array.isArray(spec.readEdges) ? [...spec.readEdges] : [],
    writeEdges: Array.isArray(spec.writeEdges) ? [...spec.writeEdges] : [],
    conditions: Array.isArray(spec.conditions) ? [...spec.conditions] : [],
    tasks: Array.isArray(spec.tasks) ? [...spec.tasks] : [],
    metadata: spec.metadata && typeof spec.metadata === 'object' ? { ...spec.metadata } : {},
  }
}

/**
 * Builds a canonical ProgramModel from a Keil project map DTO.
 * Guarantees stable IDs (file:..., fn:..., inc:...) and complete backwards compatibility.
 *
 * @param {any} keilMap
 * @param {{ workspaceCwd?: string }} [options]
 * @returns {import('../../types/program.d.ts').ProgramModel}
 */
export function buildProgramModelFromKeilMap(keilMap, options = {}) {
  const mapObj = keilMap && typeof keilMap === 'object' ? keilMap : {}
  const project = typeof mapObj.project === 'string' ? mapObj.project : ''
  const target = typeof mapObj.target === 'string' ? mapObj.target : ''

  /** @type {import('../../types/program.d.ts').ProgramFile[]} */
  const files = []
  /** @type {import('../../types/program.d.ts').ProgramFunction[]} */
  const functions = []
  /** @type {import('../../types/program.d.ts').ProgramIncludeEdge[]} */
  const includeEdges = []

  const seenFileIds = new Set()
  const seenFunctionIds = new Set()
  const seenIncludeEdgeIds = new Set()

  const groups = Array.isArray(mapObj.groups) ? mapObj.groups : []
  for (const group of groups) {
    const groupName = typeof group?.name === 'string' ? group.name : ''
    const gFiles = Array.isArray(group?.files) ? group.files : []

    for (const f of gFiles) {
      const rel = typeof f?.rel === 'string' ? normalizeRelPath(f.rel) : ''
      const name = typeof f?.name === 'string' ? f.name : ''
      const fileIdentifier = rel || name
      if (!fileIdentifier) continue

      const fId = makeFileId(fileIdentifier)
      if (!seenFileIds.has(fId)) {
        seenFileIds.add(fId)
        const fileFunctions = Array.isArray(f?.functions) ? f.functions : []
        files.push({
          id: fId,
          name: name || fileIdentifier,
          rel: rel || fileIdentifier,
          kind: typeof f?.kind === 'string' ? f.kind : 'other',
          group: groupName,
          inside: Boolean(f?.inside),
          exists: Boolean(f?.exists),
          readable: Boolean(f?.readable),
          reason: typeof f?.reason === 'string' ? f.reason : '',
          functionCount: fileFunctions.length,
        })

        for (const fn of fileFunctions) {
          const fnName = typeof fn?.name === 'string' ? fn.name : ''
          const line = Number(fn?.line) || 1
          if (!fnName) continue

          const fnId = makeFunctionId(fileIdentifier, fnName, line)
          if (!seenFunctionIds.has(fnId)) {
            seenFunctionIds.add(fnId)
            functions.push({
              id: fnId,
              fileId: fId,
              name: fnName,
              line,
            })
          }
        }
      }
    }
  }

  const rawIncludeEdges = Array.isArray(mapObj.include_edges) ? mapObj.include_edges : []
  for (const e of rawIncludeEdges) {
    const fromRel = typeof e?.from === 'string' ? normalizeRelPath(e.from) : ''
    const toRel = typeof e?.to === 'string' ? normalizeRelPath(e.to) : ''
    const headerName = typeof e?.name === 'string' ? e.name : ''
    if (!fromRel) continue

    const fromFileId = makeFileId(fromRel)
    const toFileId = toRel ? makeFileId(toRel) : undefined
    const edgeId = makeIncludeEdgeId(fromRel, toRel || headerName)

    if (!seenIncludeEdgeIds.has(edgeId)) {
      seenIncludeEdgeIds.add(edgeId)
      includeEdges.push({
        id: edgeId,
        fromFileId,
        toFileId,
        headerName,
        resolved: Boolean(e?.resolved),
        confidence: e?.resolved ? 'exact' : 'unresolved',
      })
    }
  }

  return createProgramModel({
    project,
    target,
    files,
    functions,
    variables: [],
    callEdges: [],
    includeEdges,
    readEdges: [],
    writeEdges: [],
    conditions: [],
    tasks: [],
    metadata: {
      includes: Array.isArray(mapObj.includes) ? mapObj.includes : [],
      defines: Array.isArray(mapObj.defines) ? mapObj.defines : [],
      truncated: mapObj.truncated || {},
      limits: mapObj.limits || {},
      counts: mapObj.counts || {
        groups: groups.length,
        files: files.length,
        functions: functions.length,
        includeEdges: includeEdges.length,
      },
      builtFrom: 'keilMap',
      builtAt: Date.now(),
      workspaceCwd: options.workspaceCwd || '',
    },
  })
}

/**
 * Look up a file by its ID.
 * @param {import('../../types/program.d.ts').ProgramModel} model
 * @param {string} fileId
 * @returns {import('../../types/program.d.ts').ProgramFile | undefined}
 */
export function findFileById(model, fileId) {
  return model.files.find((f) => f.id === fileId)
}

/**
 * Look up a file by relative path.
 * @param {import('../../types/program.d.ts').ProgramModel} model
 * @param {string} relPath
 * @returns {import('../../types/program.d.ts').ProgramFile | undefined}
 */
export function findFileByPath(model, relPath) {
  const norm = normalizeRelPath(relPath)
  return model.files.find((f) => normalizeRelPath(f.rel) === norm || f.name === norm)
}

/**
 * Look up a function by its ID.
 * @param {import('../../types/program.d.ts').ProgramModel} model
 * @param {string} functionId
 * @returns {import('../../types/program.d.ts').ProgramFunction | undefined}
 */
export function findFunctionById(model, functionId) {
  return model.functions.find((fn) => fn.id === functionId)
}

/**
 * Look up all functions with a given name.
 * @param {import('../../types/program.d.ts').ProgramModel} model
 * @param {string} name
 * @returns {import('../../types/program.d.ts').ProgramFunction[]}
 */
export function findFunctionsByName(model, name) {
  return model.functions.filter((fn) => fn.name === name)
}

/**
 * Get all functions defined within a given file.
 * @param {import('../../types/program.d.ts').ProgramModel} model
 * @param {string} fileId
 * @returns {import('../../types/program.d.ts').ProgramFunction[]}
 */
export function findFunctionsInFile(model, fileId) {
  return model.functions.filter((fn) => fn.fileId === fileId)
}

/**
 * Look up a variable by its ID.
 * @param {import('../../types/program.d.ts').ProgramModel} model
 * @param {string} variableId
 * @returns {import('../../types/program.d.ts').ProgramVariable | undefined}
 */
export function findVariableById(model, variableId) {
  return model.variables.find((v) => v.id === variableId)
}

/**
 * Get all call edges originating from a caller function.
 * @param {import('../../types/program.d.ts').ProgramModel} model
 * @param {string} callerId
 * @returns {import('../../types/program.d.ts').ProgramCallEdge[]}
 */
export function getCallsFrom(model, callerId) {
  return model.callEdges.filter((e) => e.callerId === callerId)
}

/**
 * Get all call edges pointing to a callee function.
 * @param {import('../../types/program.d.ts').ProgramModel} model
 * @param {string} calleeId
 * @returns {import('../../types/program.d.ts').ProgramCallEdge[]}
 */
export function getCallsTo(model, calleeId) {
  return model.callEdges.filter((e) => e.calleeId === calleeId)
}

/**
 * Get all include edges from a source file.
 * @param {import('../../types/program.d.ts').ProgramModel} model
 * @param {string} fileId
 * @returns {import('../../types/program.d.ts').ProgramIncludeEdge[]}
 */
export function getIncludeEdgesFrom(model, fileId) {
  return model.includeEdges.filter((e) => e.fromFileId === fileId)
}

/**
 * Get all include edges to a target header file.
 * @param {import('../../types/program.d.ts').ProgramModel} model
 * @param {string} fileId
 * @returns {import('../../types/program.d.ts').ProgramIncludeEdge[]}
 */
export function getIncludeEdgesTo(model, fileId) {
  return model.includeEdges.filter((e) => e.toFileId === fileId)
}

/**
 * Get all read edges for a function or accessor.
 * @param {import('../../types/program.d.ts').ProgramModel} model
 * @param {string} accessorId
 * @returns {import('../../types/program.d.ts').ProgramDataEdge[]}
 */
export function getReadsBy(model, accessorId) {
  return model.readEdges.filter((e) => e.accessorId === accessorId)
}

/**
 * Get all write edges for a function or accessor.
 * @param {import('../../types/program.d.ts').ProgramModel} model
 * @param {string} accessorId
 * @returns {import('../../types/program.d.ts').ProgramDataEdge[]}
 */
export function getWritesBy(model, accessorId) {
  return model.writeEdges.filter((e) => e.accessorId === accessorId)
}

/**
 * Get all write edges targeting a specific variable.
 * @param {import('../../types/program.d.ts').ProgramModel} model
 * @param {string} variableId
 * @returns {import('../../types/program.d.ts').ProgramDataEdge[]}
 */
export function getWritersOf(model, variableId) {
  return model.writeEdges.filter((e) => e.variableId === variableId)
}

/**
 * Get all read edges targeting a specific variable.
 * @param {import('../../types/program.d.ts').ProgramModel} model
 * @param {string} variableId
 * @returns {import('../../types/program.d.ts').ProgramDataEdge[]}
 */
export function getReadersOf(model, variableId) {
  return model.readEdges.filter((e) => e.variableId === variableId)
}

/**
 * Get all condition expressions inside a function.
 * @param {import('../../types/program.d.ts').ProgramModel} model
 * @param {string} functionId
 * @returns {import('../../types/program.d.ts').ProgramCondition[]}
 */
export function getConditionsIn(model, functionId) {
  return model.conditions.filter((c) => c.functionId === functionId)
}

/**
 * Validates a ProgramModel structure.
 * @param {any} model
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateProgramModel(model) {
  const errors = []
  if (!model || typeof model !== 'object') {
    return { valid: false, errors: ['ProgramModel 必须是一个对象'] }
  }

  if (typeof model.project !== 'string') errors.push('project 必须是字符串')
  if (typeof model.target !== 'string') errors.push('target 必须是字符串')
  if (!Array.isArray(model.files)) errors.push('files 必须是数组')
  if (!Array.isArray(model.functions)) errors.push('functions 必须是数组')
  if (!Array.isArray(model.variables)) errors.push('variables 必须是数组')
  if (!Array.isArray(model.callEdges)) errors.push('callEdges 必须是数组')
  if (!Array.isArray(model.includeEdges)) errors.push('includeEdges 必须是数组')
  if (!Array.isArray(model.readEdges)) errors.push('readEdges 必须是数组')
  if (!Array.isArray(model.writeEdges)) errors.push('writeEdges 必须是数组')
  if (!Array.isArray(model.conditions)) errors.push('conditions 必须是数组')
  if (!Array.isArray(model.tasks)) errors.push('tasks 必须是数组')

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Exports a compact summary of the ProgramModel suitable for agent or inspection.
 * @param {import('../../types/program.d.ts').ProgramModel} model
 * @returns {Record<string, any>}
 */
export function exportProgramModelSummary(model) {
  return {
    project: model.project,
    target: model.target,
    fileCount: model.files.length,
    functionCount: model.functions.length,
    variableCount: model.variables.length,
    callEdgeCount: model.callEdges.length,
    includeEdgeCount: model.includeEdges.length,
    readEdgeCount: model.readEdges.length,
    writeEdgeCount: model.writeEdges.length,
    conditionCount: model.conditions.length,
    taskCount: model.tasks.length,
  }
}
