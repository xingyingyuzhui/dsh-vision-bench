# ADR-003: Workspace persistence

## Status

Accepted (0.22.0: Host repository is the sole writer)

## Context

Workspace JSON currently mixes Keil project settings, Modbus topology, live values, frames, and journal-like data. Concurrent UI flag toggles and polling writes need safer update semantics than “replace whole document”. v4 splits config.json and runtime.json; startup sweep must mutate runtime, not only the legacy sidecar.

## Decision

- Treat Host as the **sole writer** of workspace files.
- Split concerns into config / runtime / journal / frames / trends stores.
- All mutations go through a workspace repository with expected-version checks and atomic writes.
- `mutateConfig` is the only path that increments `configVersion`. `mutateRuntime` / `updateRuntime` update values, frames, tasks, alarms, and trends without bumping version.
- Whole-document replace is limited to migration / test seed (`replaceForMigrationSync`, `seedWorkspaceForTestSync`). Live writers use `mutateConfig` / `mutateRuntime` on the same async queue (ADR-006).
- The read–modify–save cycle stays inside the workspace lock. Callers must not load, drop the lock, then replace.
- Legacy single-file workspaces remain readable; migration is backup-first and rollback-safe.
- Startup sweep walks repository keys (legacy JSON, v4 dirs, and in-migration trees), writes `runtime.json`, dual-writes the rollback file, and only counts `swept` after a successful persist.

## Config vs runtime

| Kind | Examples | Persist |
|---|---|---|
| Config | connections, devices, points, polling, visualization, configVersion | Yes (`config`) |
| Runtime | latest values, alarm state, last errors, last sample times | Yes (`runtime`), no live handles |
| Ephemeral | open sockets, worker PIDs, in-flight writes | No |

## Consequences

- UI optimistic updates must reconcile with Host snapshots.
- Agent mutations route through Host APIs / application services, not direct `writeFileSync`.
- Interrupted `running` tasks become `error` on Host start and stay `error` after reload.
