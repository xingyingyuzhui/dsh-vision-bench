// @ts-check

import { makeFileId } from '../../domain/program/program-model.mjs'

/**
 * Resolves references across a ProgramModel, promoting 'heuristic' or 'ast' confidence
 * to 'symbol-resolved' (or 'exact' if exact match) when target symbols/variables exist in the model.
 *
 * @param {import('../../types/program.d.ts').ProgramModel} model
 * @param {{ resolvedConfidence?: import('../../types/program.d.ts').ConfidenceLevel }} [options]
 */
export function resolveModelReferences(model, options = {}) {
  const resolvedConf = options.resolvedConfidence || 'exact'

  // Map function names to their IDs
  /** @type {Map<string, string[]>} */
  const fnNameToIds = new Map()
  for (const fn of model.functions) {
    const list = fnNameToIds.get(fn.name) || []
    list.push(fn.id)
    fnNameToIds.set(fn.name, list)
  }

  // Map variable names to their IDs
  /** @type {Map<string, string[]>} */
  const varNameToIds = new Map()
  for (const v of model.variables) {
    const list = varNameToIds.get(v.name) || []
    list.push(v.id)
    varNameToIds.set(v.name, list)
  }

  const fnById = new Map(model.functions.map((f) => [f.id, f]))
  const varById = new Map(model.variables.map((v) => [v.id, v]))

  // Resolve call edges
  for (const edge of model.callEdges) {
    const matchingFns = fnNameToIds.get(edge.calleeName)
    if (matchingFns && matchingFns.length > 0) {
      const callerFn = fnById.get(edge.callerId)
      const callerFileId = callerFn?.fileId || (edge.location?.file ? makeFileId(edge.location.file) : null)
      let chosenId = matchingFns[0]
      if (callerFileId && matchingFns.length > 1) {
        const localMatch = matchingFns.find((id) => {
          const fn = fnById.get(id)
          return fn && fn.fileId === callerFileId
        })
        if (localMatch) chosenId = localMatch
      }
      edge.calleeId = chosenId
      edge.confidence = resolvedConf
    } else {
      edge.confidence = 'unresolved'
    }
  }

  // Resolve read & write data edges
  for (const edge of [...model.readEdges, ...model.writeEdges]) {
    const baseVarName = edge.variableName.split(/\.|->/)[0]
    const matchingVars = varNameToIds.get(baseVarName)
    if (matchingVars && matchingVars.length > 0) {
      const accessorFn = fnById.get(edge.accessorId)
      const callerFileId = accessorFn?.fileId || (edge.location?.file ? makeFileId(edge.location.file) : null)
      let chosenId = matchingVars[0]
      if (callerFileId && matchingVars.length > 1) {
        const localMatch = matchingVars.find((id) => {
          const v = varById.get(id)
          return v && v.fileId === callerFileId
        })
        if (localMatch) chosenId = localMatch
      }
      edge.variableId = chosenId
      edge.confidence = resolvedConf
    }
  }

  // Resolve include edges to known files
  const fileIdSet = new Set(model.files.map((f) => f.id))
  for (const inc of model.includeEdges) {
    if (inc.toFileId && fileIdSet.has(inc.toFileId)) {
      inc.resolved = true
      inc.confidence = 'exact'
    }
  }
}
