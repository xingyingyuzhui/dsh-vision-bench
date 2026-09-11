// @ts-check
import { sameCwd } from '../../shared/path-normalize.mjs'

/**
 * Resolves a DebugSession owned by ownerSessionId with optional debugSessionId and workspaceCwd.
 * Strictly rejects foreign session access or cwd-only assumptions.
 *
 * The cwd comparison is canonicalised (`normalizeCwd`): callers reach this from
 * three different sources (agent session header, RPC body, command envelope) and
 * any one of them may spell the same directory with a trailing slash, a relative
 * form, a symlinked prefix, or different letter case. A byte-exact comparison
 * turned every such mismatch into a spurious `DEBUG_SESSION_NOT_FOUND`.
 *
 * @param {any} runtime
 * @param {{
 *   ownerSessionId?: string,
 *   workspaceCwd?: string,
 *   debugSessionId?: string,
 * }} scope
 * @returns {import('../../types/debug.d.ts').DebugSessionView | null}
 */
export function findOwnedDebugSession(runtime, scope) {
  const ownerSessionId = typeof scope?.ownerSessionId === 'string' ? scope.ownerSessionId.trim() : ''
  if (!ownerSessionId || !runtime) return null

  const debugSessionId = typeof scope?.debugSessionId === 'string' ? scope.debugSessionId.trim() : ''
  const workspaceCwd = typeof scope?.workspaceCwd === 'string' ? scope.workspaceCwd.trim() : ''

  if (debugSessionId) {
    const session = runtime.state({ debugSessionId, ownerSessionId })
    if (workspaceCwd && !sameCwd(session.workspaceCwd, workspaceCwd)) return null
    return session
  }

  if (typeof runtime.findSession === 'function') {
    return runtime.findSession(
      (/** @type {any} */ s) => s.ownerSessionId === ownerSessionId && (!workspaceCwd || sameCwd(s.workspaceCwd, workspaceCwd)),
    )
  }

  return null
}
