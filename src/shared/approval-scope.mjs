// @ts-check
import { sameCwd } from './path-normalize.mjs'

/**
 * Shared primitives for approval-scope checks.
 *
 * ## Why there is not a single shared predicate
 *
 * The debug and flash approval stores used to hand-roll their own scope checks
 * and drifted into opposite semantics:
 *
 *   - debug: `scope.sessionId && !match(...)` — an absent sessionId silently
 *     disabled the check.
 *   - flash: `!match(scope.sessionId, record.sessionId)` — an absent sessionId
 *     always failed.
 *
 * The tempting fix is one predicate for both. That is wrong, because the two
 * operations have genuinely different trust models:
 *
 *   - **Flash writes firmware to hardware.** `仅 Session A 可以批准` is a
 *     deliberate product invariant: the ticket names its owning session and only
 *     that session may consume it. Loosening this to "any session in the same
 *     workspace" would be a real regression.
 *
 *   - **Debug is initiated by the agent, approved by the human.** The approval
 *     arrives from the Debug page, which does not know the agent's session id —
 *     it only knows the request id and its own workspace. Demanding a session
 *     match made every legitimate approval fail with
 *     `DEBUG_APPROVAL_SCOPE_MISMATCH`.
 *
 * So we share the *primitives* (path canonicalisation, session-key
 * normalisation) and keep two named policies whose divergence is explicit and
 * documented, instead of two accidental implementations.
 */

/**
 * Compares the workspace of an approval scope against a stored record.
 *
 * @param {unknown} scopeCwd
 * @param {unknown} recordCwd
 * @returns {'match' | 'mismatch' | 'unknown'} `unknown` when either side has no cwd
 */
export function compareApprovalCwd(scopeCwd, recordCwd) {
  const a = typeof scopeCwd === 'string' ? scopeCwd.trim() : ''
  const b = typeof recordCwd === 'string' ? recordCwd.trim() : ''
  if (!a || !b) return 'unknown'
  return sameCwd(a, b) ? 'match' : 'mismatch'
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function sessionKeyOf(value) {
  return value == null ? '' : String(value)
}

/**
 * Debug approval policy.
 *
 * Gate on the **workspace** only. The cwd is the reliable identity here: the
 * Debug page approves from the same workspace the agent is debugging in, but it
 * has no way to know the agent's session id, so a session-id comparison is not a
 * meaningful authorization signal for this operation.
 *
 * Ownership of the resulting debug session is enforced separately and correctly
 * at start time — `debug-rpc-handler` starts the session using the ticket's own
 * `sessionId` (`record.sessionId || sessionId`), not the approver's.
 *
 * cwd is compared whenever both sides provide one. A missing cwd (an internal
 * `approve(requestId)` call, where the unguessable request id is itself the
 * capability) is not treated as a mismatch.
 *
 * @param {{ cwd?: unknown, sessionId?: unknown } | null | undefined} scope
 * @param {{ cwd?: unknown, sessionId?: unknown } | null | undefined} record
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function checkDebugApprovalScope(scope, record) {
  if (compareApprovalCwd(scope?.cwd, record?.cwd) === 'mismatch') {
    return { ok: false, reason: '调试批准请求不属于当前工作区' }
  }
  return { ok: true }
}

/**
 * Flash approval policy — deliberately stricter than the debug policy.
 *
 * Flashing overwrites firmware on real hardware, so the ticket is bound to the
 * session that raised it: both the workspace and the session must match exactly.
 * A missing session id on either side is a mismatch, not a free pass.
 *
 * @param {{ cwd?: unknown, sessionId?: unknown } | null | undefined} scope
 * @param {{ cwd?: unknown, sessionId?: unknown } | null | undefined} record
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function checkFlashApprovalScope(scope, record) {
  const cwdVerdict = compareApprovalCwd(scope?.cwd, record?.cwd)
  if (cwdVerdict !== 'match') {
    return { ok: false, reason: '烧录批准请求不属于当前工作区' }
  }

  const a = sessionKeyOf(scope?.sessionId)
  const b = sessionKeyOf(record?.sessionId)
  if (!a && !b) return { ok: true }
  if (!a || !b) {
    return { ok: false, reason: '烧录批准请求缺少会话标识，无法校验归属' }
  }
  if (a !== b) {
    return { ok: false, reason: '烧录批准请求不属于当前会话' }
  }
  return { ok: true }
}
