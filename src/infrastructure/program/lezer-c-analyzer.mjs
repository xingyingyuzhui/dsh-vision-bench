// @ts-check

import { cppLanguage } from '@codemirror/lang-cpp'
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
import { C_KEYWORDS, analyzeCSourceHeuristic } from './heuristic-c-source-analyzer.mjs'

const CONDITION_KEYWORDS = new Set(['if', 'switch', 'while', 'for'])

/**
 * Builds a line offset index for fast 1-indexed (line, column) resolution from character offsets.
 * @param {string} source
 * @returns {(offset: number) => { line: number, column: number }}
 */
function createOffsetToLocation(source) {
  const lineStarts = [0]
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') {
      lineStarts.push(i + 1)
    }
  }

  return (offset) => {
    let low = 0
    let high = lineStarts.length - 1
    while (low <= high) {
      const mid = Math.floor((low + high) / 2)
      if (lineStarts[mid] <= offset) {
        low = mid + 1
      } else {
        high = mid - 1
      }
    }
    const lineIndex = high >= 0 ? high : 0
    const line = lineIndex + 1
    const column = offset - lineStarts[lineIndex] + 1
    return { line, column }
  }
}

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
    // Fallback to heuristic analyzer on any parsing failure
    return analyzeCSourceHeuristic(rawSource, fileRelPath)
  }
}

/**
 * Backward compatibility alias for analyzeCSourceWithLezer.
 */
export const analyzeCSourceWithAst = analyzeCSourceWithLezer

/**
 * Internal Lezer AST traversal.
 *
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

  // First pass: extract preprocessors, top-level variable declarations, and functions
  if (cursor.firstChild()) {
    do {
      const nodeName = cursor.name
      const from = cursor.from
      const to = cursor.to
      const text = rawSource.slice(from, to)

      // 1. Preprocessor directives (#include, #define, #ifdef, etc.)
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

      // 2. File-scope variable declarations
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

      // 3. Function definitions
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

/**
 * Extracts top-level variable declarations from a Declaration node.
 *
 * @param {{
 *   cursor: any,
 *   rawSource: string,
 *   fileId: string,
 *   toLocation: (offset: number) => { line: number, column: number },
 *   variables: import('../../types/program.d.ts').ProgramVariable[],
 *   seenVariableIds: Set<string>,
 * }} ctx
 */
function extractTopLevelVariableDeclarations(ctx) {
  const { cursor, rawSource, fileId, toLocation, variables, seenVariableIds } = ctx
  const text = rawSource.slice(cursor.from, cursor.to)

  const isStatic = /\bstatic\b/.test(text)
  const isVolatile = /\bvolatile\b/.test(text)
  const isConst = /\bconst\b/.test(text)

  const subCursor = cursor.node.cursor()
  if (subCursor.firstChild()) {
    do {
      if (subCursor.name === 'InitDeclarator' || subCursor.name === 'Identifier') {
        let varName = ''
        let varPos = subCursor.from

        if (subCursor.name === 'InitDeclarator') {
          const initSub = subCursor.node.cursor()
          if (initSub.firstChild()) {
            do {
              if (initSub.name === 'Identifier') {
                varName = rawSource.slice(initSub.from, initSub.to).trim()
                varPos = initSub.from
                break
              }
            } while (initSub.nextSibling())
          }
        } else {
          varName = rawSource.slice(subCursor.from, subCursor.to).trim()
        }

        if (varName && !C_KEYWORDS.has(varName)) {
          const scope = isStatic ? fileId : 'global'
          const varId = makeVariableId(scope, varName)
          if (!seenVariableIds.has(varId)) {
            seenVariableIds.add(varId)
            const loc = toLocation(varPos)
            variables.push({
              id: varId,
              name: varName,
              scope,
              fileId,
              line: loc.line,
              isStatic,
              isVolatile,
              isConst,
            })
          }
        }
      }
    } while (subCursor.nextSibling())
  }
}

/**
 * Extracts a function definition and traverses its body for calls, variables, conditions, reads and writes.
 *
 * @param {{
 *   cursor: any,
 *   rawSource: string,
 *   normRel: string,
 *   fileId: string,
 *   toLocation: (offset: number) => { line: number, column: number },
 *   functions: import('../../types/program.d.ts').ProgramFunction[],
 *   callEdges: import('../../types/program.d.ts').ProgramCallEdge[],
 *   readEdges: import('../../types/program.d.ts').ProgramDataEdge[],
 *   writeEdges: import('../../types/program.d.ts').ProgramDataEdge[],
 *   conditions: import('../../types/program.d.ts').ProgramCondition[],
 *   seenFunctionIds: Set<string>,
 *   seenCallEdgeIds: Set<string>,
 *   seenReadEdgeIds: Set<string>,
 *   seenWriteEdgeIds: Set<string>,
 *   seenConditionIds: Set<string>,
 * }} ctx
 */
