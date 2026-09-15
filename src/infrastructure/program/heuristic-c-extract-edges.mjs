// @ts-check

import {
  makeCallEdgeId,
  makeConditionId,
  makeDataEdgeId,
  makeFunctionId,
} from '../../domain/program/program-model.mjs'
import { C_KEYWORDS, CONDITION_KEYWORDS } from './c-source-keywords.mjs'
import { isDirective } from './heuristic-c-extract-symbols.mjs'

const CALL_EXPR_RE = /\b([a-zA-Z_]\w*)\s*\(/g
const ASSIGN_EXPR_RE = /\b([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*|->[a-zA-Z_]\w*)?)\s*([+\-*/%&|^]?=|\+\+|--)/g
const IDENTIFIER_RE = /\b([a-zA-Z_]\w*)\b/g

/**
 * Analyze function bodies for call / read / write edges and conditions.
 *
 * @param {string[]} lines
 * @param {Array<{ name: string, line: number, endLine: number }>} functionSpans
 * @param {string} normRel
 * @returns {{
 *   callEdges: import('../../types/program.d.ts').ProgramCallEdge[],
 *   readEdges: import('../../types/program.d.ts').ProgramDataEdge[],
 *   writeEdges: import('../../types/program.d.ts').ProgramDataEdge[],
 *   conditions: import('../../types/program.d.ts').ProgramCondition[],
 * }}
 */
export function extractHeuristicBodyEdges(lines, functionSpans, normRel) {
  /** @type {import('../../types/program.d.ts').ProgramCallEdge[]} */
  const callEdges = []
  /** @type {import('../../types/program.d.ts').ProgramDataEdge[]} */
  const readEdges = []
  /** @type {import('../../types/program.d.ts').ProgramDataEdge[]} */
  const writeEdges = []
  /** @type {import('../../types/program.d.ts').ProgramCondition[]} */
  const conditions = []

  for (const span of functionSpans) {
    const fnId = makeFunctionId(normRel, span.name, span.line)

    for (let lineIdx = span.line - 1; lineIdx < span.endLine && lineIdx < lines.length; lineIdx++) {
      let currentLine = lines[lineIdx]
      if (lineIdx === span.line - 1) {
        const braceIdx = currentLine.indexOf('{')
        currentLine = braceIdx >= 0 ? currentLine.slice(braceIdx + 1) : ''
      }
      const currentLineNum = lineIdx + 1
      const trimmed = currentLine.trim()
      if (!trimmed || isDirective(trimmed)) continue

      // a) Condition expressions
      for (const condKw of CONDITION_KEYWORDS) {
        const condPattern = new RegExp(`\\b${condKw}\\s*\\(([^)]+)\\)`, 'g')
        let condMatch = condPattern.exec(currentLine)
        while (condMatch !== null) {
          const condExpr = condMatch[1]
          const referencedVars = []
          let idMatch = IDENTIFIER_RE.exec(condExpr)
          while (idMatch !== null) {
            const ident = idMatch[1]
            if (!C_KEYWORDS.has(ident) && ident !== span.name) {
              referencedVars.push(ident)
            }
            idMatch = IDENTIFIER_RE.exec(condExpr)
          }

          conditions.push({
            id: makeConditionId(fnId, condKw, currentLineNum),
            functionId: fnId,
            type: /** @type {any} */ (condKw),
            referencedVariableIds: referencedVars,
            location: {
              file: normRel,
              line: currentLineNum,
            },
          })
          condMatch = condPattern.exec(currentLine)
        }
      }

      // b) Function calls (confidence: 'heuristic')
      CALL_EXPR_RE.lastIndex = 0
      let callMatch = CALL_EXPR_RE.exec(currentLine)
      while (callMatch !== null) {
        const callee = callMatch[1]
        if (!C_KEYWORDS.has(callee) && !CONDITION_KEYWORDS.has(callee)) {
          const edgeId = makeCallEdgeId(fnId, callee, currentLineNum)
          callEdges.push({
            id: edgeId,
            callerId: fnId,
            calleeName: callee,
            confidence: 'heuristic',
            location: {
              file: normRel,
              line: currentLineNum,
            },
          })
        }
        callMatch = CALL_EXPR_RE.exec(currentLine)
      }

      // c) Writes (confidence: 'heuristic')
      ASSIGN_EXPR_RE.lastIndex = 0
      let assignMatch = ASSIGN_EXPR_RE.exec(currentLine)
      const writtenIdents = new Set()
      const compoundIdents = new Set()
      while (assignMatch !== null) {
        const target = assignMatch[1]
        const op = assignMatch[2]
        const rootIdent = target.split(/\.|->/)[0]
        if (!C_KEYWORDS.has(rootIdent) && rootIdent !== span.name) {
          const isCompound = op !== '='
          if (isCompound) {
            compoundIdents.add(rootIdent)
          } else {
            writtenIdents.add(rootIdent)
          }
          writeEdges.push({
            id: makeDataEdgeId('write', fnId, target, currentLineNum),
            kind: 'write',
            accessorId: fnId,
            variableName: target,
            confidence: 'heuristic',
            location: {
              file: normRel,
              line: currentLineNum,
            },
          })
          if (isCompound) {
            readEdges.push({
              id: makeDataEdgeId('read', fnId, rootIdent, currentLineNum),
              kind: 'read',
              accessorId: fnId,
              variableName: rootIdent,
              confidence: 'heuristic',
              location: {
                file: normRel,
                line: currentLineNum,
              },
            })
          }
        }
        assignMatch = ASSIGN_EXPR_RE.exec(currentLine)
      }

      // Also check prefix ++x and --x
      const PREFIX_UPDATE_RE = /(?:\+\+|--)\s*([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*|->[a-zA-Z_]\w*)?)/g
      let prefixMatch = PREFIX_UPDATE_RE.exec(currentLine)
      while (prefixMatch !== null) {
        const target = prefixMatch[1]
        const rootIdent = target.split(/\.|->/)[0]
        if (!C_KEYWORDS.has(rootIdent) && rootIdent !== span.name) {
          compoundIdents.add(rootIdent)
          writeEdges.push({
            id: makeDataEdgeId('write', fnId, target, currentLineNum),
            kind: 'write',
            accessorId: fnId,
            variableName: target,
            confidence: 'heuristic',
            location: {
              file: normRel,
              line: currentLineNum,
            },
          })
          readEdges.push({
            id: makeDataEdgeId('read', fnId, rootIdent, currentLineNum),
            kind: 'read',
            accessorId: fnId,
            variableName: rootIdent,
            confidence: 'heuristic',
            location: {
              file: normRel,
              line: currentLineNum,
            },
          })
        }
        prefixMatch = PREFIX_UPDATE_RE.exec(currentLine)
      }

      // d) Reads (confidence: 'heuristic')
      IDENTIFIER_RE.lastIndex = 0
      let readMatch = IDENTIFIER_RE.exec(currentLine)
      const seenReadsInLine = new Set()
      while (readMatch !== null) {
        const ident = readMatch[1]
        if (
          !C_KEYWORDS.has(ident) &&
          !writtenIdents.has(ident) &&
          !compoundIdents.has(ident) &&
          ident !== span.name &&
          !seenReadsInLine.has(ident)
        ) {
          seenReadsInLine.add(ident)
          readEdges.push({
            id: makeDataEdgeId('read', fnId, ident, currentLineNum),
            kind: 'read',
            accessorId: fnId,
            variableName: ident,
            confidence: 'heuristic',
            location: {
              file: normRel,
              line: currentLineNum,
            },
          })
        }
        readMatch = IDENTIFIER_RE.exec(currentLine)
      }
    }
  }

  return { callEdges, readEdges, writeEdges, conditions }
}
