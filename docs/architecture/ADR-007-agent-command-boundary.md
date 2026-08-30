# ADR-007: Agent command boundary

## Status

Accepted (0.22.0)

## Context

Agent tools and the Host UI share one workspace. If the Agent process constructs serial/Modbus I/O, COM ports split. If Host self-check treats “origin configured” as success, operators see a green Host that cannot actually answer. Configuration writes and post-commit I/O (release COM, notify session) also need a clear boundary so a failed side effect does not lie about whether config was saved.

## Decision

1. **Agent never owns serial or Modbus I/O.** Agent tools dispatch commands; they do not construct `VisionIoBroker`, open COM, or persist workspace files.
2. **Host is the sole I/O and workspace owner.** One process holds the repository and the I/O worker.
3. **Same process prefers in-process dispatch** (`registerVisionHost` + `dispatchVisionCommand`).
4. **Cross-process uses the HTTP Bridge** (`POST /dsh-vision-bench/command`). Missing/wrong origin, timeout, 401, 403, and non-JSON are distinct errors (`HOST_UNAVAILABLE`, `HOST_TIMEOUT`, `HOST_UNAUTHORIZED`, `HOST_FORBIDDEN`, `HOST_INVALID_RESPONSE`).
5. **`system.ping` is a side-effect-free probe.** It must not read serial, create a Modbus client, start polling, spawn a runtime worker, mutate workspace, or require an existing connection.
6. **Config commit vs post-commit.** Order is: validate → `repository.mutateConfig()` persist → release connections → notify → return. Persist failure must not run post-commit effects.
7. **Saved config + failed side effect returns `ok: true`** with `postCommitWarnings` (`CONNECTION_RELEASE_FAILED`, `EVENT_NOTIFY_FAILED`). The caller is not told the write rolled back.
8. **Idempotency keys** are `home|cwd|sessionId|source|commandId` with a payload fingerprint. Reuse of the same id with a different body is `COMMAND_ID_REUSE`.
9. **UI and Agent go through the same application services and repository.** Direct config mutations (`points`, `visualization`, `configureConnection`) are not approval-gated; coil/register writes and flash still are.

## Consequences

- Self-check `host-bridge` is only green after a real `system.ping`.
- HTTP Bridge tests must spawn a real Node child (`process.execPath`, `shell: false`).
- Windows `.tgz` COM acceptance is still required before tagging `v0.22.0`.
