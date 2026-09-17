# Phase-0 probe results

Date: 2026-09-17  
Vision branch: `feat/native-web-desktop-migration`  
`dsh --version`: `0.1.6-alpha.1`  
Isolated `DSH_HOME`: `/tmp/dsh-vision-probe-home`  
Profile: `vision-probe-web` (from default `web`)

## Harness contract (automated)

| Check | Result | Notes |
| --- | --- | --- |
| Official `fetch-routes.host.spec.ts` via package vitest filter | skipped | workspace vitest include paths did not pick package-local path; use Web live probe instead |
| Web live: register + POST | **pass** | Host log `vision.probe.fetch.start` |

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

## Desktop (official)

| Check | Result | Notes / log path |
| --- | --- | --- |
| Install path (registry vs tgz) | **pending** | needs manual Desktop GUI / allowlist; product path prefers registry |
| `fetch('/api/vision-probe')` | **pending** | manual DevTools after install |
| Same JSON as Web | pending | |
| Uninstall → 404 | pending | |
| probe-rpc apply (expect fail without webServer) | pending | |

## Agent module identity (B2)

| Check | Result | Notes |
| --- | --- | --- |
| `system.ping` PID vs Host PID | pending | later in stage 0 |

## Decision

- [x] B1 Web pass (register / auth fence / call / uninstall 404)
- [ ] B1 Desktop pass → unlock stage 1 Host `inject=['connection']` work for both carriers
- [ ] B1 Desktop fail → keep `webServer` for Desktop; Web-only Fetch experiment allowed per B0 default
