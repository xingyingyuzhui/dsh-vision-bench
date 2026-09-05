// @ts-check

import {
  C_KEYWORDS,
  analyzeCSourceHeuristic,
  resolveModelReferences,
  sanitizeCSource,
} from './heuristic-c-source-analyzer.mjs'
import { analyzeCSourceWithAst } from './tree-sitter-c-analyzer.mjs'

export { C_KEYWORDS, analyzeCSourceHeuristic, analyzeCSourceWithAst, resolveModelReferences, sanitizeCSource }

/**
 * Parses C source code and extracts functions, variables, call edges,
 * read/write data edges, conditions, and include directives.
 *
 * Defaults to AST-based analysis (`confidence: 'ast'`).
 * Falls back to heuristic regex-based analysis (`confidence: 'heuristic'`)
 * if AST parsing fails or if options.parser === 'heuristic'.
 *
 * @param {string} rawSource
 * @param {string} fileRelPath
 * @param {{ parser?: 'ast' | 'heuristic' }} [options]
 * @returns {{
 *   file: import('../../types/program.d.ts').ProgramFile,
 *   functions: import('../../types/program.d.ts').ProgramFunction[],
 *   variables: import('../../types/program.d.ts').ProgramVariable[],
 *   callEdges: import('../../types/program.d.ts').ProgramCallEdge[],
 *   includeEdges: import('../../types/program.d.ts').ProgramIncludeEdge[],
 *   readEdges: import('../../types/program.d.ts').ProgramDataEdge[],
 *   writeEdges: import('../../types/program.d.ts').ProgramDataEdge[],
 *   conditions: import('../../types/program.d.ts').ProgramCondition[],
 * }}
 */
export function analyzeCSource(rawSource, fileRelPath, options = {}) {
  if (options.parser === 'heuristic') {
    return analyzeCSourceHeuristic(rawSource, fileRelPath)
  }

  try {
    return analyzeCSourceWithAst(rawSource, fileRelPath)
  } catch {
    return analyzeCSourceHeuristic(rawSource, fileRelPath)
  }
}
