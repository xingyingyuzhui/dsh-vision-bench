// @ts-check

import {
  makeCallEdgeId,
  makeConditionId,
  makeDataEdgeId,
} from '../../domain/program/program-model.mjs'
import { C_KEYWORDS, CONDITION_KEYWORDS } from './c-source-keywords.mjs'

/**
 * Walk a function CompoundStatement AST and emit call / data / condition edges.
 *
 * @param {{
 *   bodyNode: any,
 *   rawSource: string,
 *   normRel: string,
 *   fnId: string,
 *   fnName: string,
 *   toLocation: (offset: number) => { line: number, column: number },
 *   callEdges: import('../../types/program.d.ts').ProgramCallEdge[],
 *   readEdges: import('../../types/program.d.ts').ProgramDataEdge[],
 *   writeEdges: import('../../types/program.d.ts').ProgramDataEdge[],
 *   conditions: import('../../types/program.d.ts').ProgramCondition[],
 *   seenCallEdgeIds: Set<string>,
 *   seenReadEdgeIds: Set<string>,
 *   seenWriteEdgeIds: Set<string>,
 *   seenConditionIds: Set<string>,
 * }} ctx
 */
export function walkLezerFunctionBody(ctx) {
  const {
    bodyNode,
    rawSource,
    normRel,
    fnId,
    fnName,
    toLocation,
    callEdges,
    readEdges,
    writeEdges,
    conditions,
    seenCallEdgeIds,
    seenReadEdgeIds,
    seenWriteEdgeIds,
    seenConditionIds,
  } = ctx

  const writtenInLine = new Set()
  const calledInLine = new Set()

  /**
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

    let child = node.firstChild
    while (child) {
      walkBody(child)
      child = child.nextSibling
    }
  }

  walkBody(bodyNode)
}
