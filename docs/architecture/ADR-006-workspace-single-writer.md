# ADR-006: Workspace single writer queue

## Status

Accepted (0.22.0)

## Context

v4 workspaces split `config.json` and `runtime.json`, but writers still used two unrelated locks: an async Promise chain (`runExclusive`) and a sync `Set` (`runExclusiveSync`). Config mutations and live commits (values, trend, alarms, frames) could interleave and overwrite each other. A third queue inside `bench-modbus-commit` made the race worse.

## Decision

- All live Host writes go through `runExclusive(workspaceKey)`.
- `mutateConfig` and `mutateRuntime` share that queue, re-read the workspace **inside** the lock, then persist atomically.
- `runExclusiveSync` is only for Host-start migration / test seeding (`replaceForMigrationSync`, `seedWorkspaceForTestSync`).
- `configVersion` increments only on `mutateConfig` success. Runtime writes never bump it.
- Side effects that touch live I/O (`notifyConnectionRelease`) run **after** a successful persist (post-commit). Drift, validation failure, and write failure must not release COM handles.
- If persist succeeded but release/notify fails, the mutation still returns `ok: true` plus `postCommitWarnings`. Config is not rolled back.
- Device writes and firmware download stay on the approval cards. Configuration does not.

## Consequences

- A lost poll sample is retried; a lost config/runtime merge is not acceptable.
- Callers must `await` runtime persists (`commitReadResult`, polling enable, frame append).
- Crash mid-write still relies on atomic JSON replace of `config.json` / `runtime.json`.
