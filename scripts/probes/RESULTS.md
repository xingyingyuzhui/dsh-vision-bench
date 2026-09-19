# Phase-0 probe results

Date: 2026-09-18  
Vision branch: `feat/native-web-desktop-migration`  
`dsh --version`: `0.1.6-alpha.1`  
Isolated Web `DSH_HOME`: `/tmp/dsh-vision-probe-home`  
Web profile: `vision-probe-web` (from default `web`)  
Desktop B1: isolated temp `DSH_HOME` + harness `DesktopHostProcess` pipe (same `/api` dispatch as Electron)

## Harness contract (automated)

| Check | Result | Notes |
| --- | --- | --- |
| Official `fetch-routes.host.spec.ts` via package vitest filter | skipped | workspace vitest include paths did not pick package-local path; use Web live probe instead |
| Web live: register + POST | **pass** | Host log `vision.probe.fetch.start` |
| `run-desktop-b1.mts` (DesktopHostProcess) | **pass** | 200 + uninstall 404; see Desktop section |

## Web (isolated `DSH_HOME`)

| Check | Result | Notes / log path |
| --- | --- | --- |
| Install probe-fetch tgz | **pass** | `dsh plugin --profile vision-probe-web add …tgz` |
| Composed config includes probe | **pass** | `dsh --dump-config` → `dsh.vision.probe.fetch` |
| Apply without `webServer` inject | **pass** | `inject=['connection']` only |
| Unauthenticated `POST /api/vision-probe` | **pass** | HTTP **401** `unauthorized` (DSH browser auth first) |
| Authenticated `POST /api/vision-probe` | **pass** | HTTP **200** `{ ok:true, probe:'fetch', echo:{ping:1}, … }` after `/?token=…` cookie exchange |
| Remove plugin → route gone | **pass** | HTTP **404** `not found` with valid cookie |
| Re-add without crash | **pass** | reinstall cycle earlier in session |
| probe-rpc apply (webServer path) | pending | control group not yet run on this profile |

Auth recipe: GET `/?token=<launch>` → `Set-Cookie` `dsh-auth-…` → POST `/api/vision-probe` with cookie + `Origin` matching trusted host.

## Desktop (official host pipe)

Carrier under test: `apps/desktop-host` via `DesktopHostProcess.fetch('dsh-app://app/api/...')` — identical `/api` → `connection.createSharedFetchHandler('/api')` path used by the Electron shell. Development project + `--allow-linked-profile`; probe copied into isolated profile `node_modules` (not user `~/.dsh`).

| Check | Result | Notes / log path |
| --- | --- | --- |
| Install path (registry vs tgz) | **lab pass / product pending** | GUI `packageNameFromSpec` rejects `file:`/URL; B1 used profile-local copy like packaging smoke. Product claim still needs registry `name@version`. |
| `fetch('/api/vision-probe')` via host pipe | **pass** | HTTP **200** `{ ok:true, probe:'fetch', echo:{ping:1,carrier:'desktop-host-pipe'}, dshHint:'desktop-b1-pipe' }` |
| Same JSON shape as Web | **pass** | `ok` / `probe` / `path` / `method` / `echo` |
| Uninstall → 404 | **pass** | remove bundle + package, reboot Host → **404** |
| Missing path 404 | **pass** | `/api/vision-probe-missing` → **404** |
| Host log | **pass** | stdout `vision.probe.fetch.start` |
| probe-rpc apply (expect fail without webServer) | pending | control group |
| Electron GUI DevTools click-path | deferred | pipe carrier is the product fetch path; GUI is packaging/install UX only |

Repro:

```bash
cd /Users/qin/DSH/deepseek-harness-desktop-official/apps/desktop
pnpm exec tsx /Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench/scripts/probes/run-desktop-b1.mts
```

## Agent module identity (B2)

| Check | Result | Notes |
| --- | --- | --- |
| Module-unit same-process `system.ping` | **pass** | `node scripts/probes/run-b2-identity.mjs` (not Desktop product proof) |
| Child-process negative (no handle) | **pass** | separate PID, `HOST_UNAVAILABLE`, distinct instance id |
| Fiber names | **pass** | Host `dsh-vision-bench` / Agent `dsh-vision-bench-tools` |
| **Real Desktop B2** (pack → temp profile → DesktopHostProcess) | **pass** | `pnpm exec tsx scripts/probes/run-desktop-b2-identity.mts` from `apps/desktop`: `hasHandle` ∧ `sameModuleInstance` ∧ `dispatchPath=in-process-handle` ∧ no `:3080` |
| Source `link:` install | **rejected by probe** | Desktop B2 installs `file:./.dsh-local-plugins/*.tgz` only |

Instrumentation: `VISION_HOST_CLIENT_INSTANCE_ID` in `vision-host-client.mjs`; echoed by `system.ping` as `clientInstanceId`; `pingVisionHost().identity` compares Agent vs Host.

## Desktop rpc control (scheme B)

| Check | Result | Notes |
| --- | --- | --- |
| probe-rpc on Desktop Host pipe | **pass (rejected)** | `run-desktop-rpc-b.mts`: Host **ready**, apply_failed `cannot get property "webServer" without inject` — soft-fail, Host not blocked |

## Stage 1 (Fetch dispatch)

Date: 2026-09-19