function extractFunctionDefinition(ctx) {
  const {
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
  } = ctx

  const fnNode = cursor.node
  const fnText = rawSource.slice(fnNode.from, fnNode.to)
  const isStatic = /\bstatic\b/.test(fnText.slice(0, 100))
  const isInterrupt = /\b(__interrupt|__irq)\b/.test(fnText) || /_IRQHandler\b/.test(fnText)

  let fnName = ''
  let fnNamePos = fnNode.from
  const params = []

  // Find FunctionDeclarator
  const declaratorNode = fnNode.getChild('FunctionDeclarator')
  if (declaratorNode) {
    const idNode = declaratorNode.getChild('Identifier')
    if (idNode) {
      fnName = rawSource.slice(idNode.from, idNode.to).trim()
      fnNamePos = idNode.from
    }

    const paramListNode = declaratorNode.getChild('ParameterList')
    if (paramListNode) {
      let pCur = paramListNode.firstChild
      while (pCur) {
        if (pCur.name === 'ParameterDeclaration') {
          const pId = pCur.getChild('Identifier')
          if (pId) {
            params.push({ name: rawSource.slice(pId.from, pId.to).trim() })
          }
        }
        pCur = pCur.nextSibling
      }
    }
  }

  if (!fnName || C_KEYWORDS.has(fnName)) return

  const startLoc = toLocation(fnNamePos)
  const endLoc = toLocation(fnNode.to)
  const fnId = makeFunctionId(normRel, fnName, startLoc.line)

  if (!seenFunctionIds.has(fnId)) {
    seenFunctionIds.add(fnId)
    functions.push({
      id: fnId,
      fileId,
      name: fnName,
      line: startLoc.line,
      endLine: endLoc.line,
      isStatic,
      isInterrupt,
      parameters: params,
    })
  }

  // Traverse inside the function compound statement
  const bodyNode = fnNode.getChild('CompoundStatement')
  if (!bodyNode) return

  // Walk the AST subtree of the body
  const writtenInLine = new Set()
  const calledInLine = new Set()

  /**
   * Recursive walker inside the function body
   * @param {any} node
   */
  function walkBody(node) {
    const name = node.name

    // a) Function call
    if (name === 'CallExpression') {
      let callee = ''
      let calleePos = node.from

      const idChild = node.getChild('Identifier')
      if (idChild) {
        callee = rawSource.slice(idChild.from, idChild.to).trim()
        calleePos = idChild.from
      } else {
        const fieldChild = node.getChild('FieldExpression')
        if (fieldChild) {
          const fieldId = fieldChild.getChild('FieldIdentifier') || fieldChild.getChild('Identifier')
          if (fieldId) {
            callee = rawSource.slice(fieldId.from, fieldId.to).trim()
            calleePos = fieldId.from
          }
        }
      }

      if (callee && !C_KEYWORDS.has(callee) && !CONDITION_KEYWORDS.has(callee)) {
        const loc = toLocation(calleePos)
        const edgeId = makeCallEdgeId(fnId, callee, loc.line)
        if (!seenCallEdgeIds.has(edgeId)) {
          seenCallEdgeIds.add(edgeId)
          callEdges.push({
            id: edgeId,
            callerId: fnId,
            calleeName: callee,
            confidence: 'ast',
            location: {
              file: normRel,
              line: loc.line,
              column: loc.column,
            },
          })
          calledInLine.add(`${loc.line}:${callee}`)
        }
      }
    }

    // b) Assignment / update writes & compound reads
    if (name === 'AssignmentExpression' || name === 'UpdateExpression') {
      let target = ''
      let targetPos = node.from
      let isCompoundOrUpdate = false

      if (name === 'UpdateExpression') {
        isCompoundOrUpdate = true
        let targetNode = node.firstChild
        while (
          targetNode &&
          (targetNode.name === 'UpdateOp' ||
            targetNode.name === 'ArithOp' ||
            ['++', '--'].includes(rawSource.slice(targetNode.from, targetNode.to).trim()))
        ) {
          targetNode = targetNode.nextSibling
        }
        if (targetNode) {
          target = rawSource.slice(targetNode.from, targetNode.to).trim()
          targetPos = targetNode.from
        }
      } else {
        const lhs = node.firstChild
        if (lhs) {
          target = rawSource.slice(lhs.from, lhs.to).trim()
          targetPos = lhs.from
        }
        let opChild = lhs ? lhs.nextSibling : null
        while (opChild) {
          const opText = rawSource.slice(opChild.from, opChild.to).trim()
          if (opText) {
            if (opText !== '=' && opText.endsWith('=')) {
              isCompoundOrUpdate = true
            }
            break
          }
          opChild = opChild.nextSibling
        }
      }

      const rootIdent = target.split(/\.|->/)[0].trim()
      if (rootIdent && !C_KEYWORDS.has(rootIdent) && rootIdent !== fnName) {
        const loc = toLocation(targetPos)
        const edgeId = makeDataEdgeId('write', fnId, target, loc.line)
        if (!seenWriteEdgeIds.has(edgeId)) {
          seenWriteEdgeIds.add(edgeId)
          writeEdges.push({
            id: edgeId,
            kind: 'write',
            accessorId: fnId,
            variableName: target,
            confidence: 'ast',
            location: {
              file: normRel,
              line: loc.line,
              column: loc.column,
            },
          })
          if (!isCompoundOrUpdate) {
            writtenInLine.add(`${loc.line}:${rootIdent}`)
          }
        }
        if (isCompoundOrUpdate) {
          const readEdgeId = makeDataEdgeId('read', fnId, rootIdent, loc.line)
          if (!seenReadEdgeIds.has(readEdgeId)) {
            seenReadEdgeIds.add(readEdgeId)
            readEdges.push({
              id: readEdgeId,
              kind: 'read',
              accessorId: fnId,
              variableName: rootIdent,
              confidence: 'ast',
              location: {
                file: normRel,
                line: loc.line,
                column: loc.column,
              },
            })
          }
        }
      }
    }

    // c) Conditions: IfStatement, SwitchStatement, WhileStatement, ForStatement
    if (name === 'IfStatement' || name === 'SwitchStatement' || name === 'WhileStatement' || name === 'ForStatement') {
      const condType =
        name === 'IfStatement'
          ? 'if'
          : name === 'SwitchStatement'
            ? 'switch'
            : name === 'WhileStatement'
              ? 'while'
              : 'for'

      const condClause = node.getChild('ConditionClause')
      const condLoc = toLocation(node.from)
      /** @type {string[]} */
      const referencedVars = []

      if (condClause) {
        /** @param {any} n */
        function collectConditionIds(n) {
          if (n.name === 'Identifier') {
            const id = rawSource.slice(n.from, n.to).trim()
            if (!C_KEYWORDS.has(id) && id !== fnName && !referencedVars.includes(id)) {
              referencedVars.push(id)
            }
          }
          let c = n.firstChild
          while (c) {
            collectConditionIds(c)
            c = c.nextSibling
          }
        }
        collectConditionIds(condClause)
      }

      const condId = makeConditionId(fnId, condType, condLoc.line)
      if (!seenConditionIds.has(condId)) {
        seenConditionIds.add(condId)
        conditions.push({
          id: condId,
          functionId: fnId,
          type: /** @type {any} */ (condType),
          referencedVariableIds: referencedVars,
          location: {
            file: normRel,
            line: condLoc.line,
            column: condLoc.column,
          },
        })
      }
    }

    // d) Reads: Identifiers that are not in writes or calls
    if (name === 'Identifier') {
      const id = rawSource.slice(node.from, node.to).trim()
      const loc = toLocation(node.from)
      const isCall = calledInLine.has(`${loc.line}:${id}`)
      const isWrite = writtenInLine.has(`${loc.line}:${id}`)

      // Avoid reading keywords, function's own name, or parent function declaration
      if (!C_KEYWORDS.has(id) && !CONDITION_KEYWORDS.has(id) && id !== fnName && !isCall && !isWrite) {
        const edgeId = makeDataEdgeId('read', fnId, id, loc.line)
        if (!seenReadEdgeIds.has(edgeId)) {
          seenReadEdgeIds.add(edgeId)
          readEdges.push({
            id: edgeId,
            kind: 'read',
            accessorId: fnId,
            variableName: id,
            confidence: 'ast',
            location: {
              file: normRel,
              line: loc.line,
              column: loc.column,
            },
          })
        }
      }
    }

    // Recursively traverse children
    let child = node.firstChild
    while (child) {
      walkBody(child)
      child = child.nextSibling
    }
  }

  walkBody(bodyNode)
}
