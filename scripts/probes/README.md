# Vision Phase-0 connection probes

Minimal plugins for plan `2026-09-17-003` §4 阶段 0 / §5.2.

| Probe | Package | inject | Route |
| --- | --- | --- | --- |
| A | `@dsh-vision/probe-fetch` | `connection` | `POST|GET /api/vision-probe` via `fetch.register` |
| B | `@dsh-vision/probe-rpc` | `connection` | `rpc.handle('/vision-probe')`（对照；Desktop 可能因无 `webServer` 失败） |

No hardware. No Vision workspace. Responses are plain JSON.

## Freeze baseline (fill RESULTS.md)

```bash
dsh --version
node -p process.version
uname -m
git -C /path/to/dsh-vision-bench rev-parse --short HEAD
```

## Pack

```bash
cd scripts/probes/vision-probe-fetch && npm pack
cd ../vision-probe-rpc && npm pack
```

## Isolated Web profile (development tgz OK per §8 S6=B)

```bash
export DSH_HOME=/tmp/dsh-vision-probe-home
rm -rf "$DSH_HOME"
mkdir -p "$DSH_HOME"
dsh --profile vision-probe-web --from-default-profile web --dump-config >/dev/null
# Install (pnpm add via dsh plugin):
dsh plugin --profile vision-probe-web add /absolute/path/to/dsh-vision-probe-fetch-0.0.1.tgz
# Boot web (separate terminal), then in browser DevTools:
fetch('/api/vision-probe', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ping:1 }) })
  .then(r => r.json()).then(console.log)
# Uninstall and confirm 404:
dsh plugin --profile vision-probe-web remove @dsh-vision/probe-fetch
```

Repeat the same calls after **re-add**, **reload**, and **Desktop profile** (official GUI may reject `file:`/`tgz` — record that under B1/S6).

## Contract scripts

```bash
node scripts/probes/run-fetch-contract.mjs   # Connection fetch.register unit
node scripts/probes/run-b2-identity.mjs      # Module-unit Agent/Host identity (not Desktop proof)
# Real Desktop B2 (from apps/desktop):
#   pnpm exec tsx …/scripts/probes/run-desktop-b2-identity.mts
node scripts/probes/check-stage3-pack.mjs    # pack:check + Desktop allowBuilds / install notes
node scripts/probes/run-stage4-lifecycle.mjs # Host dispose / idle debug / cancel gates
node scripts/probes/check-stage5-acceptance.mjs  # stage 5 aggregate + ADR/contract static checks
node scripts/probes/install-desktop-local.mjs    # lab: pack + install into ~/.dsh/profiles/desktop
```

### Real Desktop B2

```bash
cd /path/to/deepseek-harness-desktop-official/apps/desktop
pnpm exec tsx /path/to/dsh-vision-bench/scripts/probes/run-desktop-b2-identity.mts
```

Packs the current tree, installs `file:./.dsh-local-plugins/*.tgz` into a temp profile (no source `link:`), seeds `$DSH_HOME/.agent-presets/vision-b2`, boots `DesktopHostProcess`, mounts via official `agentPresets.mount`, executes `vision_bench` through `tools.execute`, asserts identity (`samePid`, `sameModuleInstance`, `dispatchPath=in-process-handle`, no `:3080`), and exercises real `/api/vision-bench/dispatch` cancel. Claim=`runtime-identity-lab`. Lab install patches `serialport` allowBuilds and uses `strict-dep-builds=false` — not official product install proof. Writes `scripts/probes/evidence/desktop-b2-identity.json` for Stage 5.
### Desktop lab install (local tarball)

Official Desktop GUI only accepts exact `name@version` specs against npmjs; this plugin is not published there yet. Lab install mirrors `dsh-chat-tune`:

1. Quit DeepSeek Harness Desktop.
2. Ensure `~/.dsh/.credentials.yaml` matches the Desktop build (`0.1.6-alpha.1` wants unquoted `version: 1`).
3. `node scripts/probes/install-desktop-local.mjs`
4. Re-open `deepseek-harness-desktop-official/release/DeepSeek Harness.app`.

Profile keeps `dependencies["dsh-vision-bench"]="0.29.0"` (exact) while the lockfile resolves `file:./.dsh-local-plugins/dsh-vision-bench-0.29.0.tgz`. Local `pnpm-workspace.yaml` allowBuilds includes `serialport` for this lab profile only.

## Desktop B1 (host pipe — preferred automation)

Boots the official `DesktopHostProcess` against an isolated profile with the probe copied in. This is the same `/api` dispatch Electron uses (`dsh-app://app/api/...` → desktop-host → `createSharedFetchHandler('/api')`). Does not touch `~/.dsh`.

```bash
cd /path/to/deepseek-harness-desktop-official/apps/desktop
pnpm exec tsx /path/to/dsh-vision-bench/scripts/probes/run-desktop-b1.mts
```

Expect: HTTP 200 JSON `{ ok:true, probe:'fetch', … }`, then uninstall reboot → 404. See [RESULTS.md](./RESULTS.md).

Product GUI install still requires registry `name@version` (Desktop rejects `file:`); that is an S6 packaging gate, not the B1 transport gate.

## Desktop rpc-B control (scheme B rejection)

```bash
cd /path/to/deepseek-harness-desktop-official/apps/desktop
pnpm exec tsx /path/to/dsh-vision-bench/scripts/probes/run-desktop-rpc-b.mts
```

Expect: Host ready + stdout `vision.probe.rpc.apply_failed` (`webServer` without inject). Soft-fail keeps Host alive.

## Desktop dispatch smoke (stage 1)

```bash
cd /path/to/deepseek-harness-desktop-official/apps/desktop
pnpm exec tsx /path/to/dsh-vision-bench/scripts/probes/run-desktop-dispatch-smoke.mts
```

Expect: `POST /api/vision-bench/dispatch` `{endpoint:'state'}` → 200; aborting `debug/events/wait` settles in <2s.

## Desktop (manual GUI, optional)

1. Official Desktop profile is separate from Web (`~/.dsh/profiles/desktop` vs `web`).
2. Prefer registry `name@version` for product claims; tgz only for laboratory notes.
3. In a Vision (or blank) window DevTools, run the same `fetch('/api/vision-probe', ...)`.
4. Record origin, status, body, and Host log lines `vision.probe.fetch.start` into [RESULTS.md](./RESULTS.md).
