// @ts-check

/**
 * Heuristic C analyzer facade.
 *
 * Split boundaries (P4-6):
 * - tokenization / sanitize → heuristic-c-sanitize.mjs
 * - keywords → c-source-keywords.mjs
 * - symbol extraction → heuristic-c-extract-symbols.mjs
 * - body edge assembly → heuristic-c-extract-edges.mjs
 * - cross-file reference resolve → program-reference-resolve.mjs
 *
 * Public exports stay on this path for compatibility.
 */

import { makeFileId, normalizeRelPath } from '../../domain/program/program-model.mjs'
import { extractHeuristicBodyEdges } from './heuristic-c-extract-edges.mjs'
import {
  extractHeuristicFunctions,
  extractHeuristicIncludes,
  extractHeuristicVariables,
} from './heuristic-c-extract-symbols.mjs'
import { sanitizeCSource } from './heuristic-c-sanitize.mjs'

export { C_KEYWORDS } from './c-source-keywords.mjs'
export { sanitizeCSource } from './heuristic-c-sanitize.mjs'
export { resolveModelReferences } from './program-reference-resolve.mjs'

/**
 * Heuristically parses C source code using regular expressions and extracts functions, variables,
 * call edges, read/write data edges, conditions, and include directives.
 *
 * All extracted edges are explicitly tagged with `confidence: 'heuristic'`.
 *
 * @param {string} rawSource
 * @param {string} fileRelPath
 * @returns {{
 *   file: import('../../types/program.d.ts').ProgramFile,
 *   functions: import('../../types/program.d.ts').ProgramFunction[],
 *   variables: import('../../types/program.d.ts').ProgramVariable[],
 *   callEdges: import('../../types/program.d.ts').ProgramCallEdge[],
 *   includeEdges: import('../../types/program.d.ts').ProgramIncludeEdge[],
 *   readEdges: import('../../types/program.d.ts').ProgramDataEdge[],
 *   writeEdges: import('../../types/program.d.ts').ProgramDataEdge[],
 *   conditions: import('../../types/program.d.ts').ProgramCondition[],
 *   metadata?: { parser: string, confidence: string, preprocessed: boolean },
 * }}
 */
export function analyzeCSourceHeuristic(rawSource, fileRelPath) {
  const normRel = normalizeRelPath(fileRelPath)
  const fileId = makeFileId(normRel)

  const cleanSource = sanitizeCSource(rawSource)
  const lines = cleanSource.split('\n')

  const includeEdges = extractHeuristicIncludes(rawSource, normRel, fileId)
  const { functions, functionSpans } = extractHeuristicFunctions(lines, normRel, fileId)
  const variables = extractHeuristicVariables(lines, functionSpans, fileId)
  const { callEdges, readEdges, writeEdges, conditions } = extractHeuristicBodyEdges(
    lines,
    functionSpans,
    normRel,
  )

  return {
    file: {
      id: fileId,
      name: normRel.split('/').pop() || normRel,
      rel: normRel,
      kind: 'c',
      inside: true,
      exists: true,
      readable: true,
      functionCount: functions.length,
    },
    functions,
    variables,
    callEdges,
    includeEdges,
    readEdges,
    writeEdges,
    conditions,
    metadata: {
      parser: 'heuristic',
      confidence: 'heuristic',
      preprocessed: false,
    },
  }
}
