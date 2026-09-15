// @ts-check

import { makeFunctionId } from '../../domain/program/program-model.mjs'
import { C_KEYWORDS } from './c-source-keywords.mjs'
import { walkLezerFunctionBody } from './lezer-c-walk-body.mjs'

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
export function extractFunctionDefinition(ctx) {
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

  const bodyNode = fnNode.getChild('CompoundStatement')
  if (!bodyNode) return

  walkLezerFunctionBody({
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
  })
}
