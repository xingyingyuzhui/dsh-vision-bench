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

## Contract script (no full DSH boot)

Uses the local official harness checkout if present:

```bash
node scripts/probes/run-fetch-contract.mjs
```

## Desktop

1. Official Desktop profile is separate from Web (`~/.dsh/profiles/desktop` vs `web`).
2. Prefer registry `name@version` for product claims; tgz only for laboratory notes.
3. In a Vision (or blank) window DevTools, run the same `fetch('/api/vision-probe', ...)`.
4. Record origin, status, body, and Host log lines `vision.probe.fetch.start` into [RESULTS.md](./RESULTS.md).
