# ADR-012: Browser operations use authenticated Connection RPC

## Status

Accepted (0.26.1). Supersedes the 0.26.0 spike decision that blocked browser RPC migration.

## Context

DSH 0.1.2-alpha.3 authenticates first-party UI through the Cordis `connection` service. Official Typert Remote (`ctx.remote.*`) still requires compiler output that community JS plugins cannot emit without copying Harness private tooling (see the 0.26.0 spike notes).

However, alpha.3 exposes a documented, authenticated RPC surface on the same Connection carrier:

- Host: `ctx.connection.rpc.handle('/vision-bench', handler)`
- Client: `ctx.connection.rpc.call('/vision-bench', endpoint, payload, signal)`

Harness Connection owns browser authentication, Host/Origin checks, and transport selection. Vision must not register a second `/api` interceptor; API Gateway already owns that channel.

## Decision

1. Move all browser business operations from loopback HTTP routes to Connection RPC on channel `/vision-bench`.
2. Keep UI pages on the stable `post(path, payload, timeoutMs)` abstraction; `bench-runtime.mjs` maps `/dsh-vision-bench/*` paths to RPC endpoints internally.
3. Do not fake authentication with static headers, Origin trust, or shared secrets for browser traffic.
4. Retain exactly one HTTP route for out-of-process Agent bridge: `POST /dsh-vision-bench/command`.
5. The Agent bridge is loopback-only, JSON-only, and requires the process-lifetime random capability issued at Host apply time. Origin checks remain defense-in-depth only and never substitute for capability.
6. If `ctx.connection` is missing on Host or Client, Vision fails closed. There is no browser HTTP fallback.

## Consequences

- Unauthenticated browser sessions cannot read workspace state or mutate configuration through Vision.
- Forged local Origin headers cannot bypass the Agent bridge.
- In-process Agent tools continue to prefer `registerVisionHost()` dispatch; HTTP is only for child processes that cannot attach to the Host Cordis graph.
- Typert Remote remains optional future work if DSH publishes a plugin contribution contract with compiler output; Connection RPC is the supported alpha.3 path for community plugins today.

## Endpoint map

Browser paths such as `/dsh-vision-bench/state` map to RPC endpoints such as `state`. The authoritative list lives in `src/shared/vision-rpc-contract.mjs`.

## Security tests

Contract tests cover:

- Missing or invalid capability on `/dsh-vision-bench/command`.
- Foreign Origin rejection on the bridge.
- RPC registration and disposal on plugin unload.
- Client fail-closed behavior when `ctx.connection.rpc.call` is absent.
