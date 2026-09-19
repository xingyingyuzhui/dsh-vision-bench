/**
 * Real Desktop B2: pack dsh-vision-bench → install into an isolated Desktop
 * profile (file: tarball, not source link:) → boot DesktopHostProcess →
 * prove Host + Agent module identity via system.ping / VISION_HOST_CLIENT_INSTANCE_ID.
 *
 * Usage (from harness apps/desktop so workspace deps resolve):
 *   cd …/deepseek-harness-desktop-official/apps/desktop
 *   pnpm exec tsx …/scripts/probes/run-desktop-b2-identity.mts
 *
 * Does not mutate ~/.dsh. Product GUI registry install remains a separate S6 gate.
 */
import { spawnSync } from 'node:child_process'
import {
  existsSync,
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
const pluginName = 'dsh-vision-bench'
const probeName = '@dsh-vision/probe-b2-agent'

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
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
  writeFileSync(
    join(pluginDir, 'host.js'),
    `import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const name = '${probeName}'
export const inject = ['connection']

const PATH = '/api/vision-b2-identity'

export function apply(ctx) {
  if (!ctx.connection?.fetch?.register) throw new Error('b2 probe needs connection.fetch.register')
  ctx.connection.fetch.register({
    path: PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async () => {
      const agentMod = await import('dsh-vision-bench/agent')
      const pkgRoot = dirname(fileURLToPath(import.meta.resolve('dsh-vision-bench/package.json')))
      const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'))
      const client = await import(
        pathToFileURL(join(pkgRoot, 'src/infrastructure/host/vision-host-client.mjs')).href
      )
      const ping = await client.pingVisionHost({
        cwd: '/tmp/vision-desktop-b2',
        sessionId: 'desktop-b2',
      })
      const hostOrigin = String(process.env.VISION_BENCH_HOST_ORIGIN || process.env.DSH_WEB_ORIGIN || '')
      const body = {
        ok: true,
        pid: process.pid,
        agentFiber: agentMod.name,
        agentExport: typeof agentMod.apply === 'function',
        packageName: pkg.name,
        packageVersion: pkg.version,
        clientInstanceId: client.VISION_HOST_CLIENT_INSTANCE_ID,
        hostEpoch: client.getVisionHostEpoch(),
        hasHandle: Boolean(client.getVisionHost()),
        pingOk: ping.ok === true,
        ping,
        identity: ping.identity || null,
        hostOrigin: hostOrigin || null,
        usedWebPortGuess: /127\\.0\\.0\\.1:3080|localhost:3080/.test(hostOrigin),
        dispatchPath: ping.identity?.dispatchPath || null,
      }
      console.info(JSON.stringify({ event: 'vision.probe.b2.agent', ...body, at: Date.now() }))
      return Response.json(body)
    },
  })
  console.info(JSON.stringify({ event: 'vision.probe.b2.start', path: PATH, pid: process.pid, at: Date.now() }))
}
`,
  )
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

async function main(): Promise<void> {
  const pkg = readJson(join(benchRoot, 'package.json')) as { name: string; version: string }
  const home = mkdtempSync(join(tmpdir(), 'dsh-vision-desktop-b2-'))
  const profile = join(home, 'profiles', 'desktop')
  const localDir = join(profile, '.dsh-local-plugins')
  const tarballName = `${pkg.name}-${pkg.version}.tgz`
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

  // Install packed plugin (exact file: — not source link:).
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
  // Guard: must not be a symlink back to the source tree.
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
    // Explicitly clear Web origin guesses.
    VISION_BENCH_HOST_ORIGIN: '',
    DSH_WEB_ORIGIN: '',
  })

  const log: Record<string, unknown> = {
    event: 'vision.probe.desktop.b2',
    home,
    profile,
    package: `${pkg.name}@${pkg.version}`,
    tarball: tarballPath,
    installedRoot,
    sourceRoot: benchRoot,
    dshVersion: release.version,
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
    const pass =
      hit.status === 200 &&
      body.ok === true &&
      body.pingOk === true &&
      body.hasHandle === true &&
      body.agentFiber === 'dsh-vision-bench-tools' &&
      body.agentExport === true &&
      identity.samePid === true &&
      identity.sameModuleInstance === true &&
      identity.hasHandle === true &&
      identity.dispatchPath === 'in-process-handle' &&
      body.usedWebPortGuess === false &&
      body.dispatchPath === 'in-process-handle'

    const child = childProcessNegative(installedRoot)
    log.child = child
    log.ok = pass && child.pass === true

    console.log(JSON.stringify(log, null, 2))
    if (!log.ok) {
      throw new Error(`Desktop B2 failed: ${JSON.stringify({ pass, childPass: child.pass, body })}`)
    }
  } finally {
    await host.stop().catch(() => undefined)
    rmSync(home, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
