// @ts-check
import { ERROR_CODES } from '../../domain/modbus/errors.mjs'

const CURSOR_SUPPORTED = ['points op=list', 'timeline.list']
const VIEW_SUPPORTED = ['points op=list']

/**
 * @param {any} args
 * @returns {boolean}
 */
function cursorPresent(args) {
  if (!args || typeof args !== 'object' || !('cursor' in args)) return false
  if (args.cursor == null) return false
  return String(args.cursor) !== ''
}

/**
 * @param {any} args
 * @returns {boolean}
 */
function viewPresent(args) {
  if (!args || typeof args !== 'object' || !('view' in args)) return false
  if (args.view == null) return false
  return String(args.view) !== ''
}

/**
 * @param {any} args
 */
function actionOf(args) {
  return typeof args?.action === 'string' ? args.action : ''
}

/**
 * @param {any} args
 */
function opOf(args) {
  return typeof args?.op === 'string' ? args.op : ''
}

/**
 * @param {any} args
 */
function cursorAllowed(args) {
  const action = actionOf(args)
  if (action === 'timeline.list') return true
  return action === 'points' && opOf(args) === 'list'
}

/**
 * @param {any} args
 */
function viewAllowed(args) {
  return actionOf(args) === 'points' && opOf(args) === 'list'
}

/**
 * Reject cursor/view on queries that do not define them.
 * `offset` stays the numeric pager for frames/alarm and is not a cursor.
 *
 * @param {any} args
 * @returns {null | {
 *   ok: false,
 *   action: string,
 *   errorCode: string,
 *   error: string,
 *   hint: string,
 *   retryable: false,
 *   details: { field: string, action: string, supportedBy: string[] },
 * }}
 */
export function rejectUnsupportedQueryField(args) {
  const action = actionOf(args)
  if (cursorPresent(args) && !cursorAllowed(args)) {
    return invalidField(action, 'cursor', CURSOR_SUPPORTED, 'cursor 只用于 points op=list 与 timeline.list。frames 与 alarm 的翻页用数字 offset，不要把 offset 当作 cursor。')
  }
  if (viewPresent(args) && !viewAllowed(args)) {
    return invalidField(action, 'view', VIEW_SUPPORTED, 'view 只用于 points op=list，取 full（默认，含运行值）或 summary（不含运行值）。')
  }
  if (viewPresent(args) && viewAllowed(args)) {
    const view = String(args.view)
    if (view !== 'full' && view !== 'summary') {
      return invalidField(action, 'view', VIEW_SUPPORTED, 'points op=list 的 view 只能是 full 或 summary。')
    }
  }
  return null
}

/**
 * @param {string} action
 * @param {string} field
 * @param {string[]} supportedBy
 * @param {string} hint
 */
function invalidField(action, field, supportedBy, hint) {
  return {
    ok: /** @type {const} */ (false),
    action,
    errorCode: ERROR_CODES.INVALID_FIELD,
    error: `${field} 不适用于 ${action || '当前'} 查询`,
    hint,
    retryable: /** @type {const} */ (false),
    details: { field, action, supportedBy },
  }
}
