# Changelog

## 0.26.1

Requires DSH 0.1.2-alpha.3. Install from an `npm pack` tarball.

Security and integration fixes (no new product features):

- Browser business operations use authenticated `connection.rpc` on `/vision-bench`; loopback Origin no longer substitutes for capability on the Agent HTTP bridge (`POST /dsh-vision-bench/command` only).
- Agent focus requests are preserved when Vision pages are not mounted; `viewRequest` is not dropped while workspace cwd is still loading.
- Project workspace state is isolated by session, cwd, Keil project, and target; stale map/file responses are rejected.
- Project graph layout, truncation hints, keyboard navigation, and `/` search shortcut guards are corrected.
- `npm run test:full` and `npm run pack:check` pass.

Windows serial / Modbus / OpenOCD device-chain acceptance remains **not** signed off. See `docs/WINDOWS_ACCEPTANCE_0.26.md`.

## 0.26.0

Requires DSH 0.1.2-alpha.3. Install from an `npm pack` tarball. This is an integration migration, not a visualization schema change.

Breaking Harness integration:

- Session workspace path comes from `useWorkspaces` items by `sessionId`. `useSessions` is gone.
- Cross-tab navigation uses `openView` + `dvb1:` focus tokens and `viewRequest`. `slots.select` is gone.
- Client inject is `slots` + `locale` + `connection` (authenticated RPC).
- Plugin notices include a `randomUUID` `id` and the alpha.3 `source` contract.
- Browser Host calls no longer use a static `X-DSH-Vision-Bench` header. Loopback Origin is required; Agent HTTP uses a process-lifetime capability. Official Typert Remote is not available to this thin-JS plugin (ADR-012).
- Vision preset changes apply to **new sessions**. Open sessions keep their generation.

Windows serial / Modbus / OpenOCD device-chain acceptance is **not** signed off. See `docs/WINDOWS_ACCEPTANCE_0.26.md`.

Profile risk (not Vision bugs): `dsh-excel-panel` 0.6.1 and `@omdsh-dev/dsh-genui` 0.8.4 may still fail on alpha.3. Isolation Profile + Vision tarball is the compatibility evidence.
