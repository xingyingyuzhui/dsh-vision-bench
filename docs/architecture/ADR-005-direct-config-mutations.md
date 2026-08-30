# ADR-005: Direct configuration mutations

## Status

Accepted (0.22.0)

## Context

0.21.0 routed Agent configuration edits through RFC 6902 config drafts. Users had to apply a draft before connections, devices, points, or visualization components appeared on the HMI. That extra confirmation loop hid Agent work, duplicated Host write paths, and mixed “change a table” with “write a coil on the wire.”

Hardware writes (coils/registers, firmware download, reset) still need a human on the confirmation card. Configuration does not.

## Decision

Config drafts are **retired**. There is one Host command path:

```text
Agent / UI
    │
    ▼
Host Command Service
    │
    ├── 配置命令：直接校验并保存
    ├── 运行命令：连接、读取、采集
    └── 高风险命令：创建用户确认请求
            │
            ▼
WorkspaceRepository + 唯一 I/O Worker
```

- Agent may mutate connections, devices, points, monitor/alarm flags and thresholds, and visualization components **directly**.
- Host is the only process that applies and persists configuration.
- Callers send explicit `connectionId` / `deviceId` / `pointId` / `visualizationId` plus `expectedConfigVersion`.
- Host validates, writes atomically, increments `configVersion`, records the operation, and returns previous/next version plus affected ids.
- The HMI refreshes from the Host snapshot. There is no draft card and no silent `propose*` alias.
- Writes to a live device, firmware download, and reset stay on the existing approval cards (endpoint fingerprint, configVersion, 5 minute TTL, read-back, `WRITE_OUTCOME_UNKNOWN`).

Do not keep a “direct mutate” path beside a “draft mutate” path.

## Consequences

- Old `action=draft` and `proposeAdd` / `proposeUpdate` / `proposeRemove` return `OP_REMOVED`.
- Workspaces that still contain `configDrafts` ignore the field on load and drop it on the next save.
- JSON Patch (`fast-json-patch`) leaves the package if nothing else needs it.
- Optimistic concurrency (`CONFIG_DRIFT`) replaces draft baseline drift.
