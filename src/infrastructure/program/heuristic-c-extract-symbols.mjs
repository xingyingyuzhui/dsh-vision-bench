// @ts-check

import {
  makeFunctionId,
  makeIncludeEdgeId,
  makeVariableId,
} from '../../domain/program/program-model.mjs'
import { C_KEYWORDS } from './c-source-keywords.mjs'

/** @param {string} line */
function isDirective(line) {
  return line.trim().startsWith('#')
}

const FUNC_SIGNATURE_RE =
  /^[ \t]*(?:(?:static|inline|extern|__inline|__forceinline|__weak|void|int|uint\d+_t|int\d+_t|char|short|long|float|double|bool|_Bool|[\w_]+(?:\s*\*)?)\s+)+(\*?\s*[\w_]+)\s*\(([^;{}]{0,240})\)\s*(\{)?\s*$/

const VAR_DECL_RE =
  /^[ \t]*(?:(?:static|extern|volatile|const)\s+)*(?:void|char|short|int|long|float|double|signed|unsigned|uint\d+_t|int\d+_t|bool|_Bool|[\w_]+_t)\s+(?:[\w_]+\s+)*\*?\s*([a-zA-Z_]\w*)\s*(?:\[[^\]]*\])?\s*(?:=[^;]+)?;/

/**
 * Extract #include edges from raw (unsanitized) source.
 *
 * @param {string} rawSource
 * @param {string} normRel
 * @param {string} fileId
 * @returns {import('../../types/program.d.ts').ProgramIncludeEdge[]}
 */
export function extractHeuristicIncludes(rawSource, normRel, fileId) {
  /** @type {import('../../types/program.d.ts').ProgramIncludeEdge[]} */
  const includeEdges = []
  const includeRegex = /^[ \t]*#[ \t]*include[ \t]+[<"]([^>"]+)[>"]/gm
  let incMatch = includeRegex.exec(rawSource)
  const seenIncludes = new Set()
  while (incMatch !== null) {
    const headerName = incMatch[1].trim().replaceAll('\\', '/')
    if (headerName && !seenIncludes.has(headerName)) {
      seenIncludes.add(headerName)
      includeEdges.push({
        id: makeIncludeEdgeId(normRel, headerName),
        fromFileId: fileId,
        headerName,
        resolved: false,
        confidence: 'unresolved',
      })
    }
    incMatch = includeRegex.exec(rawSource)
  }
  return includeEdges
}

/**
 * Discover function definitions and their body spans.
 *
 * @param {string[]} lines
 * @param {string} normRel
 * @param {string} fileId
 * @returns {{
 *   functions: import('../../types/program.d.ts').ProgramFunction[],
 *   functionSpans: Array<{ name: string, line: number, endLine: number, isStatic?: boolean, isInterrupt?: boolean }>,
 * }}
 */
export function extractHeuristicFunctions(lines, normRel, fileId) {
  /** @type {import('../../types/program.d.ts').ProgramFunction[]} */
  const functions = []
  /** @type {Array<{ name: string, line: number, endLine: number, isStatic?: boolean, isInterrupt?: boolean }>} */
  const functionSpans = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const stripped = line.trim()
    if (!stripped || isDirective(stripped)) continue

    const match = FUNC_SIGNATURE_RE.exec(line)
    if (!match) continue

    let rawName = match[1].trim()
    while (rawName.startsWith('*')) rawName = rawName.slice(1).trim()
    if (C_KEYWORDS.has(rawName)) continue

    let hasBrace = Boolean(match[3])
    let openLineIndex = i

    if (!hasBrace) {
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        const nextStripped = lines[j].trim()
        if (nextStripped.startsWith('{')) {
          hasBrace = true
          openLineIndex = j
          break
        }
        if (nextStripped) break
      }
    }

    if (!hasBrace) continue

    let braceDepth = 0
    let endLineIndex = openLineIndex
    let foundOpen = false

    for (let k = openLineIndex; k < lines.length; k++) {
      const cur = lines[k]
      for (let c = 0; c < cur.length; c++) {
        if (cur[c] === '{') {
          braceDepth++
          foundOpen = true
        } else if (cur[c] === '}') {
          braceDepth--
          if (foundOpen && braceDepth === 0) {
            endLineIndex = k
            break
          }
        }
      }
      if (foundOpen && braceDepth === 0) break
    }

    const startLine = i + 1
    const endLine = endLineIndex + 1
    const isStatic = line.includes('static')
    const isInterrupt = line.includes('__interrupt') || line.includes('__irq') || rawName.endsWith('_IRQHandler')

    functionSpans.push({
      name: rawName,
      line: startLine,
      endLine,
      isStatic,
      isInterrupt,
    })

    const fnId = makeFunctionId(normRel, rawName, startLine)
    functions.push({
      id: fnId,
      fileId,
      name: rawName,
      line: startLine,
      endLine,
      isStatic,
      isInterrupt,
    })
  }

  return { functions, functionSpans }
}

/**
 * Scan for file-scope variables outside function spans.
 *
 * @param {string[]} lines
 * @param {Array<{ line: number, endLine: number }>} functionSpans
 * @param {string} fileId
 * @returns {import('../../types/program.d.ts').ProgramVariable[]}
 */
export function extractHeuristicVariables(lines, functionSpans, fileId) {
  /** @type {import('../../types/program.d.ts').ProgramVariable[]} */
  const variables = []

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1
    const insideFn = functionSpans.some((span) => lineNum >= span.line && lineNum <= span.endLine)
    if (insideFn) continue

    const line = lines[i]
    const stripped = line.trim()
    if (!stripped || isDirective(stripped)) continue

    const varMatch = VAR_DECL_RE.exec(line)
    if (varMatch) {
      const varName = varMatch[1]
      if (!C_KEYWORDS.has(varName)) {
        const isStatic = line.includes('static')
        const isVolatile = line.includes('volatile')
        const isConst = line.includes('const')
        const scope = isStatic ? fileId : 'global'
        const varId = makeVariableId(scope, varName)

        variables.push({
          id: varId,
          name: varName,
          scope,
          fileId,
          line: lineNum,
          isStatic,
          isVolatile,
          isConst,
        })
      }
    }
  }

  return variables
}

export { isDirective }
