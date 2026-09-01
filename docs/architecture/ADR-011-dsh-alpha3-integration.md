# ADR-011: DSH 0.1.2-alpha.3 Harness integration

## Status

Accepted (0.26.0). Supplements ADR-008 for navigation; does not change visualization or workspace disk schema.

## Context

DSH CLI on this machine is `@deepseek-ai/dsh@0.1.2-alpha.3` (`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh`). Conversation View owner props no longer include `useSessions` cwd maps or `slots.select`. Vision 0.25 still read those, so pages mounted with an empty cwd.

Upstream types used as the contract (from the installed alpha.3 tree, not memory):

- `ConvViewOwnerProps`: `viewRequest`, `openView(view, focus)`, `completeViewRequest()`  
  `node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts`
- `ConversationViewRequest`: `{ view, focus }`  
  `.../contract/views.d.ts`
- `WorkspaceView`: `{ workspaceId, path, title, sessionIds, createdAt, updatedAt }`  
  `dsh-cordis-client-runner` type catalog
- Workspace list snapshot consumed as `{ items: WorkspaceView[] }` via `useWorkspaces(selector)`

## Decision

1. Resolve workspace path only through `useWorkspaces` → `items` whose `sessionIds` contain `props.sessionId` → `path`.
2. `props.scope.cwd` is a short-term fallback until 0.26.0; tests must mark it deprecated.
3. Cross-view navigation uses `openView` + versioned `dvb1:` focus tokens. Target views consume `viewRequest` only when `viewRequest.view` equals their view id, then call `completeViewRequest()` once.
4. Client inject is `slots` + `locale`. Notices are static JSON objects with `id` from `node:crypto.randomUUID`.
5. Browser business RPC must not use a shared static header as authentication (see stage 4).

## Consequences

- Tests that only pass `useSessions` no longer represent alpha.3.
- ADR-008 session+cwd nav keys remain; the missing piece is obtaining cwd from workspaces.
- Windows device-chain acceptance stays a separate checklist.
