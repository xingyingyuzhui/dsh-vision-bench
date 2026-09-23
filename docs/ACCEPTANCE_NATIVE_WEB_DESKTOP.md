# Native Web / Desktop acceptance matrix (migration stage 5–7)

Companion to plan `docs/plans/2026-09-17-003-vision-native-web-desktop-migration.md` and `scripts/probes/RESULTS.md`.

**Capability claim (ship):** UI + Agent in-process Host + Modbus TCP/sim over Connection Fetch, no Vision listen port.

**Verified automated (2026-09-19, `feat/native-web-desktop-migration`):**

| Gate | Result |
| --- | --- |
| `npm run quality` | **pass** |
| Host lease (A dispose ↛ B) | **pass** (`test/host-lease.test.mjs`) |
| Web compat inject fiber lifecycle | **pass** |
| Debug idle `waitForOwnerSession` | **pass** |
| Fetch dispatch contract (no local 64 KiB cap) | **pass** |
| Real Desktop B2 (pack → temp profile → DesktopHostProcess → agentPresets.mount → vision_bench) | **lab pass** (`runtime-identity-lab`; not official allowBuilds product install) |
| Desktop Vision Fetch (real tarball `/api/vision-bench/dispatch`) | **lab pass** (bundled in B2 evidence) |
| Desktop Fetch carrier smoke (stub plugin) | **carrier pass** (`run-desktop-dispatch-smoke.mts`; not Vision integration) |
| Stage 3 pack / Stage 4 lifecycle | **pass** |
| Stage 5 Desktop evidence gate | **required** — evidence must match HEAD + fingerprints + identity/cancel fields; dirty trees rejected unless `VISION_STAGE5_ALLOW_DIRTY=1` |

**Not claimed / deferred:**

- Official Desktop full Modbus RTU native (`serialport` not in Desktop `allowBuilds`) — optional RTU package or upstream allowBuilds.
- Windows hardware / Keil-OpenOCD physical chain — `docs/WINDOWS_ACCEPTANCE_0.27.md`.
- 10–15 min soak (CPU/log storm) — run manually with isolated `DSH_HOME`; Web XOR Desktop, never both on one Home.
- Product GUI install — registry `name@version` only (Desktop rejects `file:`/`tgz`/`link:`).

| Scenario | Web macOS | Desktop macOS | Desktop Windows | Gate |
| --- | --- | --- | --- | --- |
| Install / update / remove (registry `name@version`) | manual | **manual product** | manual | Desktop GUI rejects `file:`/`tgz`/`link:` |
| Pack closure + platform `web` | **auto** | **auto** | auto | `check-stage3-pack.mjs` |
| Fetch dispatch + uninstall 404 | **auto** (B1) | **auto** (DesktopHostProcess) | manual mirror | `run-desktop-b1.mts` / Web probe |
| Agent Host identity / no `:3080` | **auto** | **lab auto** (Desktop B2 pack + `agentPresets.mount` → `tools.execute`; serialport allowBuilds patched) | auto | `run-desktop-b2-identity.mts` + evidence JSON; claim=`runtime-identity-lab` |
| Lifecycle dispose / idle debug | **auto** | auto (same code) | auto | `run-stage4-lifecycle.mjs` |
| Settings / points / monitor / Debug UI | manual smoke | manual smoke | manual | same Host command service |
| Modbus TCP / simulator | manual + unit | manual | manual | existing Modbus tests + smoke |
| Modbus RTU / serialport | conditional | **blocked claim** | required before “full HW” | allowBuilds or optional RTU package |
| Keil / OpenOCD | platform | platform | **WINDOWS_ACCEPTANCE** | physical checklist |
| 10–15 min soak | deferred | deferred | deferred | isolate `DSH_HOME`; Web XOR Desktop |

## Manual soak checklist (stage 7)

Run Web and Desktop **separately** (different `DSH_HOME` / quit the other app).

### Web

1. Open Vision page; create/switch presets.
2. Agent starts Debug → page discovers via hung `waitForOwnerSession`.
3. Stop Debug, start again → rediscovery.
4. Configure points / monitor / TCP or sim.
5. Unload and reload plugin; confirm no duplicate routes.
6. Idle 10–15 min: CPU near baseline, no log storm.

### Desktop

1. Use packed plugin (lab: `install-desktop-local.mjs`; product: registry).
2. Same-origin Fetch (`/api/vision-bench/dispatch`).
3. Agent in-process Host (`system.ping` identity).
4. Reload Host / toggle `webServer` if present; re-enter Vision.
5. Repeat Debug start/stop; idle CPU back to baseline.
6. Confirm no duplicate route, infinite wait, reload loop, or continuous log spam.

## Rollback units

1. Transport probes / contract tests
2. Connection Fetch adapter + Web compat
3. Agent ownership tightening
4. Pack / native / lifecycle gates

Prefer rolling back the plugin `name@version` in the profile over relying on Desktop auto-rollback (partial profile writes).

## Contract pin

`SUPPORTED_DSH_CONTRACT` is `0.1.7-alpha.2`, re-measured against release Desktop `0.1.7-alpha.2` (declarative agent presets). The preset path is dual-track: DSH `0.1.5-rc.1`–`0.1.6` keep the `$DSH_HOME/.agent-presets` directory seed, `0.1.7+` uses `agentPresets.register()` declarations.

## Repro (automated slice)

```bash
npm run quality
node scripts/probes/check-stage3-pack.mjs
node scripts/probes/run-stage4-lifecycle.mjs
node scripts/probes/run-b2-identity.mjs
# from deepseek-harness-desktop-official/apps/desktop (writes scripts/probes/evidence/*.json + artifacts):
pnpm exec tsx /path/to/dsh-vision-bench/scripts/probes/run-desktop-b2-identity.mts
pnpm exec tsx /path/to/dsh-vision-bench/scripts/probes/run-desktop-dispatch-smoke.mts
# or: VISION_STAGE5_RUN_DESKTOP=1 node scripts/probes/check-stage5-acceptance.mjs
node scripts/probes/check-stage5-acceptance.mjs
```

Stage 5 reports `labOk` (gates + evidence) and `releaseOk` (labOk ∧ clean Vision/Desktop trees). Exit code follows **`releaseOk`** only. `VISION_STAGE5_ALLOW_DIRTY=1` can make `labOk` true on dirty trees for local experiments, but `releaseOk` stays false until both repos are clean and evidence is regenerated. Desktop B2 claim is `runtime-identity-lab` only; `uiFetchTcpSim` remains `manual` until a dedicated Desktop sim/TCP smoke exists.