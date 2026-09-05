// @ts-check

/**
 * Resolves a DebugSession owned by ownerSessionId with optional debugSessionId and workspaceCwd.
 * Strictly rejects foreign session access or cwd-only assumptions.
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
    if (workspaceCwd && session.workspaceCwd !== workspaceCwd) return null
    return session
  }

  if (typeof runtime.findSession === 'function') {
    return runtime.findSession(
      (/** @type {any} */ s) =>
        s.ownerSessionId === ownerSessionId && (!workspaceCwd || s.workspaceCwd === workspaceCwd),
    )
  }

  return null
}
