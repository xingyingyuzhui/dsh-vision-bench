# ADR-004: Agent / Host state ownership

## Status

Accepted (0.21.0 engineering baseline)

## Context

Both the Harness Agent (tools) and the Host UI can create connections, change points, request writes, and attach evidence. Duplicate business rules caused drift (Unit ID checks, write approval, configVersion).

## Decision

- **Host owns authoritative workspace state** and is the only process that persists it.
- HTTP routes and Agent tools call the **same application services**.
- UI may optimistically update local React state, then reconcile from Host snapshots.
- Agent write-to-device remains **approval-gated** in Host; Agent cannot bypass confirmation.
- Public `bench-*.mjs` facades re-export services during migration so existing tools keep working.

## Write permission matrix

| Actor | Read snapshot | Mutate config | Execute device write |
|---|---|---|---|
| Host UI | Yes | Yes (via Host API) | Yes (user action) |
| Agent tool | Yes | Yes (via Host/app service) | Request only → UI approve |
| I/O worker | N/A | No | Executes approved I/O only |

## Consequences

- Error codes and validation stay centralized in domain/application layers.
- Removing facades requires updating Host, tools, and tests together.
