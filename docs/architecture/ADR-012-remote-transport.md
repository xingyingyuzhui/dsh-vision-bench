# ADR-012: Official Remote transport is not available to this plugin

## Status

Accepted (0.26.0 spike). Blocks full browser RPC migration. Temporary Host HTTP defenses follow this decision; they are not DSH identity.

## Context

DSH 0.1.2-alpha.3 authenticates first-party UI through Typert Remote (`ctx.remote.*`). Official packages such as `@deepseek-ai/dsh-message-feedback` and `@deepseek-ai/dsh-subagent` expose that surface by:

1. Subclassing `TypertRemoteService` from `@deepseek-ai/dsh-typert-protocol`.
2. Marking methods with the `@Remote` decorator (`ClassMethodDecoratorContext`).
3. Shipping compiler output `typert.host.js` and `typert.remote-client.js`.
4. Declaring `dsh.client.inject` entries such as `@deepseek-ai/dsh-api-remotes`.

Vision is a thin-JS community plugin (`host.js` + generated `client.js`). It has no Typert compiler step and must not copy Harness private compiler source.

Checked on this machine against `@deepseek-ai/dsh@0.1.2-alpha.3`:

- Community plugin `inject` keys are Cordis services (`webServer`, `slots`, `locale`, …), not a documented “register a Remote namespace” API.
- There is no public way for an out-of-tree JS plugin to contribute `ctx.remote.visionBench`.
- Adding `@deepseek-ai/dsh-typert-protocol` as a runtime dependency still cannot emit the required descriptor files.

## Decision

1. Do not migrate browser `/dsh-vision-bench/*` calls to official Remote in 0.26.0.
2. Do not fake authentication with a static `X-DSH-Vision-Bench` header.
3. Keep a loopback HTTP adapter until upstream provides a plugin Remote contribution API.
4. Agent in-process dispatch stays the primary tool path. Out-of-process HTTP, if used, carries a process-lifetime random capability, not a shared static secret.
5. File an upstream request: community plugins need an authenticated Host RPC that does not require the Typert compiler.

## Consequences

- Browser same-origin loopback fetch can still call Vision routes; that is not a logged-in DSH session proof.
- Unauthenticated access from a non-loopback address or a foreign Origin is rejected.
- Windows device-chain acceptance remains a separate checklist.
- Revisit this ADR when DSH publishes a plugin Remote contribution contract.

## Spike measurements (local, not a release claim)

- Client inject remains `slots` + `locale`. Adding `remote` without a Host contribution would fail closed at runtime.
- No `typert.host.js` is packed with Vision.
- Bundle size is unchanged by this decision; a full Remote client would require the official remote-client compiler output.
