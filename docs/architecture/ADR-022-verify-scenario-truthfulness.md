# ADR-022: Verify scenario truthfulness and hard timeout

## Status

Accepted (0.29.0). Documents `src/application/verify/*` behavior shipped with the verify productization work.

## Context

Scenario verification must never report PASS when telemetry is missing, alarms are active, debug sessions are absent for `no.exception`, or evaluation overruns the wall clock. Soft timeouts and swallowed errors create false confidence for Agent and UI.

## Decision

1. Verify runs are Host-owned application services with a hard `timeoutMs` abort (`verify-timeout`); overrun yields `status: timeout`, not a partial pass.
2. Assertions that require live sources (`no.alarm`, `no.exception`, point/telemetry age) **fail closed** when the source is missing, stale beyond `maxAgeMs`, or reports active alarms.
3. Cancellation maps to `status: cancelled`; it is distinct from timeout and from assertion failure.
4. Sampling / assertion evaluation / orchestration are separate modules; the public `createVerifyService` facade stays the single entry for RPC/command handlers.
5. Evidence attached to a run must reflect actual samples and assertion outcomes—no synthetic “green” evidence on failure paths.

## Consequences

- Agent and UI can treat verify status as trustworthy for automation gates.
- Tests under `test/verify/` encode truthfulness; regressions that invent pass on empty telemetry are release blockers.
