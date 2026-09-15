# ADR-024: Client primitives and bench-* facade retirement

## Status

Accepted (0.28.2). **Completed** for the structure/test refactor (P0–P6, 2026-09-15): Client composition and `bench-*` retirement are in force; compatibility facades remain as thin re-exports only.

## Context

Host code already followed `src/{domain,application,infrastructure,interfaces}` with dependency-cruiser. Client UI had grown by page files that copied panel / tab / hint markup, while root `bench-*.mjs` facades sat beside `src/`. New UI work was patching className strings instead of composing shared parts.

## Decision

1. Keep the modular monolith (ADR-001). Do not split debug / HMI / monitor into extra npm packages.
2. Client composition is `token → primitive → pattern → feature`.
3. **No production code under `src/**` may import root `bench-*.mjs`.** dependency-cruiser enforces `ui-no-bench-facades`, `application-no-bench-facades`, `infrastructure-no-bench-facades`, and `interfaces-no-bench-facades` as **errors**.
4. Shared chrome for debug panels is `createPanel` / `createTabs` / `createHint` in `src/ui/components/primitives.mjs`. A third copy of the same DOM is not allowed.
5. TemperatureDemo sources, project map, call graph and debug session live in `src/ui/debug/fixtures/temperature-demo.mjs`. Pages consume that module.
6. Root `bench-*.mjs` files are **compatibility re-exports only** (structure budget: ≤80 lines each). Callers should import `src/` modules directly.

## Consequences

- Visual tweaks (card radius, panel chrome) go through tokens or one primitive.
- Facade deletion can proceed file-by-file once external/docs references are gone; runtime and tests already prefer `src/`.
- Structure budget allowlists for >500-line production and facade modules are empty after P4; remaining files stay under 500 lines (target ≤400).
- ADR-019 through ADR-023 document previously undocumented subsystems (debug/write ownership, alarms, verify, Windows validation boundary).
- Windows / real-hardware acceptance remains out of automated gates (ADR-023); see `docs/WINDOWS_ACCEPTANCE_*.md`.
