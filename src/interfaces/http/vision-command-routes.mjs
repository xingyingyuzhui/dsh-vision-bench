// @ts-check
import { normalizeCommand } from '../../application/commands/command-contract.mjs'
import { executeVisionCommand } from '../../application/commands/vision-command-service.mjs'

/**
 * @param {any} home
 * @returns {any}
 */
export function createVisionCommandDispatcher(home) {
  return {
    /** @param {any} input */
    async dispatch(input) {
      return executeVisionCommand({ ...normalizeCommand(input), home: input.home || home })
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
  return executeVisionCommand({
    ...body,
    home,
    payload: body.payload || body,
    action: body.action || body.payload?.action,
  })
}
