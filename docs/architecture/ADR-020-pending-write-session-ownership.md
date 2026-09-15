# ADR-020: Pending Modbus write session ownership

## Status

Accepted (0.29.0). Documents the write-approval ownership model already enforced by `write-approval-service` and related RPC tests.

## Context

Modbus writes that require human approval create a pending entry. If any session could approve or reject any pending id, Agent/UI races and cross-session spoofing would mutate devices incorrectly.

## Decision

1. Pending writes are keyed by workspace `cwd` + pending id and store the originating session in params / runtime context.
2. `takePendingWrite` / approve / reject require a matching caller `sessionId`. Foreign sessions get `SESSION_MISMATCH` (or equivalent) and must not consume the entry.
3. Anonymous callers without a session get `SESSION_REQUIRED`; the pending entry survives.
4. List APIs are session-scoped: a session only sees its own pending writes.
5. Config/endpoint drift checks still run for the owning session at approve time; ownership does not skip safety checks.

## Consequences

- Write approval is a session-private capability, same spirit as debug ownership (ADR-019).
- Tests in `test/workspace/write-approval-session.test.mjs` are the contract; Host and Agent paths must share that service.
