/**
 * Real Desktop B2 (runtime-identity lab): pack dsh-vision-bench → install into
 * an isolated Desktop profile (file: tarball, not source link:) → boot
 * DesktopHostProcess → seed `$DSH_HOME/.agent-presets/vision-b2` →
 * `agents.create` + official `agentPresets.mount` → `tools.execute(vision_bench)`
 * system.ping, then exercise real `/api/vision-bench/dispatch` cancel.
 *
 * Claim: runtime-identity-lab only. Install temporarily widens allowBuilds for
 * serialport and uses strict-dep-builds=false — NOT official Desktop product
 * install proof (see Stage 3 / optional RTU package).
 *
 * Usage (from harness apps/desktop so workspace deps resolve):
 *   cd …/deepseek-harness-desktop-official/apps/desktop
 *   pnpm exec tsx …/scripts/probes/run-desktop-b2-identity.mts
 *
 * Writes machine-readable evidence to scripts/probes/evidence/desktop-b2-identity.json
 * for Stage 5. Does not mutate ~/.dsh. Product GUI registry install remains S6.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
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
const buildRoot = join(appRoot, '.desktop-build', 'vision-b2-identity')
const projectDir = join(buildRoot, 'project')
const evidencePath = join(here, 'evidence', 'desktop-b2-identity.json')
const evidenceDir = join(here, 'evidence')
const pluginName = 'dsh-vision-bench'
const probeName = '@dsh-vision/probe-b2-agent'

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

function packageFingerprint(root: string): string {
  const h = createHash('sha256')
  for (const rel of ['package.json', 'host.js', 'tools.js', 'client.js']) {
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

function writeEvidence(payload: Record<string, unknown>): void {
  mkdirSync(dirname(evidencePath), { recursive: true })
  writeFileSync(evidencePath, `${JSON.stringify(payload, null, 2)}\n`)
}

const PRESET_ID = 'vision-b2'

function writeVisionB2Preset(home: string): void {
  const dir = join(home, '.agent-presets', PRESET_ID)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'agent.cordis.yml'),
    '- id: vision-bench-tools\n  name: dsh-vision-bench/agent\n',
  )
}

function writeAgentProbe(pluginDir: string): void {
  mkdirSync(pluginDir, { recursive: true })
  writeFileSync(
    join(pluginDir, 'package.json'),
    `${JSON.stringify(
      {
        name: probeName,
        version: '0.0.1',
        private: true,
        type: 'module',
        main: './host.js',
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(
    join(pluginDir, 'cordis.patch.yml'),
    `- insert:\n    - id: dsh.vision.probe.b2\n      name: '${probeName}'\n`,
  )
  // Official path: agents.create → agentPresets.mount(preset) → tools.execute(vision_bench).
  writeFileSync(
    join(pluginDir, 'host.js'),
    `import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'

export const name = '${probeName}'
export const inject = ['connection', 'agents', 'agentPresets', 'tools']

const PATH = '/api/vision-b2-identity'
const PRESET_ID = '${PRESET_ID}'

export function apply(ctx) {
  if (!ctx.connection?.fetch?.register) throw new Error('b2 probe needs connection.fetch.register')
  if (!ctx.agents?.create) throw new Error('b2 probe needs ctx.agents.create')
  if (!ctx.agentPresets?.mount) throw new Error('b2 probe needs ctx.agentPresets.mount')
  if (!ctx.tools?.execute) throw new Error('b2 probe needs ctx.tools.execute')

  ctx.connection.fetch.register({
    path: PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async () => {
      const pkgRoot = dirname(fileURLToPath(import.meta.resolve('dsh-vision-bench/package.json')))
      const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'))
      const client = await import(
        pathToFileURL(join(pkgRoot, 'src/infrastructure/host/vision-host-client.mjs')).href
      )

      /** @type {Record<string, unknown> | null} */
      let toolsStartLog = null
      const origInfo = console.info
      console.info = (...args) => {
        try {
          const raw = args[0]
          if (typeof raw === 'string' && raw.includes('vision.tools.start')) {
            toolsStartLog = JSON.parse(raw)
          }
        } catch {
          /* ignore */
        }
        return origInfo.apply(console, args)
      }

      let handle
      try {
        handle = await ctx.agents.create({
          sessionId: SessionId('desktop-b2'),
          meta: { cwd: '/tmp/vision-desktop-b2', agentPreset: PRESET_ID },
          setup: async (agentCtx) => {
            await ctx.agentPresets.mount(agentCtx, PRESET_ID)
          },
        })
      } finally {
        console.info = origInfo
      }

      try {
        if (!toolsStartLog || toolsStartLog.event !== 'vision.tools.start') {
          return Response.json({
            ok: false,
            error: 'vision.tools.start was not emitted while mounting preset',
            toolsStartLog,
          }, { status: 500 })
        }

        const registeredToolNames = ctx.tools.schemas(handle.agent).map((s) => s.name)
        if (!registeredToolNames.includes('vision_bench')) {
          return Response.json({
            ok: false,
            error: 'vision_bench missing after agentPresets.mount',
            registeredToolNames,
          }, { status: 500 })
        }

        const presetId = ctx.agentPresets.composedPreset(handle.agent.ctx)
        if (presetId !== PRESET_ID) {
          return Response.json({
            ok: false,
            error: 'composedPreset expected ' + PRESET_ID + ', got ' + String(presetId),
            presetId,
          }, { status: 500 })
        }

        const toolExec = await ctx.tools.execute({
          signal: AbortSignal.timeout(15_000),
          callId: ToolCallId('b2-system-ping'),
          name: 'vision_bench',
          arguments: { action: 'system.ping' },
          agent: handle.agent,
        })

        const toolResult =
          toolExec && typeof toolExec === 'object' && 'value' in toolExec && !toolExec.isError
            ? toolExec.value
            : toolExec
        const pingData = toolResult && typeof toolResult === 'object' ? toolResult.data : null
        const sameModule =
          Boolean(pingData?.clientInstanceId) &&
          pingData.clientInstanceId === client.VISION_HOST_CLIENT_INSTANCE_ID
        const samePid = Number(pingData?.pid) === process.pid
        const hostOrigin = String(process.env.VISION_BENCH_HOST_ORIGIN || process.env.DSH_WEB_ORIGIN || '')

        const body = {
          ok: true,
          pid: process.pid,
          presetId,
          presetMount: 'agentPresets.mount',
          agentFiber: toolsStartLog.fiber || 'dsh-vision-bench-tools',
          agentApplyRan: true,
          toolsStartLog,
          registeredToolNames,
          packageName: pkg.name,
          packageVersion: pkg.version,
          clientInstanceId: client.VISION_HOST_CLIENT_INSTANCE_ID,
          hostEpoch: client.getVisionHostEpoch(),
          hasHandle: Boolean(client.getVisionHost()),
          pingOk: toolResult?.ok === true && toolExec?.isError !== true,
          toolResult,
          toolExecMeta: {
            isError: toolExec?.isError === true,
            hasValue: Boolean(toolExec && typeof toolExec === 'object' && 'value' in toolExec),
          },
          identity: {
            agentPid: process.pid,
            hostPid: Number(pingData?.pid) || null,
            samePid,
            localClientInstanceId: client.VISION_HOST_CLIENT_INSTANCE_ID,
            hostClientInstanceId: pingData?.clientInstanceId || null,
            sameModuleInstance: sameModule,
            hasHandle: Boolean(client.getVisionHost()),
            hostEpoch: client.getVisionHostEpoch(),
            agentFiber: toolsStartLog.fiber || null,
            presetId,
            dispatchPath: 'in-process-handle',
            via: 'agentPresets.mount→tools.execute(vision_bench,system.ping)',
          },
          hostOrigin: hostOrigin || null,
          usedWebPortGuess: /127\\.0\\.0\\.1:3080|localhost:3080/.test(hostOrigin),
          dispatchPath: 'in-process-handle',
          claim: 'runtime-identity-lab',
        }
        console.info(JSON.stringify({ event: 'vision.probe.b2.agent', ...body, at: Date.now() }))
        return Response.json(body)
      } finally {
        if (handle && typeof handle.dispose === 'function') await handle.dispose().catch(() => undefined)
      }
    },
  })
  console.info(JSON.stringify({
    event: 'vision.probe.b2.start',
    path: PATH,
    presetId: PRESET_ID,
    pid: process.pid,
    at: Date.now(),
  }))
}
`,
  )
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function gitDirty(root: string): boolean {
  const ran = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })
  return ran.status === 0 && ran.stdout.trim().length > 0
}

function gitDescribe(root: string): { commit: string; dirty: boolean } {
  return { commit: gitHead(root), dirty: gitDirty(root) }
}

function childProcessNegative(installedRoot: string): Record<string, unknown> {
  const childScript = `
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
const root = ${JSON.stringify(installedRoot)}
const client = await import(pathToFileURL(join(root, 'src/infrastructure/host/vision-host-client.mjs')).href)
const ping = await client.pingVisionHost({ cwd: '', sessionId: 'b2-child' })
console.log(JSON.stringify({
  childPid: process.pid,
  hasHandle: Boolean(client.getVisionHost()),
  localInstanceId: client.VISION_HOST_CLIENT_INSTANCE_ID,
  pingOk: ping.ok === true,
  available: ping.available === true,
  errorCode: ping.errorCode || null,
  dispatchWouldBe: client.describeHostBridge().transport,
}))
`
  const ran = spawnSync(process.execPath, ['--input-type=module', '-e', childScript], {
    encoding: 'utf8',
    env: {
      ...process.env,
      VISION_BENCH_HOST_ORIGIN: 'http://127.0.0.1:1',
    },
  })
  if (ran.status !== 0) {
    return {
      case: 'child-process-negative',
      pass: false,
      error: ran.stderr || ran.stdout || `exit ${String(ran.status)}`,
    }
  }
  const line = ran.stdout.trim().split('\n').filter(Boolean).at(-1)
  const body = JSON.parse(line || '{}')
  const pass =
    body.hasHandle === false &&
    body.pingOk === false &&
    body.available === false &&
    body.childPid !== process.pid
  return { case: 'child-process-negative', pass, parentPid: process.pid, ...body }
}

async function probeRealVisionFetch(host: DesktopHostProcess): Promise<Record<string, unknown>> {
  const stateHit = await host.fetch(
    new Request('dsh-app://app/api/vision-bench/dispatch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: 'state', payload: {} }),
    }),
  )
  const stateBody = (await stateHit.json()) as Record<string, unknown>
  const stateOk = stateHit.status === 200 && stateBody.ok === true

  const ac = new AbortController()
  const pending = host.fetch(
    new Request('dsh-app://app/api/vision-bench/dispatch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        endpoint: 'debug/events/wait',
        payload: { cwd: '/tmp/vision-desktop-b2', sessionId: 'desktop-b2-fetch', cursor: 0, timeoutMs: 20000 },
      }),
      signal: ac.signal,
    }),
  )
  setTimeout(() => ac.abort(), 25)
  const started = Date.now()
  /** @type {Record<string, unknown>} */
  let cancel: Record<string, unknown> = { outcome: 'pending' }
  try {
    const res = await pending
    const body = (await res.json()) as Record<string, unknown>
    cancel = {
      outcome: 'resolved',
      status: res.status,
      body,
      ms: Date.now() - started,
      aborted:
        body?.ok === true &&
        typeof body.value === 'object' &&
        body.value !== null &&
        (body.value as Record<string, unknown>).ok === true,
    }
  } catch (error) {
    cancel = {
      outcome: 'rejected',
      error: error instanceof Error ? error.message : String(error),
      ms: Date.now() - started,
    }
  }

  // Real Vision wait soft-resolves on abort (unit test contract) or rejects via pipe.
  const cancelFast = Number(cancel.ms) < 2000
  const cancelOk =
    cancelFast &&
    (cancel.outcome === 'rejected' ||
      (cancel.outcome === 'resolved' && Number(cancel.status) === 200 && cancel.aborted === true))

  return {
    claim: 'desktop-vision-fetch',
    stateOk,
    stateStatus: stateHit.status,
    stateBody,
    cancel,
    cancelOk,
    ok: stateOk && cancelOk,
  }
}

async function main(): Promise<void> {
  const pkg = readJson(join(benchRoot, 'package.json')) as { name: string; version: string }
  const home = mkdtempSync(join(tmpdir(), 'dsh-vision-desktop-b2-'))
  const profile = join(home, 'profiles', 'desktop')
  const localDir = join(profile, '.dsh-local-plugins')
  const tarballName = `${pkg.name}-${pkg.version}.tgz`
  const visionGit = gitDescribe(benchRoot)
  const desktopGit = gitDescribe(harnessRoot)
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
  mkdirSync(localDir, { recursive: true })
  writeVisionB2Preset(home)

  const pack = spawnSync('npm', ['pack', '--pack-destination', localDir], {
    cwd: benchRoot,
    encoding: 'utf8',
  })
  if (pack.status !== 0) {
    throw new Error(pack.stderr || pack.stdout || 'npm pack failed')
  }
  const tarballPath = join(localDir, tarballName)
  if (!existsSync(tarballPath)) {
    throw new Error(`expected pack output ${tarballPath}`)
  }
  const tarballSha256 = sha256File(tarballPath)
  const probeScriptSha256 = sha256File(fileURLToPath(import.meta.url))
  const tarballArtifactRel = join('artifacts', `${pkg.name}-${pkg.version}.tgz`)
  const tarballArtifactPath = join(evidenceDir, tarballArtifactRel)
  mkdirSync(dirname(tarballArtifactPath), { recursive: true })
  copyFileSync(tarballPath, tarballArtifactPath)
  if (sha256File(tarballArtifactPath) !== tarballSha256) {
    throw new Error('failed to persist B2 tarball artifact with matching sha256')
  }

  // Install packed plugin (exact file: — not source link:).
  // LAB ONLY: official Desktop keep strictDepBuilds=true and does not allow
  // serialport in allowBuilds. Widening here proves runtime identity after a
  // modified install policy — not product-config installability of full RTU.
  const workspacePath = join(profile, 'pnpm-workspace.yaml')
  let workspace = readFileSync(workspacePath, 'utf8')
  if (!workspace.includes('serialport: true')) {
    workspace = workspace.replace(
      'node-addon-require-builtin: false\n',
      `node-addon-require-builtin: false
  serialport: true
  '@serialport/bindings-cpp': true
