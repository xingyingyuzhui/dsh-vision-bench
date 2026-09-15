// @ts-check

import { makeVariableId } from '../../domain/program/program-model.mjs'
import { C_KEYWORDS } from './c-source-keywords.mjs'

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
export function extractTopLevelVariableDeclarations(ctx) {
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
