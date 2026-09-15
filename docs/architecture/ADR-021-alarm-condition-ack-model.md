# ADR-021: Alarm condition / acknowledge model

## Status

Accepted (0.29.0). Documents the tri-state alarm domain in `src/domain/modbus/alarm-*.mjs`.

## Context

Early alarm state was a boolean “active or not,” which could not express recovered-but-unacked history, process vs communication faults, or Agent/UI acknowledge without losing condition semantics.

## Decision

1. Separate **condition** (`active` / `recovered`) from **status** (`active` / `recovered` / `acked`) and **acknowledged** metadata (`ackedAt` / `ackedBy`).
2. Group alarms into **process** (point threshold / evaluateAlarm) and **comm** (polling / transport health).
3. `evaluateAlarms` is pure domain: inputs are points, values, previous state, and optional polling/connection signals; Host persists the resulting map.
4. `acknowledgeAlarm` / `suggestAlarm` only flip ack fields; they do not invent new breaches.
5. UI monitors consume `groupAlarms` buckets; they do not re-implement severity rules.

## Consequences

- Journal / notify paths can distinguish “still firing” from “recovered awaiting ack.”
- Domain stays free of React and Host I/O; infrastructure only stores and notifies.
- Compatibility facade `bench-alarm.mjs` re-exports the domain modules only.
