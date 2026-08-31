# ADR-009: Visualization schema v2 is an explicit, recoverable write

## Status

Accepted (0.25.x)

## Context

`normalizeVisualization()` used to upgrade v1 to v2 on every read. Runtime collection then rewrote `config.json`, so background sampling silently migrated layouts. A failed or partial write would be unrecoverable.

## Decision

1. Split **read** and **migrate**:
   - `normalizeVisualizationForRead` keeps `schemaVersion: 1` and may attach in-memory default layouts.
   - `migrateVisualizationToV2` runs only on `visualization.add|update|remove|layout` or an explicit visualization save.
2. `config.json` is written on config commits. `runtime.json` is written on values/trend/alarms/frames/tasks. Runtime commits must not rewrite visualization schema.
3. Healthy v4 workspaces no longer rewrite the legacy single-file workspace JSON on every sync.
4. The first v1→v2 config write copies `config.json` to `config.pre-visualization-v2.bak.json` (atomic, no overwrite). Backup failure aborts with `VIZ_MIGRATION_BACKUP_FAILED`.
5. v2 documents include `{ schemaVersion: 2, minimumPluginVersion: '0.25.1', columns: 12, components }`.
6. A newer schema or higher `minimumPluginVersion` is read-only (`VIZ_SCHEMA_UNSUPPORTED`). The plugin must not downgrade-overwrite it.

## Consequences

- Opening a page or running collection leaves v1 on disk.
- Layout can restart from v2 after an explicit save.
- Operators can restore from the v2 pre-backup if an old normalizer would have dropped layout.
