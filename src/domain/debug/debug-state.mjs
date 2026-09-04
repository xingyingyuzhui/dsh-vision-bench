// @ts-check
import { DEBUG_ERRORS, DebugError } from './errors.mjs'

/**
 * Valid transitions between debug run states.
 * @type {Record<import('../../types/debug.d.ts').DebugRunState, import('../../types/debug.d.ts').DebugRunState[]>}
 */
export const VALID_TRANSITIONS = {
  idle: ['starting'],
  starting: ['ready', 'paused', 'failed', 'stopping'],
  ready: ['running', 'paused', 'stopping', 'failed'],
  running: ['paused', 'stopping', 'failed'],
  paused: ['running', 'stopping', 'failed'],
  stopping: ['idle', 'failed'],
  failed: ['stopping', 'idle'],
}

/**
 * Determines whether a transition from one state to another is allowed.
 *
 * @param {import('../../types/debug.d.ts').DebugRunState} from
 * @param {import('../../types/debug.d.ts').DebugRunState} to
 * @returns {boolean}
 */
export function canTransition(from, to) {
  const allowed = VALID_TRANSITIONS[from]
  return Boolean(allowed?.includes(to))
}

/**
 * Validates and executes state transition.
 * Throws DebugError if the transition is illegal.
 *
 * @param {import('../../types/debug.d.ts').DebugRunState} from
 * @param {import('../../types/debug.d.ts').DebugRunState} to
 * @returns {import('../../types/debug.d.ts').DebugRunState}
 */
export function transition(from, to) {
  if (!canTransition(from, to)) {
    throw new DebugError(DEBUG_ERRORS.INVALID_TRANSITION, `非法调试状态转换: ${from} -> ${to}`, { from, to })
  }
  return to
}
