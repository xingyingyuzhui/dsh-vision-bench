/**
 * DSH 0.1.2-alpha.3 conversation.view owner props.
 * Source: @deepseek-ai/dsh@0.1.2-alpha.3
 *   ConvViewOwnerProps — dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts
 *   ConversationViewRequest — .../contract/views.d.ts
 *   WorkspaceView — dsh-cordis-client-runner WorkspaceView
 *     { workspaceId, path, title, sessionIds, createdAt, updatedAt }
 *
 * Do not add useSessions. That hook is not part of the alpha.3 Vision contract.
 */

export const ALPHA3_DSH_VERSION = '0.1.2-alpha.3'
export const ALPHA3_DSH_PACKAGE = '@deepseek-ai/dsh@0.1.2-alpha.3'

const ISO = '2026-01-01T00:00:00.000Z'

export function alpha3Workspace(opts = {}) {
  const sessionId = opts.sessionId || 's1'
  return {
    workspaceId: opts.workspaceId || 'ws1',
    path: opts.path || '/tmp/proj',
    title: opts.title || 'proj',
    sessionIds: opts.sessionIds || [sessionId],
    createdAt: opts.createdAt || ISO,
    updatedAt: opts.updatedAt || ISO,
  }
}

export function alpha3WorkspaceList(items) {
  return { items: Array.isArray(items) ? items : [] }
}

/**
 * @param {object} [opts]
 * @returns {object} conversation.view props for alpha.3
 */
export function alpha3PageProps(opts = {}) {
  const sessionId = opts.sessionId || 's1'
  const items = opts.items || [alpha3Workspace({ sessionId, path: opts.path, workspaceId: opts.workspaceId })]
  const list = alpha3WorkspaceList(items)
  const useWorkspaces =
    opts.useWorkspaces ||
    ((select) => (typeof select === 'function' ? select(list) : list))
  return {
    sessionId,
    useSession: opts.useSession || ((select) => (typeof select === 'function' ? select({ id: sessionId }) : { id: sessionId })),
    useProjection: opts.useProjection || (() => null),
    useConversation: opts.useConversation || ((select) => (typeof select === 'function' ? select({}) : {})),
    useInput: opts.useInput || (() => ({ text: '' })),
    useWorkspaces,
    viewRequest: opts.viewRequest === undefined ? null : opts.viewRequest,
    openView: opts.openView || (() => {}),
    completeViewRequest: opts.completeViewRequest || (() => {}),
  }
}

export const ALPHA3_PAGE_PROP_KEYS = [
  'sessionId',
  'useSession',
  'useProjection',
  'useConversation',
  'useInput',
  'useWorkspaces',
  'viewRequest',
  'openView',
  'completeViewRequest',
]