| Check | Result | Notes |
| --- | --- | --- |
| Host `inject=['connection']` | **pass** | Web compat via optional `inject(['webServer'])` |
| Client `createVisionFetchPost` in `client.js` | **pass** | `node scripts/build-client.mjs` rebuilt |
| `debug/events/wait` cancel → `request.signal` | **pass** | `test/interfaces/vision-fetch-cancel.test.mjs` (<2s unblock) |
| Host without webServer still serves Fetch | **pass** | unit: Fetch yes / RPC no / no HTTP command bridge |
| Desktop dispatch smoke | **pass** | `run-desktop-dispatch-smoke.mts`: state 200; abort wait rejected in ~21ms |

## Stage 2 (Agent→Host)

Date: 2026-09-19

| Check | Result | Notes |
| --- | --- | --- |
| No default `127.0.0.1:3080` | **pass** | `hostOriginOf()` empty unless env set |
| No implicit local `executeHostCommand` in dispatch | **pass** | missing handle → `HOST_UNAVAILABLE` |
| `runVisionBench` test helper | **pass** | calls `executeHostCommand` directly (app layer) |
| Production tools `requireHost: true` | **pass** | unchanged; regression in `host-bridge` / stage2 tests |
| Host registration epoch | **pass** | stale disposer cannot clear newer handle |
| Web Agent HTTP bridge | **pass** | still Web-only via `vision-web-compat` + explicit origin |

## Stage 3 (pack / native / install)

Date: 2026-09-19

| Check | Result | Notes |
| --- | --- | --- |
| `exports` / `files` / `npm pack` closure | **pass** | added `vision-fetch-route`, `vision-web-compat`, `empty-state`, `filter-toolbar`; `npm run pack:check` ok (503 files) |
| `dsh.client.platform: web` | **pass** | official client-modules only loads `platform === 'web'` (Desktop included) |
| Desktop peers / reserved host packages | **pass** | no nested Cordis/DSH core deps in plugin `dependencies` |
| `serialport` / `@serialport/bindings-cpp` allowBuilds | **blocked** | not in Desktop `allowBuilds` (only node-pty/koffi/fs-ext/core-build); native `install`/`gypfile` present → product install would fail or RTU unavailable |
| Product install path | **documented** | registry `dsh-vision-bench@<exact>`; `file:`/`tgz` rejected by Desktop GUI |
| Preset seed not in Host `apply()` | **pass** | existing host-contract + preset tests; seed via `scripts/seed-preset.mjs` / settings |
| Capability claim | **limited** | Desktop UI+Fetch+TCP/sim OK; **not** full RTU native until upstream allowBuilds or optional RTU package |

Repro: `node scripts/probes/check-stage3-pack.mjs`

## Stage 4 (lifecycle / idle)

Date: 2026-09-19

| Check | Result | Notes |
| --- | --- | --- |
| Host dispose clears Fetch + Host handle; re-apply restores | **pass** | `test/host-lifecycle-stage4.test.mjs` |
| Late Fetch disposer awaited | **pass** | `registerVisionFetchDispatch` Promise disposer + Host `allSettled` |
| Dispose idempotent | **pass** | double `stop()` |
| Debug idle without sessionId | **pass** | no state/wait polls |
| Debug idle with chat identity but no debug session | **pass** | getState once, one hung `waitForOwnerSession` via `debug/events/wait` |
| Debug `closed` rediscovers | **pass** | clears local session then re-enters wait |
| Debug wait failure budget | **pass** | stops after `DEBUG_WAIT_FAILURE_BUDGET` (5); no reload storm |
| Host dispose clears shared DebugRuntime | **pass** | `getSharedDebugRuntime()` → null |
| State bus last-unsub stops pulls | **pass** | `busPull` guards deleted bus |
| Cancel unblocks wait | **pass** | existing Fetch cancel test |
| 10–15 min soak Web+Desktop | **deferred** | isolate Home; Web XOR Desktop; stage 5 product soak |

Repro: `node scripts/probes/run-stage4-lifecycle.mjs`

## Stage 5 (acceptance / docs / rollback matrix)

Date: 2026-09-19

| Check | Result | Notes |
| --- | --- | --- |
| ADR-012 Fetch carrier | **updated** | UI product path = `/api/vision-bench/dispatch`; RPC Web-compat only |
| ADR-014 idle + Fetch | **updated** | cursor wait; idle hangs on `waitForOwnerSession` |
| Acceptance matrix doc | **added** | `docs/ACCEPTANCE_NATIVE_WEB_DESKTOP.md` |
| Aggregated auto gate | **pass** | `check-stage5-acceptance.mjs` (static + stage3 + stage4) |
| `SUPPORTED_DSH_CONTRACT` | **unchanged** | still `0.1.5-rc.1` pending release re-measure |
| Registry Desktop install | **pending manual** | product `name@version` only |
| Windows HW / RTU native | **deferred** | WINDOWS_ACCEPTANCE + allowBuilds |
| 10–15 min soak | **deferred** | isolate Home; Web XOR Desktop |

Repro: `node scripts/probes/check-stage5-acceptance.mjs`

## Decision

- [x] B1 Web pass (register / auth fence / call / uninstall 404)
- [x] B1 Desktop pass (register / call / uninstall 404 on Desktop Host `/api` pipe) → unlock stage 1 Host `inject=['connection']` work for both carriers
- [x] Real Desktop B2 pass (`run-desktop-b2-identity.mts`) → in-process handle; keep deleting `127.0.0.1:3080` guess; no Desktop→Web port bridge
- [x] Scheme B (`rpc.handle`) rejected on Desktop without `webServer`
- [ ] B1 Desktop fail → keep `webServer` for Desktop; Web-only Fetch experiment allowed per B0 default
- [ ] Product Desktop GUI install still requires registry publish (S6); not a B1 blocker for the transport decision
