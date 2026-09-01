# ADR-008: Session-scoped navigation and state buses

## Status

Accepted (0.25.x). Supplemented by [ADR-011](./ADR-011-dsh-alpha3-integration.md) for DSH 0.1.2-alpha.3: cwd now comes from `useWorkspaces`, and cross-view navigation uses `openView` / `viewRequest` instead of `slots.select`.

## Context

Two conversations can share one workspace `cwd`. Navigation, `/state` polling, and Agent Focus used to fall back to an empty-session key or a cwd-only bus, so Session A’s tab and Focus stole Session B.

## Decision

1. Navigation records are keyed only by `sessionId + '\0' + cwd`. There is no empty-session fallback. Anonymous scopes are a separate key and must not write named sessions.
2. Active page scope is `{ token, sessionId, cwd, viewId }`. `wrapVisionPage` reads `sessionId` from page props; it does not guess from Focus.
3. Nav state is `{ preferred, active, agentReturn, leaseUntil, at }`.
   - `init` fills a missing record only, no lease.
   - `manual` updates preferred and active and starts a 10s lease.
   - `agent` outside the lease updates only `active`, saves `agentReturn` on the first jump, and never writes `preferred`.
   - A blocked Agent request writes nothing.
   - Restore uses `agentReturn || preferred`, then clears `agentReturn`.
4. Focus persistence includes `sessionId`. Runtime only routes when `focus.sessionId === activeScope.sessionId`. Other sessions stay badge-only.
5. `/state` pollers are keyed by `stateBusKey(sessionId, cwd)`. Same pair shares one poller.

## Consequences

- Session B’s first monitor view defaults to visualization even if Session A is on alarms.
- User location is not rewritten as preferred by Agent jumps.
- Tests must not treat “source contains a string” as the session-isolation proof.
