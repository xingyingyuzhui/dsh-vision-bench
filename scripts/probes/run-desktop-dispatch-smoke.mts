/**
 * Desktop Fetch *carrier* smoke: proves DesktopHostProcess can register and
 * abort Connection Fetch routes. Uses a minimal stub plugin — NOT the real
 * dsh-vision-bench vision-fetch-route. Stage 5 Vision Fetch evidence comes
 * from run-desktop-b2-identity.mts against the packed tarball.
 *
 * Usage:
 *   cd …/deepseek-harness-desktop-official/apps/desktop
 *   pnpm exec tsx …/scripts/probes/run-desktop-dispatch-smoke.mts
 *
 * Writes scripts/probes/evidence/desktop-dispatch-smoke.json (claim=desktop-fetch-carrier).
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DesktopHostProcess } from '../../../../../deepseek-harness-desktop-official/apps/desktop/src/host-process.ts'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../../../../../deepseek-harness-desktop-official/apps/desktop/src/host-protocol.ts'
import { createPluginProfile } from '../../../../../deepseek-harness-desktop-official/apps/desktop/src/project-manager.ts'
import { prepareDevelopmentProject } from '../../../../../deepseek-harness-desktop-official/apps/desktop/scripts/development-project.ts'

const here = dirname(fileURLToPath(import.meta.url))
const benchRoot = resolve(here, '../..')
const harnessRoot = resolve(here, '../../../../../deepseek-harness-desktop-official')
const appRoot = join(harnessRoot, 'apps', 'desktop')
const buildRoot = join(appRoot, '.desktop-build', 'vision-dispatch-smoke')
const projectDir = join(buildRoot, 'project')
const evidencePath = join(here, 'evidence', 'desktop-dispatch-smoke.json')
const pluginName = '@dsh-vision/probe-dispatch'

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

function packageFingerprint(root: string): string {
  const h = createHash('sha256')
  for (const rel of ['package.json', 'host.js', 'tools.js', 'client.js']) {
    if (!existsSync(join(root, rel))) continue
    h.update(rel)
    h.update('\0')
    h.update(readFileSync(join(root, rel)))
    h.update('\0')
  }
  return h.digest('hex')
}

function gitHead(root: string): string {
  const ran = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })
  return ran.status === 0 ? ran.stdout.trim() : ''
}

function gitDirty(root: string): boolean {
  const ran = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })
  return ran.status === 0 && ran.stdout.trim().length > 0
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function writeEvidence(payload: Record<string, unknown>): void {
  mkdirSync(dirname(evidencePath), { recursive: true })
  writeFileSync(evidencePath, `${JSON.stringify(payload, null, 2)}\n`)
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
const FALLBACK_MS = 20_000
/** @type {boolean | null} */
let lastWaitAborted = null
/** @type {number | null} */
let lastWaitMs = null
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
        const started = Date.now()
        await new Promise((resolve) => {
          if (request.signal.aborted) return resolve()
          let settled = false
          const finish = () => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            request.signal.removeEventListener('abort', onAbort)
            resolve()
          }
          const onAbort = () => finish()
          const timer = setTimeout(finish, FALLBACK_MS)
          request.signal.addEventListener('abort', onAbort, { once: true })
        })
        lastWaitAborted = request.signal.aborted === true
        lastWaitMs = Date.now() - started
        return Response.json({
          ok: true,
          value: {
            ok: true,
            events: [],
            nextCursor: 0,
            closed: false,
            aborted: lastWaitAborted,
            waitMs: lastWaitMs,
            carrier: 'desktop-fetch-carrier',
          },
        })
      }
      return Response.json({
        ok: true,
        value: {
          ok: true,
          endpoint,
          pid: process.pid,
          carrier: 'desktop-fetch-carrier',
          lastWaitAborted,
          lastWaitMs,
        },
      })
    },
  })
  console.info(JSON.stringify({ event: 'vision.probe.dispatch.start', path: PATH, pid: process.pid, claim: 'desktop-fetch-carrier' }))
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
    /** @type {Response | null} */
    let cancelRes = null
    /** @type {Record<string, unknown> | null} */
    let cancelBody = null
    try {
      cancelRes = await pending
      log.cancelOutcome = 'resolved'
      cancelBody = (await cancelRes.json()) as Record<string, unknown>
      log.cancelBody = cancelBody
    } catch (error) {
      log.cancelOutcome = 'rejected'
      log.cancelError = error instanceof Error ? error.message : String(error)
    }
    log.cancelMs = Date.now() - started

    // DesktopHostProcess may reject the client promise on abort before the
    // response body arrives. Side-channel via follow-up state reads proves the
    // stub handler observed request.signal.aborted (and cleared the 20s fallback).
    const deadline = Date.now() + 3000
    /** @type {Record<string, unknown>} */
    let metaValue: Record<string, unknown> = {}
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50))
      const metaHit = await host.fetch(
        new Request('dsh-app://app/api/vision-bench/dispatch', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: 'state', payload: {} }),
        }),
      )
      const metaBody = (await metaHit.json()) as Record<string, unknown>
      metaValue = (metaBody?.value || {}) as Record<string, unknown>
      log.abortMeta = { status: metaHit.status, value: metaValue, polledMs: Date.now() - started }
      if (metaValue.lastWaitAborted === true) break
      // Fallback completed without abort → definitive failure signal.
      if (metaValue.lastWaitAborted === false) break
    }

    const value = (cancelBody && typeof cancelBody === 'object' ? cancelBody.value : null) as
      | Record<string, unknown>
      | null
    const abortObserved =
      metaValue.lastWaitAborted === true &&
      Number(metaValue.lastWaitMs) > 0 &&
      Number(metaValue.lastWaitMs) < 2000 &&
      Number(log.cancelMs) < 2000 &&
      (log.cancelOutcome === 'rejected' ||
        (log.cancelOutcome === 'resolved' &&
          cancelRes?.status === 200 &&
          cancelBody?.ok === true &&
          value?.aborted === true))
    if (!abortObserved) {
      throw new Error(`abort must reach stub handler: ${JSON.stringify(log)}`)
    }
    if (Number(log.cancelMs) > 2000) throw new Error(`cancel too slow: ${JSON.stringify(log)}`)

    log.ok = true
    log.claim = 'desktop-fetch-carrier'
    console.log(JSON.stringify(log, null, 2))

    const pkg = readJson(join(benchRoot, 'package.json')) as { name: string; version: string }
    writeEvidence({
      schemaVersion: 2,
      event: 'vision.probe.desktop.dispatch.evidence',
      ok: true,
      claim: 'desktop-fetch-carrier',
      at: new Date().toISOString(),
      gitCommit: gitHead(benchRoot),
      visionDirty: gitDirty(benchRoot),
      desktopGitCommit: gitHead(harnessRoot),
      desktopDirty: gitDirty(harnessRoot),
      package: `${pkg.name}@${pkg.version}`,
      packageFingerprint: packageFingerprint(benchRoot),
      probeScriptSha256: sha256File(fileURLToPath(import.meta.url)),
      dshVersion: release.version,
      hostProtocolVersion: release.hostProtocolVersion,
      status: hit.status,
      cancelMs: log.cancelMs,
      cancelOutcome: log.cancelOutcome,
      abortObserved: true,
      serverWaitMs: metaValue.lastWaitMs,
    })
  } finally {
    await host.stop().catch(() => undefined)
    rmSync(home, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exitCode = 1
})
