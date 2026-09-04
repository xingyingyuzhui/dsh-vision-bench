// @ts-check

import { normalizeCommand } from '../../application/commands/command-contract.mjs'
import { executeHostCommand } from '../../application/commands/host-command-service.mjs'
import { losslessCommandResult } from '../../application/commands/lossless-json.mjs'

/**
 * @param {any} home
 * @returns {any}
 */
export function createVisionCommandDispatcher(home) {
  return {
    /** @param {any} input */
    async dispatch(input) {
      return losslessCommandResult(await executeHostCommand({ ...normalizeCommand(input), home: input.home || home }))
    },
  }
}

/**
 * @param {any} home
 * @param {any} arg
 * @returns {any}
 */
export function visionCommandRoute(home, { readBodyAndTouchSession }) {
  return {
    kind: 'exact',
    path: '/dsh-vision-bench/command',
    handler: null,
    dispatch: (/** @type {any} */ req) => handleCommand(home, req, readBodyAndTouchSession),
  }
}

/**
 * @param {any} home
 * @param {any} req
 * @param {any} readBodyAndTouchSession
 * @returns {Promise<any>}
 */
export async function handleCommand(home, req, readBodyAndTouchSession) {
  const body = await readBodyAndTouchSession(req)
  return losslessCommandResult(
    await executeHostCommand({
      ...body,
      home,
      payload: body.payload || body,
      action: body.action || body.payload?.action,
    }),
  )
}
