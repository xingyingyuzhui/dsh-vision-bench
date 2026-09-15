# ADR-019: Debug session ownership and owner-scoped control

## Status

Accepted (0.29.0). Documents behavior that shipped with the debug runtime (ADR-013 / ADR-017) and was never given its own ADR.

## Context

Debug commands (continue, pause, step, breakpoint, wait) can arrive from Browser UI and Agent tools in the same workspace. Without a strict owner, one session could control another session’s GDB/OpenOCD processes or steal wait/wake.

## Decision

1. Every `DebugSession` records an immutable `ownerSessionId` at start.
2. Control and inspect ops resolve the session only when `ownerSessionId` matches the caller (`debug-session-scope` / `debug-command-service`). Mismatch yields ownership errors, not “session not found” when the id exists for another owner.
3. Target lease grant and approval ticket consume are bound to the same owner session and workspace cwd.
4. Event wait/wake and long-poll subscription are owner-scoped; foreign sessions cannot park on or drain another session’s event cursor.

## Consequences

- Multi-session debug in one workspace is safe: only the owner drives the backend.
- UI and Agent must pass the live conversation `sessionId` on every debug command.
- Tests under `test/debug/` and `test/workspace/` lock the owner checks; do not weaken them for convenience APIs.
