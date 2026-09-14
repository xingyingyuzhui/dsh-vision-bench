# ADR-024: Client primitives and bench-* facade retirement

## Status

Accepted (0.28.2). First slice in progress.

## Context

Host code already follows `src/{domain,application,infrastructure,interfaces}` with dependency-cruiser. Client UI grew by page files that copy `dvb-debug-panel` / tab / hint markup, while ~40 root `bench-*.mjs` facades still sit beside `src/`. New UI work was patching className strings instead of composing shared parts.

## Decision

1. Keep the modular monolith (ADR-001). Do not split debug / HMI / monitor into extra npm packages.
2. Client composition is `token → primitive → pattern → feature`.
3. New Client code must not import `bench-*.mjs`. Existing UI imports stay until those call sites migrate; cruiser reports them as `warn`.
4. Shared chrome for debug panels is `createPanel` / `createTabs` / `createHint` in `src/ui/components/primitives.mjs`. A third copy of the same DOM is not allowed.
5. TemperatureDemo sources, project map, call graph and debug session live in `src/ui/debug/fixtures/temperature-demo.mjs`. Pages consume that module.

## Consequences

- Visual tweaks (card radius, panel chrome) go through tokens or one primitive.
- Facade deletion waits until application/RPC/UI call sites import `src/` only.
- `warn` becomes `error` after UI no longer imports `bench-*`.
