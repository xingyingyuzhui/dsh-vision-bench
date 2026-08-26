# ADR-003: Workspace persistence

## Status

Accepted (direction for 0.21.0; migration lands in persistence phase)

## Context

Workspace JSON currently mixes Keil project settings, Modbus topology, live values, frames, and journal-like data. Concurrent UI flag toggles and polling writes need safer update semantics than “replace whole document”.

## Decision

- Treat Host as the **sole writer** of workspace files for 0.21.0.
- Split concerns over time into config / runtime / journal / frames / trends stores.
- All mutations go through a workspace repository with expected-version checks and atomic writes.
- Legacy single-file workspaces remain readable; migration must be backup-first and rollback-safe.

## Config vs runtime

| Kind | Examples | Persist |
|---|---|---|
| Config | connections, devices, points, polling, visualization, configVersion | Yes (`config`) |
| Runtime | latest values, alarm state, last errors, last sample times | Yes (`runtime`), no live handles |
| Ephemeral | open sockets, worker PIDs, in-flight writes | No |

## Consequences

- UI optimistic updates must reconcile with Host snapshots.
- Agent mutations route through Host APIs / application services, not direct `writeFileSync`.
