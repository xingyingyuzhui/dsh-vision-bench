# Native Web / Desktop acceptance matrix (migration stage 5)

Companion to plan `docs/plans/2026-09-17-003-vision-native-web-desktop-migration.md` and `scripts/probes/RESULTS.md`.

**Capability claim (ship):** UI + Agent in-process Host + Modbus TCP/sim over Connection Fetch, no Vision listen port.
**Not claimed:** Official Desktop full Modbus RTU native (`serialport` not in Desktop `allowBuilds`). Windows hardware / Keil-OpenOCD physical chain still follow `docs/WINDOWS_ACCEPTANCE_0.27.md`.

| Scenario | Web macOS | Desktop macOS | Desktop Windows | Gate |
| --- | --- | --- | --- | --- |
| Install / update / remove (registry `name@version`) | manual | **manual product** | manual | Desktop GUI rejects `file:`/`tgz`/`link:` |
| Pack closure + platform `web` | **auto** | **auto** | auto | `check-stage3-pack.mjs` |
| Fetch dispatch + uninstall 404 | **auto** (B1) | **auto** (DesktopHostProcess) | manual mirror | `run-desktop-b1.mts` / Web probe |
| Agent Host identity / no `:3080` | **auto** | **auto** (Desktop B2 pack) | auto | `run-desktop-b2-identity.mts` + unit `run-b2-identity.mjs` |
| Lifecycle dispose / idle debug | **auto** | auto (same code) | auto | `run-stage4-lifecycle.mjs` |
| Settings / points / monitor / Debug UI | manual smoke | manual smoke | manual | same Host command service |
| Modbus TCP / simulator | manual + unit | manual | manual | existing Modbus tests + smoke |
| Modbus RTU / serialport | conditional | **blocked claim** | required before “full HW” | allowBuilds or optional RTU package |
| Keil / OpenOCD | platform | platform | **WINDOWS_ACCEPTANCE** | physical checklist |
| 10–15 min soak | deferred | deferred | deferred | isolate `DSH_HOME`; Web XOR Desktop |

## Rollback units

1. Transport probes / contract tests
2. Connection Fetch adapter + Web compat
3. Agent ownership tightening
4. Pack / native / lifecycle gates

Prefer rolling back the plugin `name@version` in the profile over relying on Desktop auto-rollback (partial profile writes).

## Contract pin

`SUPPORTED_DSH_CONTRACT` remains `0.1.5-rc.1` until a measured lower bound is re-verified on release Desktop; local harness may be `0.1.6-alpha.1`.

## Repro (automated slice)

```bash
node scripts/probes/check-stage5-acceptance.mjs
```
