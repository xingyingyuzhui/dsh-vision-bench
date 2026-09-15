// @ts-check

/**
 * Lezer C/C++ AST analyzer facade.
 *
 * Split boundaries (P4-6):
 * - offset → location → lezer-c-location.mjs
 * - top-level vars → lezer-c-extract-vars.mjs
 * - function symbol + params → lezer-c-extract-function.mjs
 * - AST body traversal / edge assembly → lezer-c-walk-body.mjs
 *
 * Public exports stay on this path for compatibility.
 */

import { cppLanguage } from '@codemirror/lang-cpp'
import { makeFileId, makeIncludeEdgeId, normalizeRelPath } from '../../domain/program/program-model.mjs'
import { analyzeCSourceHeuristic } from './heuristic-c-source-analyzer.mjs'
import { extractFunctionDefinition } from './lezer-c-extract-function.mjs'
import { extractTopLevelVariableDeclarations } from './lezer-c-extract-vars.mjs'
import { createOffsetToLocation } from './lezer-c-location.mjs'

/**
 * Analyzes C source code using Lezer/Tree-sitter AST parsing.
 *
 * Extracts AST-accurate functions, variables, call edges, data edges (read/write),
 * condition statements, and preprocessor directives. All extracted edges and constructs
 * have `confidence: 'ast'`.
 *
 * If AST parsing encounters unexpected fatal errors, it gracefully falls back to
 * `analyzeCSourceHeuristic(rawSource, fileRelPath)`.
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
 *   metadata?: { preprocessors?: string[], parser: string, confidence: string, preprocessed: boolean },
 * }}
 */
export function analyzeCSourceWithLezer(rawSource, fileRelPath) {
  try {
    return parseWithLezerAst(rawSource, fileRelPath)
  } catch {
    return analyzeCSourceHeuristic(rawSource, fileRelPath)
  }
}

/** Backward compatibility alias for analyzeCSourceWithLezer. */
export const analyzeCSourceWithAst = analyzeCSourceWithLezer

/**
 * @param {string} rawSource
 * @param {string} fileRelPath
 */
function parseWithLezerAst(rawSource, fileRelPath) {
  const normRel = normalizeRelPath(fileRelPath)
  const fileId = makeFileId(normRel)
  const toLocation = createOffsetToLocation(rawSource)

  const tree = cppLanguage.parser.parse(rawSource)

  /** @type {import('../../types/program.d.ts').ProgramFunction[]} */
  const functions = []
  /** @type {import('../../types/program.d.ts').ProgramVariable[]} */
  const variables = []
  /** @type {import('../../types/program.d.ts').ProgramCallEdge[]} */
  const callEdges = []
  /** @type {import('../../types/program.d.ts').ProgramIncludeEdge[]} */
  const includeEdges = []
  /** @type {import('../../types/program.d.ts').ProgramDataEdge[]} */
  const readEdges = []
  /** @type {import('../../types/program.d.ts').ProgramDataEdge[]} */
  const writeEdges = []
  /** @type {import('../../types/program.d.ts').ProgramCondition[]} */
  const conditions = []
  /** @type {string[]} */
  const preprocessors = []

  const seenIncludeHeaders = new Set()
  const seenFunctionIds = new Set()
  const seenVariableIds = new Set()
  const seenCallEdgeIds = new Set()
  const seenReadEdgeIds = new Set()
  const seenWriteEdgeIds = new Set()
  const seenConditionIds = new Set()

  const cursor = tree.cursor()

  if (cursor.firstChild()) {
    do {
      const nodeName = cursor.name
      const from = cursor.from
      const to = cursor.to
      const text = rawSource.slice(from, to)

      if (nodeName === 'PreprocDirective') {
        const trimmed = text.trim()
        preprocessors.push(trimmed)

        const incMatch = /^[ \t]*#[ \t]*include[ \t]+[<"]([^>"]+)[>"]/.exec(trimmed)
        if (incMatch) {
          const headerName = incMatch[1].trim().replaceAll('\\', '/')
          if (headerName && !seenIncludeHeaders.has(headerName)) {
            seenIncludeHeaders.add(headerName)
            includeEdges.push({
              id: makeIncludeEdgeId(normRel, headerName),
              fromFileId: fileId,
              headerName,
              resolved: false,
              confidence: 'unresolved',
            })
          }
        }
      }

      if (nodeName === 'Declaration') {
        extractTopLevelVariableDeclarations({
          cursor,
          rawSource,
          fileId,
          toLocation,
          variables,
          seenVariableIds,
        })
      }

      if (nodeName === 'FunctionDefinition') {
        extractFunctionDefinition({
          cursor,
          rawSource,
          normRel,
          fileId,
          toLocation,
          functions,
          callEdges,
          readEdges,
          writeEdges,
          conditions,
          seenFunctionIds,
          seenCallEdgeIds,
          seenReadEdgeIds,
          seenWriteEdgeIds,
          seenConditionIds,
        })
      }
    } while (cursor.nextSibling())
  }

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
      parser: 'lezer-cpp',
      confidence: 'ast',
      preprocessed: false,
      preprocessors,
    },
  }
}
