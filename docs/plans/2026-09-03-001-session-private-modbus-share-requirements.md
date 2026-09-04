---
title: Session-private Modbus/HMI config with optional workspace share
artifact_readiness: requirements-only
date: 2026-09-03
status: settled
---

# Product Contract: Session-private HMI config + workspace share

## Problem

Today, connections / devices / points / visualization are keyed only by workspace `cwd`. Any Session on that workspace sees and edits the same config. Users need Session-private by default, with an explicit opt-in to live-share into the workspace.

## Settled decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Share semantics when enabled | **Live shared editing** — shared slices are one workspace-public config; all Sessions on that cwd see and edit the same shared slice |
| 2 | Toggle placement | **设置 → Vision** |
| 3 | Toggle shape | **Master “共享到工作区”** + checkboxes: **连接/设备**, **点位**, **可视化** (each optional) |
| 4 | Defaults | Master **off**; all checkboxes **off** → everything Session-private |
| 5 | Turning share off | **Confirm dialog**, then **revoke**: other Sessions lose those shared slices; data returns to the Session that owned / last held the private view (see revoke rules below) |
| 6 | Existing cwd-shared data migration | **Claim to first Session** that opens the workspace after upgrade as that Session’s private config; other Sessions start empty until someone re-enables share |
| 7 | Agent tool writes | Write to the **invoking Session’s private layer** (same default as UI) |

## User-visible behavior

### Settings → Vision

- Section title roughly: 「工作区共享」 / “Workspace sharing”.
- Master switch: 共享到工作区.
- When master is on, show three checkboxes (disabled / ignored when master off):
  - 连接与设备
  - 点位
  - 可视化
- Turning master **off** (or unchecking a category that is currently shared) opens a confirm:
  - Copy: other Sessions will lose visibility of those items; continue?
  - Confirm → revoke that category (or all if master off).
  - Cancel → leave switches as before.

### Runtime visibility

- Session A with all private: only A sees A’s connections/devices/points/viz.
- Session B on same cwd: does not see A’s private config.
- A enables master + 连接/设备: that slice becomes workspace-shared; B immediately sees and can edit the same connections/devices. Points/viz remain A-private until their boxes are checked.
- Mixed mode is allowed (e.g. share connections only).

### Revoke (after confirm)

- Revoked category leaves the shared layer and becomes private again on the Session that turned sharing off (that Session keeps editing continuity).
- Other Sessions’ UI refresh: those items disappear from their view.
- If another Session was mid-edit on a shared item, after revoke their next save must fail closed with a clear error (not silently recreate into shared).

### Migration (upgrade)

- On first load of a legacy workspace that has only the old single shared `modbus` blob and no session-partition metadata:
  - Assign the entire legacy config as **private** to the **first Session** that successfully opens / loads that workspace after upgrade.
  - Persist claim so a later Session does not steal it.
  - Subsequent Sessions on that cwd see empty private config until share is enabled.

### Agent

- Agent create/update of connections/devices/points/viz targets the **sessionId** of the tool invocation’s Session private layer.
- Agent does not auto-publish to workspace share; user must enable share in Settings.

## Success criteria

1. Two Sessions, same cwd, defaults: A creates a connection → B’s HMI does not list it.
2. A enables share + 连接/设备 → B sees and can edit that connection without restart.
3. A confirms revoke → B no longer sees it; A still has it privately.
4. Granular: share only 点位 → B sees points but not A’s private connections (and vice versa).
5. Visualization follows the same private/share/revoke rules when its checkbox is used.
6. Legacy workspace: first Session keeps old config privately; second Session does not inherit it.
7. Agent write with sessionId lands in that Session’s private layer only.
8. Settings toggles live under 设置 → Vision; defaults all off.

## Non-goals (this iteration)

- Read-only share / publish-a-copy semantics.
- Per-item share (individual connection toggle).
- Cross-workspace share.
- Changing Modbus wire protocol, serial model, or viz widget schema.
- Windows device acceptance.
- Re-opening browser HTTP business routes.

## Open for planning (HOW, not WHAT)

- On-disk layout for private vs shared slices and `configVersion` per slice.
- Exact claim key for “first Session” migration.
- Conflict / CONFIG_DRIFT rules when two Sessions edit a shared slice.
- Whether 连接与设备 is one checkbox or split (product says one combined checkbox).

## Risks to carry into plan

- Polling / COM ownership remains cwd-scoped; private configs can still contend for the same port.
- Dual write paths (`mutateConfig` vs legacy `pointsOp`/`connectOp`) must both respect scope.
- Visualization bindings to point ids when points and viz have different share flags.
