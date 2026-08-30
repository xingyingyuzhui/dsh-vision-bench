# ADR-004: Agent / Host state ownership

## Status

Accepted (0.22.0: Host is the only state and I/O owner)

## Context

Both the Harness Agent (tools) and the Host UI can create connections, change points, request writes, and attach evidence. Duplicate business rules caused drift (Unit ID checks, write approval, configVersion). If the Agent plugin loads store/I-O modules on its own, a second Worker can grab COM ports that Host already owns.

## Decision

- **Host owns authoritative workspace state** and is the only process that persists it.
- **Host owns the single Vision I/O Worker.** Agent never constructs `VisionIoBroker`, never opens COM, and never writes workspace files.
- Agent tools normalize arguments and dispatch a Host command (`source`, `action`, `payload`, `expectedConfigVersion`). In-process handle wins; otherwise Host HTTP. Failures are distinguished (`HOST_UNAVAILABLE`, `HOST_TIMEOUT`, `HOST_UNAUTHORIZED`, `HOST_FORBIDDEN`, `HOST_INVALID_RESPONSE`, `HOST_HTTP_STATUS_ERROR`).
- `system.ping` is the only supported Host probe and must be side-effect free (see ADR-007).
- HTTP routes and Agent tools call the **same Host command / application services**.
- UI may optimistically update local React state, then reconcile from Host snapshots.
- Configuration mutations apply immediately after validation (see ADR-005). They are not approval-gated.
- Agent write-to-device and firmware download remain **approval-gated** in Host; Agent cannot bypass confirmation.
- Public `bench-*.mjs` facades re-export services during migration so existing Host call sites keep working. The Agent tool module must not import store, broker, or transport.

## Write permission matrix

| Actor | Read snapshot | Mutate config | Execute device write |
|---|---|---|---|
| Host UI | Yes | Yes (via Host API) | Yes (user action) |
| Agent tool | Yes (via Host command) | Yes (direct config command, version-checked) | Request only → UI approve |
| I/O worker | N/A | No | Executes approved I/O only |

## Consequences

- Error codes and validation stay centralized in domain/application layers.
- Removing facades requires updating Host, tools, and tests together.
