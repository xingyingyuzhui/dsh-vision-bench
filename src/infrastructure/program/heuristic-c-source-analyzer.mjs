// @ts-check

import {
  makeCallEdgeId,
  makeConditionId,
  makeDataEdgeId,
  makeFileId,
  makeFunctionId,
  makeIncludeEdgeId,
  makeVariableId,
  normalizeRelPath,
} from '../../domain/program/program-model.mjs'

/** Set of keywords that cannot be function or variable identifiers */
export const C_KEYWORDS = new Set([
  'auto',
  'break',
  'case',
  'char',
  'const',
  'continue',
  'default',
  'do',
  'double',
  'else',
  'enum',
  'extern',
  'float',
  'for',
  'goto',
  'if',
  'inline',
  'int',
  'long',
  'register',
  'restrict',
  'return',
  'short',
  'signed',
  'sizeof',
  'static',
  'struct',
  'switch',
  'typedef',
  'union',
  'unsigned',
  'void',
  'volatile',
  'while',
  '_Alignas',
  '_Alignof',
  '_Atomic',
  '_Bool',
  '_Complex',
  '_Generic',
  '_Imaginary',
  '_Noreturn',
  '_Static_assert',
  '_Thread_local',
  '__inline',
  '__forceinline',
  '__weak',
  '__packed',
  '__interrupt',
  '__irq',
])

/** Set of keywords indicating condition statements */
const CONDITION_KEYWORDS = new Set(['if', 'switch', 'while', 'for'])

/**
 * Strips comments and string literals from C source while preserving original line numbers.
 * Comments and string contents are replaced with spaces/newlines.
 *
 * @param {string} source
 * @returns {string} Cleaned source with identical line count and positions
 */
export function sanitizeCSource(source) {
  const chars = source.split('')
  const len = chars.length
  let i = 0

  while (i < len) {
    const ch = chars[i]
    const next = i + 1 < len ? chars[i + 1] : ''

    // Line comment: // ...
    if (ch === '/' && next === '/') {
      chars[i] = ' '
      chars[i + 1] = ' '
      i += 2
      while (i < len && chars[i] !== '\n') {
        chars[i] = ' '
        i++
      }
      continue
    }

    // Block comment: /* ... */
    if (ch === '/' && next === '*') {
      chars[i] = ' '
      chars[i + 1] = ' '
      i += 2
      while (i < len) {
        if (chars[i] === '*' && i + 1 < len && chars[i + 1] === '/') {
          chars[i] = ' '
          chars[i + 1] = ' '
          i += 2
          break
        }
        if (chars[i] !== '\n') {
          chars[i] = ' '
        }
        i++
      }
      continue
    }

    // String literal: "..."
    if (ch === '"') {
      chars[i] = ' '
      i++
      while (i < len && chars[i] !== '"') {
        if (chars[i] === '\\' && i + 1 < len) {
          chars[i] = ' '
          i++
          if (chars[i] !== '\n') chars[i] = ' '
        } else if (chars[i] !== '\n') {
          chars[i] = ' '
        }
        i++
      }
      if (i < len && chars[i] === '"') {
        chars[i] = ' '
        i++
      }
      continue
    }

    // Char literal: '...'
    if (ch === "'") {
      chars[i] = ' '
      i++
      while (i < len && chars[i] !== "'") {
        if (chars[i] === '\\' && i + 1 < len) {
          chars[i] = ' '
          i++
          if (chars[i] !== '\n') chars[i] = ' '
        } else if (chars[i] !== '\n') {
          chars[i] = ' '
        }
        i++
      }
      if (i < len && chars[i] === "'") {
        chars[i] = ' '
        i++
      }
      continue
    }

    i++
  }

  return chars.join('')
}

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

  const cleanSource = sanitizeCSource(rawSource)
  const lines = cleanSource.split('\n')

  // 1. Extract includes from raw source
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

  // Helper: check if a line is a preprocessor directive
  /** @param {string} line */
  const isDirective = (line) => line.trim().startsWith('#')

  // 2. Discover function definitions and their body spans (startLine, endLine)
  /** @type {Array<{ name: string, line: number, endLine: number, returnType?: string, isStatic?: boolean, isInterrupt?: boolean }>} */
  const functionSpans = []

  const FUNC_SIGNATURE_RE =
    /^[ \t]*(?:(?:static|inline|extern|__inline|__forceinline|__weak|void|int|uint\d+_t|int\d+_t|char|short|long|float|double|bool|_Bool|[\w_]+(?:\s*\*)?)\s+)+(\*?\s*[\w_]+)\s*\(([^;{}]{0,240})\)\s*(\{)?\s*$/

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

  // 3. Scan for file-scope variables outside function spans
  const VAR_DECL_RE =
    /^[ \t]*(?:(?:static|extern|volatile|const)\s+)*(?:void|char|short|int|long|float|double|signed|unsigned|uint\d+_t|int\d+_t|bool|_Bool|[\w_]+_t)\s+(?:[\w_]+\s+)*\*?\s*([a-zA-Z_]\w*)\s*(?:\[[^\]]*\])?\s*(?:=[^;]+)?;/

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

  // 4. Analyze function bodies
  const CALL_EXPR_RE = /\b([a-zA-Z_]\w*)\s*\(/g
  const ASSIGN_EXPR_RE = /\b([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*|->[a-zA-Z_]\w*)?)\s*([+\-*/%&|^]?=|\+\+|--)/g
  const IDENTIFIER_RE = /\b([a-zA-Z_]\w*)\b/g

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
