# ADR-001: Modular monolith

## Status

Accepted (0.21.0 engineering baseline)

## Context

Vision Bench is a DeepSeek Harness plugin with Host HTTP routes, Agent tools, a React UI bundle, and a Node Modbus I/O worker. The product must stay installable as one npm package and run inside one Harness process tree.

## Decision

Keep a **modular monolith**:

- One deployable package (`dsh-vision-bench`).
- Internal layers under `src/{domain,application,infrastructure,interfaces,ui}` with dependency rules.
- Existing `bench-*.mjs` files remain as **compatibility facades** until call sites migrate.
- No microservices, no shared cloud database, no separate UI deployable in 0.21.0.

## Consequences

- Faster local iteration and simpler Windows install.
- Refactors must preserve public entrypoints: `host.js`, `client.js`, Agent tool surface.
- Layering is enforced by `dependency-cruiser` and tests, not by process boundaries.
