#!/usr/bin/env node
/**
 * Phase-0 automated contract for connection.fetch.register against the local
 * official harness checkout (no Vision Host, no hardware).
 *
 * Usage: node scripts/probes/run-fetch-contract.mjs
 */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { access } from 'node:fs/promises'

const here = dirname(fileURLToPath(import.meta.url))
const candidates = [
  join(here, '../../../../../deepseek-harness-desktop-official'),
  join(here, '../../../../../../deepseek-harness-desktop-official'),
  process.env.DSH_HARNESS_ROOT || '',
].filter(Boolean)

async function resolveHarnessRoot() {
  for (const root of candidates) {
    try {
      await access(join(root, 'packages/client/connection/src/rpc-host.ts'))
      return root
    } catch {
      /* try next */
    }
  }
  return null
}

async function main() {
  const root = await resolveHarnessRoot()
  if (!root) {
    console.error('run-fetch-contract: harness checkout not found; set DSH_HARNESS_ROOT')
    process.exit(2)
  }

  const require = createRequire(join(root, 'packages/client/connection/package.json'))
  // Prefer built/dist if present; else load ts via the package's test path pattern is hard.
  // Use dynamic import of the compiled entry when available.
  let HostConnectionService
  const pkgDir = join(root, 'packages/client/connection')
  const entryCandidates = [
    join(pkgDir, 'lib/rpc-host.js'),
    join(pkgDir, 'dist/rpc-host.js'),
    join(pkgDir, 'src/rpc-host.ts'),
  ]
  let loaded = null
  for (const entry of entryCandidates) {
    try {
      await access(entry)
      if (entry.endsWith('.ts')) {
        console.error('run-fetch-contract: need built connection package (lib/ or dist/); found only .ts')
        console.error(`harness root: ${root}`)
        console.error('Build client-connection or run the harness vitest fetch-routes.host.spec.ts instead.')
        process.exit(3)
      }
      loaded = await import(pathToFileURL(entry).href)
      break
    } catch {
      /* next */
    }
  }
  if (!loaded?.HostConnectionService) {
    // Fall back: spawn harness vitest for the official spec.
    const { spawnSync } = await import('node:child_process')
    const r = spawnSync(
      'pnpm',
      ['--filter', '@deepseek-ai/dsh-client-connection', 'exec', 'vitest', 'run', 'tests/fetch-routes.host.spec.ts'],
      { cwd: root, stdio: 'inherit', env: process.env },
    )
    process.exit(r.status === null ? 1 : r.status)
  }

  HostConnectionService = loaded.HostConnectionService
  const { Context } = require('@deepseek-ai/cordis')
  const ctx = new Context()
  const fiber = ctx.plugin((pluginCtx) => {
    new HostConnectionService(pluginCtx, [], /** @type {any} */ ({}))
  })
  await fiber.await()
  const connection = ctx.get('connection')

  const dispose = connection.fetch.register({
    path: '/api/vision-probe',
    methods: ['POST', 'GET'],
    requestBody: 'buffered',
    fetch: async (request) =>
      Response.json({ ok: true, probe: 'fetch', path: new URL(request.url).pathname }),
  })
  const shared = connection.createSharedFetchHandler('/api')
  const res = await shared.fetch(
    new Request('http://host/api/vision-probe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }),
  )
  if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`)
  const json = await res.json()
  if (!json.ok || json.probe !== 'fetch') throw new Error(`bad body ${JSON.stringify(json)}`)

  await dispose()
  const gone = await shared.fetch(new Request('http://host/api/vision-probe', { method: 'POST' }))
  if (gone.status !== 404) throw new Error(`expected 404 after dispose, got ${gone.status}`)

  await fiber.dispose()
  console.log(
    JSON.stringify({
      ok: true,
      event: 'vision.probe.fetch.contract',
      harnessRoot: root,
      checks: ['register', 'dispatch', 'dispose-404'],
    }),
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