`,
    )
    writeFileSync(workspacePath, workspace)
  }

  const manifest = readJson(join(profile, 'package.json')) as {
    dependencies: Record<string, string>
    dsh: { profile: { bundles: string[] } }
  }
  manifest.dependencies[pluginName] = `file:./.dsh-local-plugins/${tarballName}`
  manifest.dsh.profile.bundles = [
    ...new Set([...(manifest.dsh.profile.bundles || []), pluginName, probeName]),
  ]
  writeFileSync(join(profile, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  const install = spawnSync('pnpm', ['install', '--config.strict-dep-builds=false'], {
    cwd: profile,
    encoding: 'utf8',
    env: process.env,
  })
  if (install.status !== 0) {
    throw new Error(`pnpm install failed:\n${install.stdout}\n${install.stderr}`)
  }

  const installedRoot = join(profile, 'node_modules', pluginName)
  if (!existsSync(join(installedRoot, 'host.js'))) {
    throw new Error(`packed plugin missing at ${installedRoot}`)
  }
  const st = lstatSync(installedRoot)
  if (st.isSymbolicLink()) {
    throw new Error('Desktop B2 refuses source link: install; expected real packed package')
  }

  writeAgentProbe(join(profile, 'node_modules', '@dsh-vision', 'probe-b2-agent'))
  const afterProbe = readJson(join(profile, 'package.json')) as {
    dependencies: Record<string, string>
    dsh: { profile: { bundles: string[] } }
  }
  afterProbe.dependencies[probeName] = '0.0.1'
  if (!afterProbe.dsh.profile.bundles.includes(probeName)) {
    afterProbe.dsh.profile.bundles.push(probeName)
  }
  writeFileSync(join(profile, 'package.json'), `${JSON.stringify(afterProbe, null, 2)}\n`)

  const host = new DesktopHostProcess(process.execPath, projectDir, profile, 19_241, {
    ...process.env,
    DSH_HOME: home,
    VISION_BENCH_HOST_ORIGIN: '',
    DSH_WEB_ORIGIN: '',
  })

  const log: Record<string, unknown> = {
    event: 'vision.probe.desktop.b2',
    home,
    profile,
    package: `${pkg.name}@${pkg.version}`,
    tarball: tarballPath,
    tarballSha256,
    probeScriptSha256,
    installedRoot,
    sourceRoot: benchRoot,
    dshVersion: release.version,
    visionGit,
    desktopGit,
    presetId: PRESET_ID,
  }

  try {
    const ready = await host.start()
    log.ready = ready

    const hit = await host.fetch(
      new Request('dsh-app://app/api/vision-b2-identity', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    )
    const body = (await hit.json()) as Record<string, unknown>
    log.status = hit.status
    log.body = body

    const identity = (body.identity || {}) as Record<string, unknown>
    const toolsStart = (body.toolsStartLog || {}) as Record<string, unknown>
    const registered = Array.isArray(body.registeredToolNames)
      ? (body.registeredToolNames as unknown[]).map(String)
      : []
    const pass =
      hit.status === 200 &&
      body.ok === true &&
      body.pingOk === true &&
      body.hasHandle === true &&
      body.agentApplyRan === true &&
      body.presetMount === 'agentPresets.mount' &&
      body.presetId === PRESET_ID &&
      body.agentFiber === 'dsh-vision-bench-tools' &&
      body.claim === 'runtime-identity-lab' &&
      toolsStart.event === 'vision.tools.start' &&
      toolsStart.hasHandle === true &&
      registered.includes('vision_bench') &&
      identity.samePid === true &&
      identity.sameModuleInstance === true &&
      identity.hasHandle === true &&
      identity.dispatchPath === 'in-process-handle' &&
      identity.via === 'agentPresets.mount→tools.execute(vision_bench,system.ping)' &&
      body.usedWebPortGuess === false &&
      body.dispatchPath === 'in-process-handle'

    const visionFetch = await probeRealVisionFetch(host)
    log.visionFetch = visionFetch

    const child = childProcessNegative(installedRoot)
    log.child = child
    log.ok = pass && child.pass === true && visionFetch.ok === true
    log.claim = 'runtime-identity-lab'
    log.installPolicy = {
      serialportAllowBuildsPatched: true,
      strictDepBuilds: false,
      officialProductInstall: false,
    }

    console.log(JSON.stringify(log, null, 2))
    if (!log.ok) {
      throw new Error(
        `Desktop B2 failed: ${JSON.stringify({
          pass,
          childPass: child.pass,
          visionFetchOk: visionFetch.ok,
          body,
        })}`,
      )
    }

    writeEvidence({
      schemaVersion: 2,
      event: 'vision.probe.desktop.b2.evidence',
      ok: true,
      claim: 'runtime-identity-lab',
      at: new Date().toISOString(),
      gitCommit: visionGit.commit,
      visionDirty: visionGit.dirty,
      desktopGitCommit: desktopGit.commit,
      desktopDirty: desktopGit.dirty,
      package: `${pkg.name}@${pkg.version}`,
      packageFingerprint: packageFingerprint(benchRoot),
      tarballSha256,
      tarballArtifact: tarballArtifactRel,
      probeScriptSha256,
      dshVersion: release.version,
      hostProtocolVersion: release.hostProtocolVersion,
      presetId: PRESET_ID,
      presetMount: 'agentPresets.mount',
      agentApplyRan: true,
      toolsStartEvent: toolsStart.event,
      registeredToolNames: registered,
      identity: {
        samePid: identity.samePid === true,
        sameModuleInstance: identity.sameModuleInstance === true,
        hasHandle: identity.hasHandle === true,
        dispatchPath: identity.dispatchPath,
        via: identity.via,
        agentFiber: identity.agentFiber,
        presetId: identity.presetId,
      },
      childPass: child.pass === true,
      visionFetch: {
        ok: visionFetch.ok === true,
        stateOk: visionFetch.stateOk === true,
        cancelOk: visionFetch.cancelOk === true,
        claim: 'desktop-vision-fetch',
      },
      installPolicy: log.installPolicy,
    })
  } finally {
    await host.stop().catch(() => undefined)
    rmSync(home, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
