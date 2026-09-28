// @ts-check
import { ERROR_CODES } from '../../domain/modbus/errors.mjs'

const CURSOR_SUPPORTED = ['points op=list', 'timeline.list']
const VIEW_SUPPORTED = ['points op=list']
const VIEW_VALUES = ['full', 'summary']
const ECHO_MAX = 32

/**
 * @typedef {{
 *   ok: false,
 *   action: string,
 *   errorCode: string,
 *   error: string,
 *   hint: string,
 *   retryable: false,
 *   details: {
 *     field: string,
 *     action: string,
 *     supportedBy: string[],
 *     reason: 'UNSUPPORTED_FIELD' | 'INVALID_VALUE' | 'INVALID_TYPE',
 *     allowedValues?: string[],
 *   },
 * }} QueryFieldError
 */

/**
 * @param {any} args
 */
function actionOf(args) {
  return typeof args?.action === 'string' ? args.action : ''
}

/**
 * @param {any} args
 */
function isPointsList(args) {
  return actionOf(args) === 'points' && args?.op === 'list'
}

/**
 * @param {any} args
 */
function cursorAllowed(args) {
  return actionOf(args) === 'timeline.list' || isPointsList(args)
}

/**
 * `undefined` and `''` mean "first page" / "not set". Anything else was supplied.
 * @param {any} args
 * @param {string} field
 */
function supplied(args, field) {
  if (!args || typeof args !== 'object' || !(field in args)) return false
  return args[field] !== undefined && args[field] !== ''
}

/** @param {unknown} value */
function echo(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  const s = String(text ?? '')
  return s.length > ECHO_MAX ? `${s.slice(0, ECHO_MAX)}…` : s
}

/**
 * @param {string} action
 * @param {string} field
 * @param {string[]} supportedBy
 * @param {QueryFieldError['details']['reason']} reason
 * @param {string} error
 * @param {string} hint
 * @param {string[]} [allowedValues]
 * @returns {QueryFieldError}
 */
function fieldError(action, field, supportedBy, reason, error, hint, allowedValues) {
  return {
    ok: false,
    action,
    errorCode: ERROR_CODES.INVALID_FIELD,
    error,
    hint,
    retryable: false,
    details: { field, action, supportedBy, reason, ...(allowedValues ? { allowedValues } : {}) },
  }
}

/**
 * @param {string} action
 * @param {string} field
 * @param {string[]} supportedBy
 * @param {string} hint
 */
function unsupportedField(action, field, supportedBy, hint) {
  return fieldError(action, field, supportedBy, 'UNSUPPORTED_FIELD', `${field} 不适用于 ${action || '当前'} 查询`, hint)
}

/**
 * @param {string} action
 * @param {string} field
 * @param {string[]} supportedBy
 * @param {unknown} value
 * @param {string[]} [allowedValues]
 */
function invalidValue(action, field, supportedBy, value, allowedValues) {
  const allowed = allowedValues ? `；合法值 ${allowedValues.join(' / ')}` : ''
  return fieldError(
    action,
    field,
    supportedBy,
    'INVALID_VALUE',
    `${field} 取值无效：${echo(value)}${allowed}`,
    allowedValues ? `${field} 只能是 ${allowedValues.join(' 或 ')}` : `${field} 必须原样传回上一页的 nextCursor`,
    allowedValues,
  )
}

/**
 * @param {string} action
 * @param {string} field
 * @param {string[]} supportedBy
 * @param {unknown} value
 */
function invalidType(action, field, supportedBy, value) {
  const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
  return fieldError(action, field, supportedBy, 'INVALID_TYPE', `${field} 必须是字符串，收到 ${kind}`, `${field} 必须是字符串；首页不要传 ${field}`)
}

/**
 * Agent-source validation of cursor/view. Host and preflight share this function;
 * `offset` stays the numeric pager for frames/alarm and is not a cursor.
 *
 * @param {any} args
 * @returns {QueryFieldError | null}
 */
export function rejectUnsupportedQueryField(args) {
  const action = actionOf(args)
  if (supplied(args, 'cursor')) {
    const cursor = args.cursor
    if (!cursorAllowed(args)) {
      return unsupportedField(action, 'cursor', CURSOR_SUPPORTED, 'cursor 只用于 points op=list 与 timeline.list。frames 与 alarm 的翻页用数字 offset，不要把 offset 当作 cursor。')
    }
    if (typeof cursor !== 'string') return invalidType(action, 'cursor', CURSOR_SUPPORTED, cursor)
    if (!cursor.trim()) return invalidValue(action, 'cursor', CURSOR_SUPPORTED, cursor)
  }
  if (supplied(args, 'view')) {
    const view = args.view
    if (!isPointsList(args)) {
      return unsupportedField(action, 'view', VIEW_SUPPORTED, 'view 只用于 points op=list，取 full（默认，含运行值）或 summary（不含运行值）。')
    }
    if (typeof view !== 'string') return invalidType(action, 'view', VIEW_SUPPORTED, view)
    if (!VIEW_VALUES.includes(view)) return invalidValue(action, 'view', VIEW_SUPPORTED, view, VIEW_VALUES)
  }
  return null
}
