// @ts-check

import { normalizeRelPath } from '../../domain/program/program-model.mjs'

/**
 * Correlates a runtime debug location (file, line, function) to corresponding
 * ProgramModel nodes, callers, callees, variable dependencies, and nearest conditions.
 *
 * @param {import('../../types/program.d.ts').ProgramModel} model
 * @param {{
 *   file: string,
 *   line?: number,
 *   function?: string,
 *   maxConditions?: number,
 * }} query
 * @returns {{
 *   functionNodeId: string | null,
 *   functionName: string | null,
 *   variableNodeIds: string[],
 *   nearestConditions: import('../../types/program.d.ts').ProgramCondition[],
 *   callers: Array<{ id: string, name: string, location?: import('../../types/program.d.ts').ProgramLocation }>,
 *   callees: Array<{ id?: string, name: string, location?: import('../../types/program.d.ts').ProgramLocation }>,
 *   confidence: import('../../types/program.d.ts').ConfidenceLevel,
 * }}
 */
export function correlateRuntimeLocation(model, query) {
  const normQueryFile = normalizeRelPath(query.file || '')
  const queryLine = typeof query.line === 'number' ? query.line : 0
  const queryFnName = typeof query.function === 'string' ? query.function.trim() : ''
  const maxConditions = query.maxConditions || 5

  // 1. Locate file node in model
  let matchedFile = model.files?.find((f) => normalizeRelPath(f.rel) === normQueryFile)
  if (!matchedFile && normQueryFile) {
    // Fallback: match by basename or partial suffix
    const queryBase = normQueryFile.split('/').pop()
    matchedFile = model.files?.find((f) => f.name === queryBase || normalizeRelPath(f.rel).endsWith(`/${queryBase}`))
  }

  // 2. Locate function in model
  let matchedFn = null
  const candidateFns = matchedFile
    ? (model.functions || []).filter((f) => f.fileId === matchedFile.id)
    : model.functions || []

  if (queryFnName) {
    // Exact name match
    const byName = candidateFns.filter((f) => f.name === queryFnName)
    if (byName.length === 1) {
      matchedFn = byName[0]
    } else if (byName.length > 1 && queryLine > 0) {
      // Pick the one enclosing or closest to line
      matchedFn = byName.find((f) => queryLine >= f.line && queryLine <= (f.endLine || f.line)) || byName[0]
    }
  }

  // If no function found by name, try finding by line span
  if (!matchedFn && queryLine > 0 && candidateFns.length > 0) {
    matchedFn = candidateFns.find((f) => queryLine >= f.line && queryLine <= (f.endLine || f.line))
    if (!matchedFn) {
      // Fallback: the latest function starting before queryLine
      const beforeLine = candidateFns.filter((f) => f.line <= queryLine).sort((a, b) => b.line - a.line)
      if (beforeLine.length > 0) {
        matchedFn = beforeLine[0]
      }
    }
  }

  const fnNodeId = matchedFn ? matchedFn.id : null
  const fnName = matchedFn ? matchedFn.name : queryFnName || null

  // 3. Find callers and callees
  /** @type {Array<{ id: string, name: string, location?: import('../../types/program.d.ts').ProgramLocation }>} */
  const callers = []
  /** @type {Array<{ id?: string, name: string, location?: import('../../types/program.d.ts').ProgramLocation }>} */
  const callees = []

  const fnMap = new Map((model.functions || []).map((f) => [f.id, f]))

  if (fnNodeId) {
    // Callers: call edges whose target is this function
    const callerEdges = (model.callEdges || []).filter(
      (e) => e.calleeId === fnNodeId || (fnName && e.calleeName === fnName),
    )
    const seenCallerIds = new Set()
    for (const edge of callerEdges) {
      if (!seenCallerIds.has(edge.callerId)) {
        seenCallerIds.add(edge.callerId)
        const callerFn = fnMap.get(edge.callerId)
        callers.push({
          id: edge.callerId,
          name: callerFn ? callerFn.name : edge.callerId,
          location: edge.location,
        })
      }
    }

    // Callees: call edges made from this function
    const calleeEdges = (model.callEdges || []).filter((e) => e.callerId === fnNodeId)
    const seenCalleeKeys = new Set()
    for (const edge of calleeEdges) {
      const key = `${edge.calleeId || ''}:${edge.calleeName}`
      if (!seenCalleeKeys.has(key)) {
        seenCalleeKeys.add(key)
        callees.push({
          id: edge.calleeId,
          name: edge.calleeName,
          location: edge.location,
        })
      }
    }
  }

  // 4. Find correlated variable node IDs
  const varIds = new Set()
  if (fnNodeId) {
    // Reads & writes in this function
    for (const edge of [...(model.readEdges || []), ...(model.writeEdges || [])]) {
      if (edge.accessorId === fnNodeId && edge.variableId) {
        varIds.add(edge.variableId)
      }
    }
  }

  // If line is given, add variables declared or accessed right at that line
  if (queryLine > 0) {
    for (const v of model.variables || []) {
      if (matchedFile && v.fileId === matchedFile.id && v.line === queryLine) {
        varIds.add(v.id)
      }
    }
    for (const edge of [...(model.readEdges || []), ...(model.writeEdges || [])]) {
      if (edge.location?.line === queryLine && edge.variableId) {
        varIds.add(edge.variableId)
      }
    }
  }

  // 5. Find nearest conditions
  /** @type {import('../../types/program.d.ts').ProgramCondition[]} */
  let nearestConditions = []
  if (fnNodeId) {
    const fnConds = (model.conditions || []).filter((c) => c.functionId === fnNodeId)
    if (queryLine > 0) {
      nearestConditions = [...fnConds].sort(
        (a, b) => Math.abs(a.location.line - queryLine) - Math.abs(b.location.line - queryLine),
      )
    } else {
      nearestConditions = fnConds
    }
  } else if (matchedFile) {
    // Match conditions in the same file
    const fileConds = (model.conditions || []).filter((c) =>
      normalizeRelPath(c.location.file).endsWith(matchedFile.rel),
    )
    if (queryLine > 0) {
      nearestConditions = [...fileConds].sort(
        (a, b) => Math.abs(a.location.line - queryLine) - Math.abs(b.location.line - queryLine),
      )
    } else {
      nearestConditions = fileConds
    }
  }

  nearestConditions = nearestConditions.slice(0, maxConditions)

  // Determine overall correlation confidence
  let confidence = /** @type {import('../../types/program.d.ts').ConfidenceLevel} */ ('unresolved')
  if (matchedFn && matchedFile) {
    confidence = 'exact'
  } else if (matchedFn || matchedFile) {
    confidence = 'heuristic'
  }

  return {
    functionNodeId: fnNodeId,
    functionName: fnName,
    variableNodeIds: Array.from(varIds),
    nearestConditions,
    callers,
    callees,
    confidence,
  }
}

/**
 * Creates the RuntimeCorrelationService application service.
 *
 * @param {{
 *   programService?: { loadProgramModel: (...args: any[]) => Promise<import('../../types/program.d.ts').ProgramModel> }
 * }} [deps]
 */
export function createRuntimeCorrelationService(deps = {}) {
  return {
    /**
     * Correlates a runtime execution location with nodes in a loaded ProgramModel.
     *
     * @param {import('../../types/program.d.ts').ProgramModel} model
     * @param {{ file: string, line?: number, function?: string, maxConditions?: number }} query
     */
    correlate: (model, query) => correlateRuntimeLocation(model, query),

    /**
     * Convenience method to load a program model and correlate the location in one step.
     *
     * @param {string} workspaceCwd
     * @param {string} projectPath
     * @param {string} target
     * @param {{ file: string, line?: number, function?: string }} query
     */
    async correlateFromProject(workspaceCwd, projectPath, target, query) {
      if (!deps.programService) {
        throw new Error('RuntimeCorrelationService requires programService dependency')
      }
      const model = await deps.programService.loadProgramModel(workspaceCwd, projectPath, target)
      return correlateRuntimeLocation(model, query)
    },
  }
}
