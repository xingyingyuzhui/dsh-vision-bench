# ADR-023: Windows / hardware validation boundary

## Status

Accepted (0.29.0). Codifies the long-standing release rule that macOS automation does not substitute for Windows + hardware acceptance.

## Context

CI and `npm run quality` run on macOS (and Linux) Node. COM ports, ST-LINK/OpenOCD, Keil UV4, and Windows DPI/path behavior are not exercised there. Shipping a tag that implies “Windows verified” without the checklist would mislead operators.

## Decision

1. Automated gates **do not** claim Windows/COM/OpenOCD/Keil hardware pass. Release notes may say “automation green”; they must not say “Windows accepted” unless the checklist is signed.
2. Authoritative checklists live under `docs/WINDOWS_ACCEPTANCE_*.md` (current) and `docs/archive/WINDOWS_ACCEPTANCE_*.md` (historical). Status remains pending until a human fills the record.
3. Path and cwd helpers must stay Windows-safe in unit tests (`path.isAbsolute`, no POSIX-only assumptions), but that only proves string logic—not hardware.
4. Optional sibling `dsh-vision-harness` and Host apply/dispose tests remain environment-agnostic; they are not a hardware substitute.
5. Deferred markers such as `DEFERRED_WINDOWS_ACCEPTANCE` in docs/code comments stay until a signed acceptance file exists for that version line.

## Consequences

- Tagging / marketing “Windows ready” requires an updated acceptance doc with PASS and environment identifiers.
- Contributors add Windows-safe unit tests freely; they still cannot close ADR-023’s hardware checkbox from CI alone.
