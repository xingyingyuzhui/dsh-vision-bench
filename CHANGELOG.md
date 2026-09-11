# Changelog

## 0.28.0

Requires DSH `0.1.5-rc.1`. Repair release: native DSH contract, upgrade migration, no long-term framework patches.

- Preset overlay migrates `text → prefix` and the tool row to `dsh-vision-bench/agent`, validates with official `dsh-persona` Config, and copies shipped `standard` on first install.
- Settings preset health uses the same schema/tool-row contract, not YAML parse alone.
- Host stays `connection` + `webServer`. Agent is `./agent` (`dsh-vision-bench-tools`) with required `tools` + `systemPrompt`.
- Default bundle no longer inserts `standing-guard` / `scan-guard`. Those remain an optional sibling `dsh-vision-harness` with an explicit DSH version pin, not a production dependency.
- Debug page still does one state query; event wait parks for Agent-started sessions instead of 1 Hz polling.
- Debug wait/wake require owner session id and workspace cwd. Watch values survive pause/step. Host dispose waits for the same RPC unregister promise. Preset health uses official `dsh-persona` Config.

## 0.27.2

Requires DSH `0.1.5-rc.1`. Preset compatibility and standing-mount isolation.

- Migrate Vision persona `config.text` → `config.prefix` and rewrite the managed tool row to `dsh-vision-bench/agent` (no leftover `role`). Overlay validates with the official `dsh-persona` Config before write.
- First install copies the shipped `standard` preset when `agentPresets.copy` is unavailable, then overlays and validates. Failures are not swallowed as success.
- Failed standing mounts are cached by composition digest: deterministic schema errors remount once per generation; transient errors back off; explicit retry and file changes remount.
- Host RPC registration that resolves after dispose still runs the disposer. Shared debug runtime dispose is identity-checked. Agent guidance is a required `systemPrompt` effect and no longer imports the YAML migrator.
- Debug page keeps one state query, parks on `waitEvents` while idle, and wakes when Agent starts a session. Scan flush snapshots the plugin tree once per dirty batch.

## 0.27.0

Requires DSH 0.1.2-alpha.3. Install from an `npm pack` tarball.

Major stabilization, debug runtime hardening, and verification release (PR-A through PR-F):

- **Debug Runtime Authority & Event Contract (PR-A)**:
  - `DebugRuntime` is now the single authoritative state reducer for embedded debugging.
  - Replaced ad-hoc backend state mutations with strict `DebugBackendEvent` contracts (`backend.running`, `backend.stopped`, `backend.console`, `backend.exited`, `backend.error`).
  - True asynchronous pause and stepping semantics: step/pause actions await genuine native target stop events before reporting completion, eliminating fake synchronous stepping.
  - Canonical event naming shared between Host and UI via `src/shared/debug-events.mjs` (`DEBUG_EVENT_TYPES`), eliminating unverified string checks.
- **Host Launch Spec & Session Ownership (PR-B)**:
  - Host resolves immutable `ResolvedDebugLaunchSpec` based on workspace, Keil target, build artifact hash, OpenOCD profile, and probe serial. Agent parameters simplified to `{ action: "start" }`.
  - Removed insecure boolean `payload.approved = true`; debug startup enforces expirable `approvalRequestId` tickets tied to artifact sha256. Stale tickets are rejected with `APPROVAL_STALE`.
  - Target lease identity hardened to physical probe identity (`probeSerial`) rather than workspace directory.
  - Replaced fixed GDB port 3333 with dynamic loopback port allocation (`allocateLoopbackPort`).
- **Windows + STM32 Hardware Smoke Fixture (PR-C)**:
  - Added dedicated minimal STM32 test fixture in `fixtures/stm32-debug-smoke/` (`main.c`, `system_stm32.c`, `openocd.cfg`, `stm32_smoke.axf`).
  - Added formal Windows acceptance checklist template in `docs/WINDOWS_ACCEPTANCE_0.27.md`.
- **Keil UVSC Binary Protocol & Simulator Rewrite (PR-D)**:
  - Replaced legacy mock JSON protocol with genuine 16-byte fixed-header UVSC binary framing (`0x43535655`).
  - Added managed background `UV4DebugProcess` capable of dynamically spawning UV4 without user GUI interaction.
  - Implemented request-response matching and asynchronous event routing (`UV_DBG_CALLBACK`, `UV_ASYNC_MSG`, `UV_DBG_CMD_OUTPUT`).
- **ProgramModel AST & Archify Boundary Decoupling (PR-E)**:
  - Introduced Lezer/Tree-sitter C AST source analyzer (`tree-sitter-c-analyzer.mjs`) with `confidence: 'ast'`.
  - Demoted regex analyzer to heuristic analyzer (`heuristic-c-source-analyzer.mjs`) with `confidence: 'heuristic'`.
  - Decoupled graph traversal algorithms (`findUpstream`, `findDownstream`, `findCausalPath`) into `src/domain/program/graph-analysis.mjs`.
  - Added `runtime-correlation-service.mjs` to map runtime execution locations to ProgramModel function nodes, callers, callees, variable dependencies, and nearest conditions.
- **Verify Productization & Live Telemetry (PR-F)**:
  - Added `TelemetryReader` abstraction reading from live value stores rather than static workspace layout.
  - Removed 2-second hardcoded clamp on `stable-for-duration`; supports dynamic sampling and unconstrained durations bounded by scenario timeouts.
  - Added cancellation support via AbortSignal and distinguished result statuses (`pass`, `fail`, `error`, `timeout`, `cancelled`).
  - Enriched evidence binding firmware hash, artifact sha256, debug session ID, target identity, and telemetry sample series.
  - Exposed `verify` action directly in `vision_debug` agent tool and RPC handler.
  - Added architectural decision records: ADR-016, ADR-017, ADR-018.


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
