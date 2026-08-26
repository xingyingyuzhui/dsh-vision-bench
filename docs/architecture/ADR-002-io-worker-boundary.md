# ADR-002: I/O worker boundary

## Status

Accepted (0.21.0 engineering baseline)

## Context

Modbus RTU/TCP and serial capture can block, crash native bindings, or hold port locks. Running them on the Host event loop risks freezing Harness UI and Agent tools.

## Decision

- Keep Modbus / serial I/O in an **independent Worker** (`runtime/vision-io-worker.mjs` + `runtime/io/*`).
- Host talks to the worker only through the existing I/O contract (`bench-io-contract.mjs` / broker).
- UI and Agent never import `serialport` / `modbus-serial` directly.
- Worker owns live handles; Host owns workspace config and user-visible state snapshots.

## Consequences

- Port ownership and crash isolation stay at the worker boundary.
- Application services must go through ports/adapters, not reopen COM from Host.
- Contract changes need paired Host + worker updates and contract tests.
