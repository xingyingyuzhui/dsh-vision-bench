/**
 * Stage-1 smoke: Desktop Host pipe + connection-only Host + Fetch dispatch.
 * Boots a minimal in-profile plugin that mirrors vision-fetch-route registration
 * (avoids copying the full vision-bench dependency graph into the Desktop profile).
 *
 * Usage:
 *   cd …/deepseek-harness-desktop-official/apps/desktop
 *   pnpm exec tsx …/scripts/probes/run-desktop-dispatch-smoke.mts
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DesktopHostProcess } from '../../../../../deepseek-harness-desktop-official/apps/desktop/src/host-process.ts'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../../../../../deepseek-harness-desktop-official/apps/desktop/src/host-protocol.ts'
import { createPluginProfile } from '../../../../../deepseek-harness-desktop-official/apps/desktop/src/project-manager.ts'
import { prepareDevelopmentProject } from '../../../../../deepseek-harness-desktop-official/apps/desktop/scripts/development-project.ts'

const here = dirname(fileURLToPath(import.meta.url))
const harnessRoot = resolve(here, '../../../../../deepseek-harness-desktop-official')
const appRoot = join(harnessRoot, 'apps', 'desktop')
const buildRoot = join(appRoot, '.desktop-build', 'vision-dispatch-smoke')
const projectDir = join(buildRoot, 'project')
const pluginName = '@dsh-vision/probe-dispatch'

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

function writeDispatchProbe(pluginDir: string): void {
  mkdirSync(pluginDir, { recursive: true })
  writeFileSync(
    join(pluginDir, 'package.json'),
    `${JSON.stringify({
      name: pluginName,
      version: '0.0.1',
      private: true,
      type: 'module',
      main: './host.js',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }, null, 2)}\n`,
  )
  writeFileSync(
    join(pluginDir, 'cordis.patch.yml'),
    `- insert:\n    - id: dsh.vision.probe.dispatch\n      name: '${pluginName}'\n`,
  )
  writeFileSync(
    join(pluginDir, 'host.js'),
    `export const name = '${pluginName}'
export const inject = ['connection']
const PATH = '/api/vision-bench/dispatch'
const ALLOWED = new Set(['state', 'debug/events/wait'])
export function apply(ctx) {
  ctx.connection.fetch.register({
    path: PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      let body
      try { body = await request.json() } catch {
        return Response.json({ ok: false, error: { code: 'json', message: 'invalid JSON' } }, { status: 400 })
      }
      const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : ''
      if (!ALLOWED.has(endpoint)) {
        return Response.json({ ok: false, error: { code: 'request', message: 'unknown endpoint' } }, { status: 400 })
      }
      if (endpoint === 'debug/events/wait') {
        await new Promise((resolve) => {
          if (request.signal.aborted) return resolve()
          request.signal.addEventListener('abort', () => resolve(), { once: true })
          setTimeout(resolve, 50)
        })
        return Response.json({
          ok: true,
          value: { ok: true, events: [], nextCursor: 0, closed: false, aborted: request.signal.aborted },
        })
      }
      return Response.json({
        ok: true,
        value: { ok: true, endpoint, pid: process.pid, carrier: 'desktop-dispatch-smoke' },
      })
    },
  })
  console.info(JSON.stringify({ event: 'vision.probe.dispatch.start', path: PATH, pid: process.pid }))
}
`,
  )
}

async function main(): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), 'dsh-vision-dispatch-smoke-'))
  const profile = join(home, 'profiles', 'desktop')
  const release = {
    schemaVersion: 1 as const,
    version: String(readJson(join(appRoot, 'package.json')).version),
    hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
    nodeVersion: process.versions.node,
    pnpmVersion: String(readJson(join(appRoot, 'node_modules', 'pnpm', 'package.json')).version),
  }

  rmSync(buildRoot, { recursive: true, force: true })
  prepareDevelopmentProject({
    projectDir,
    cliDir: join(harnessRoot, 'apps', 'cli'),
    hostDir: join(harnessRoot, 'apps', 'desktop-host'),
    dependencyDir: join(harnessRoot, 'node_modules', '.pnpm', 'node_modules'),
    release,
  })
  createPluginProfile(profile)
  const pluginDir = join(profile, 'node_modules', '@dsh-vision', 'probe-dispatch')
  writeDispatchProbe(pluginDir)
  const manifest = readJson(join(profile, 'package.json')) as {
    dependencies: Record<string, string>
    dsh: { profile: { bundles: string[] } }
  }
  manifest.dependencies[pluginName] = '0.0.1'
  manifest.dsh.profile.bundles.push(pluginName)
  writeFileSync(join(profile, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  const host = new DesktopHostProcess(
    process.execPath,
    projectDir,
    profile,
    19_261,
    { ...process.env, DSH_HOME: home },
  )
  const log: Record<string, unknown> = { event: 'vision.probe.desktop.dispatch', dshVersion: release.version }
  try {
    await host.start()
    const hit = await host.fetch(
      new Request('dsh-app://app/api/vision-bench/dispatch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint: 'state', payload: {} }),
      }),
    )
    const body = (await hit.json()) as Record<string, unknown>
    log.status = hit.status
    log.body = body
    if (hit.status !== 200 || body.ok !== true) throw new Error(`dispatch failed: ${JSON.stringify(log)}`)

    const ac = new AbortController()
    const pending = host.fetch(
      new Request('dsh-app://app/api/vision-bench/dispatch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          endpoint: 'debug/events/wait',
          payload: { cursor: 0, timeoutMs: 20000 },
        }),
        signal: ac.signal,
      }),
    )
    setTimeout(() => ac.abort(), 20)
    const started = Date.now()
    try {
      await pending
      log.cancelOutcome = 'resolved'
    } catch (error) {
      log.cancelOutcome = 'rejected'
      log.cancelError = error instanceof Error ? error.message : String(error)
    }
    log.cancelMs = Date.now() - started
    if (Number(log.cancelMs) > 2000) throw new Error(`cancel too slow: ${JSON.stringify(log)}`)

    log.ok = true
    console.log(JSON.stringify(log, null, 2))
  } finally {
    await host.stop().catch(() => undefined)
    rmSync(home, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exitCode = 1
})
