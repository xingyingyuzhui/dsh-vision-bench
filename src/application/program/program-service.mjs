// @ts-check

import { resolve } from 'node:path'
import {
  buildProgramModelFromKeilMap,
  createProgramModel,
  makeFileId,
  normalizeRelPath,
} from '../../domain/program/program-model.mjs'
import { programModelToArchify } from '../../infrastructure/archify/archify-adapter.mjs'
import { checkFileReadable, isInside, readSource } from '../../infrastructure/keil/keil-project-scanner.mjs'
import { analyzeCSource, resolveModelReferences } from '../../infrastructure/program/c-source-analyzer.mjs'
import { mapProject } from '../keil/project-service.mjs'

/**
 * Creates the ProgramService application service for generating and querying
 * canonical ProgramModel instances with parser-backed call and data graphs.
 *
 * @param {{
 *   mapProjectFn?: typeof mapProject,
 *   readSourceFn?: typeof readSource,
 *   checkFileReadableFn?: typeof checkFileReadable,
 * }} [deps]
 */
export function createProgramService(deps = {}) {
  const doMapProject = deps.mapProjectFn || mapProject
  const doReadSource = deps.readSourceFn || readSource
  const doCheckFileReadable =
    deps.checkFileReadableFn ||
    (deps.readSourceFn ? async () => /** @type {[boolean, any]} */ ([true, 'ok']) : checkFileReadable)

  /** @type {Map<string, { model: import('../../types/program.d.ts').ProgramModel, timestamp: number }>} */
  const modelCache = new Map()

  /**
   * Loads and builds a full canonical ProgramModel for a Keil project and target,
   * enriched with parser-backed function calls, assignments, reads/writes, and conditions.
   *
   * @param {string} workspaceCwd
   * @param {string} projectPath
   * @param {string} [target]
   * @param {{ maxFiles?: number, forceRefresh?: boolean }} [options]
   * @returns {Promise<import('../../types/program.d.ts').ProgramModel>}
   */
  async function loadProgramModel(workspaceCwd, projectPath, target = '', options = {}) {
    const cacheKey = `${normalizeRelPath(workspaceCwd)}::${normalizeRelPath(projectPath)}::${target}`
    if (!options.forceRefresh && modelCache.has(cacheKey)) {
      const entry = modelCache.get(cacheKey)
      if (entry && Date.now() - entry.timestamp < 30000) {
        return entry.model
      }
    }

    // 1. Get base project structure from Keil map
    const keilMap = await doMapProject(projectPath, target, workspaceCwd, options)
    const model = buildProgramModelFromKeilMap(keilMap, { workspaceCwd })

    // Track sets for deduplicating symbols and edges
    const seenFunctionIds = new Set(model.functions.map((fn) => fn.id))
    const seenVariableIds = new Set()
    const seenCallEdgeIds = new Set()
    const seenReadEdgeIds = new Set()
    const seenWriteEdgeIds = new Set()
    const seenConditionIds = new Set()

    // 2. Enrich C source files with parser-backed analysis
    for (const file of model.files) {
      if (file.kind !== 'c' || !file.inside) continue

      const absPath = resolve(workspaceCwd, file.rel)
      if (!isInside(workspaceCwd, absPath)) continue

      try {
        const [readable] = await doCheckFileReadable(absPath)
        if (!readable) continue

        const source = await doReadSource(absPath)
        const analysis = analyzeCSource(source, file.rel)

        // Merge functions (enrich with exact line spans and attributes from parser)
        for (const fn of analysis.functions) {
          const existing = model.functions.find((f) => f.fileId === file.id && f.name === fn.name)
          if (existing) {
            existing.id = fn.id
            existing.line = fn.line
            existing.endLine = fn.endLine
            existing.isStatic = fn.isStatic
            existing.isInterrupt = fn.isInterrupt
            seenFunctionIds.add(fn.id)
          } else if (!seenFunctionIds.has(fn.id)) {
            seenFunctionIds.add(fn.id)
            model.functions.push(fn)
          }
        }

        // Merge variables
        for (const v of analysis.variables) {
          if (!seenVariableIds.has(v.id)) {
            seenVariableIds.add(v.id)
            model.variables.push(v)
          }
        }

        // Merge call edges
        for (const edge of analysis.callEdges) {
          if (!seenCallEdgeIds.has(edge.id)) {
            seenCallEdgeIds.add(edge.id)
            model.callEdges.push(edge)
          }
        }

        // Merge read data edges
        for (const edge of analysis.readEdges) {
          if (!seenReadEdgeIds.has(edge.id)) {
            seenReadEdgeIds.add(edge.id)
            model.readEdges.push(edge)
          }
        }

        // Merge write data edges
        for (const edge of analysis.writeEdges) {
          if (!seenWriteEdgeIds.has(edge.id)) {
            seenWriteEdgeIds.add(edge.id)
            model.writeEdges.push(edge)
          }
        }

        // Merge conditions
        for (const cond of analysis.conditions) {
          if (!seenConditionIds.has(cond.id)) {
            seenConditionIds.add(cond.id)
            model.conditions.push(cond)
          }
        }
      } catch {
        // Resilient fallback: individual file analysis error must never crash the service
      }
    }

    // 3. Cross-resolve references (call callees, variable read/write targets)
    resolveModelReferences(model)

    // 4. Update metadata stats
    model.metadata = {
      ...model.metadata,
      analyzedAt: Date.now(),
      counts: {
        ...model.metadata?.counts,
        files: model.files.length,
        functions: model.functions.length,
        variables: model.variables.length,
        callEdges: model.callEdges.length,
        readEdges: model.readEdges.length,
        writeEdges: model.writeEdges.length,
        conditions: model.conditions.length,
      },
    }

    modelCache.set(cacheKey, { model, timestamp: Date.now() })
    return model
  }

  /**
   * Filter program graph nodes and edges around a focus function or file.
   *
   * @param {import('../../types/program.d.ts').ProgramModel} model
   * @param {{
   *   functionId?: string,
   *   fileId?: string,
   *   includeDataEdges?: boolean,
   *   includeCalls?: boolean,
   *   includeConditions?: boolean,
   * }} [query]
   */
  function filterProgramGraph(model, query = {}) {
    const includeCalls = query.includeCalls !== false
    const includeData = query.includeDataEdges !== false
    const includeConditions = query.includeConditions !== false

    let activeFunctionIds = new Set(model.functions.map((fn) => fn.id))
    let activeVariableIds = new Set(model.variables.map((v) => v.id))

    if (query.fileId) {
      const fileFns = model.functions.filter((fn) => fn.fileId === query.fileId)
      activeFunctionIds = new Set(fileFns.map((fn) => fn.id))
      const fileVars = model.variables.filter((v) => v.fileId === query.fileId)
      activeVariableIds = new Set(fileVars.map((v) => v.id))
    }

    if (query.functionId) {
      const focusFnId = query.functionId
      const relatedFnIds = new Set([focusFnId])

      // 1-hop calls out and calls in
      for (const call of model.callEdges) {
        if (call.callerId === focusFnId && call.calleeId) relatedFnIds.add(call.calleeId)
        if (call.calleeId === focusFnId) relatedFnIds.add(call.callerId)
      }
      activeFunctionIds = relatedFnIds

      // Related variables read/written by focus function
      const relatedVarIds = new Set()
      for (const edge of [...model.readEdges, ...model.writeEdges]) {
        if (edge.accessorId === focusFnId && edge.variableId) {
          relatedVarIds.add(edge.variableId)
        }
      }
      activeVariableIds = relatedVarIds
    }

    const filteredFunctions = model.functions.filter((fn) => activeFunctionIds.has(fn.id))
    const filteredVariables = model.variables.filter((v) => activeVariableIds.has(v.id))
    const filteredCallEdges = includeCalls
      ? model.callEdges.filter(
          (edge) => activeFunctionIds.has(edge.callerId) && (!edge.calleeId || activeFunctionIds.has(edge.calleeId)),
        )
      : []
    const filteredReadEdges = includeData
      ? model.readEdges.filter(
          (edge) =>
            activeFunctionIds.has(edge.accessorId) && (!edge.variableId || activeVariableIds.has(edge.variableId)),
        )
      : []
    const filteredWriteEdges = includeData
      ? model.writeEdges.filter(
          (edge) =>
            activeFunctionIds.has(edge.accessorId) && (!edge.variableId || activeVariableIds.has(edge.variableId)),
        )
      : []
    const filteredConditions = includeConditions
      ? model.conditions.filter((cond) => activeFunctionIds.has(cond.functionId))
      : []

    return {
      functions: filteredFunctions,
      variables: filteredVariables,
      callEdges: filteredCallEdges,
      readEdges: filteredReadEdges,
      writeEdges: filteredWriteEdges,
      conditions: filteredConditions,
    }
  }

  function clearCache() {
    modelCache.clear()
  }

  return {
    loadProgramModel,
    filterProgramGraph,
    exportArchifyIR: (
      /** @type {import('../../types/program.d.ts').ProgramModel} */ model,
      /** @type {any} */ options,
    ) => programModelToArchify(model, options),
    clearCache,
  }
}
