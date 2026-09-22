/**
 * Phase-0 Desktop control: @dsh-vision/probe-rpc (rpc.handle) on Desktop Host.
 * Expectation: apply fails or Host never becomes usable for the RPC channel
 * because rpc.handle still wires through owner.webServer — proves scheme B
 * is not Desktop-ready on dsh 0.1.6-alpha.1.
 *
 * Usage:
 *   cd …/deepseek-harness-desktop-official/apps/desktop
 *   pnpm exec tsx …/scripts/probes/run-desktop-rpc-b.mts
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DesktopHostProcess } from '../../../../../deepseek-harness-desktop-official/apps/desktop/src/host-process.ts'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../../../../../deepseek-harness-desktop-official/apps/desktop/src/host-protocol.ts'
import { createPluginProfile } from '../../../../../deepseek-harness-desktop-official/apps/desktop/src/project-manager.ts'
import { prepareDevelopmentProject } from '../../../../../deepseek-harness-desktop-official/apps/desktop/scripts/development-project.ts'

const here = dirname(fileURLToPath(import.meta.url))
const probeSrc = join(here, 'vision-probe-rpc')
const harnessRoot = resolve(here, '../../../../../deepseek-harness-desktop-official')
const appRoot = join(harnessRoot, 'apps', 'desktop')
const buildRoot = join(appRoot, '.desktop-build', 'vision-probe-rpc-b')
const projectDir = join(buildRoot, 'project')
const pluginName = '@dsh-vision/probe-rpc'

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

async function main(): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), 'dsh-vision-desktop-rpc-b-'))
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
  const pluginDir = join(profile, 'node_modules', '@dsh-vision', 'probe-rpc')
  mkdirSync(dirname(pluginDir), { recursive: true })
  cpSync(probeSrc, pluginDir, {
    recursive: true,
    filter: (src) => !src.endsWith('.tgz') && !src.includes('node_modules'),
  })

  const manifest = readJson(join(profile, 'package.json')) as {
    dependencies: Record<string, string>
    dsh: { profile: { bundles: string[] } }
  }
  manifest.dependencies[pluginName] = '0.0.1'
  manifest.dsh.profile.bundles.push(pluginName)
  writeFileSync(join(profile, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  const stderrChunks: string[] = []
  const host = new DesktopHostProcess(
    process.execPath,
    projectDir,
    profile,
    19_241,
    { ...process.env, DSH_HOME: home, DSH_VISION_PROBE_TAG: 'desktop-rpc-b' },
    (error) => {
      stderrChunks.push(error.message)
    },
  )

  const log: Record<string, unknown> = {
    event: 'vision.probe.desktop.rpc-b',
    home,
    profile,
    dshVersion: release.version,
  }

  // Capture child stderr by monkey-patching after start via a short poll of
  // process output is unreliable; instead re-copy probe with stdout-only events
  // and also scrape any onFailure messages.
  const originalWrite = process.stdout.write.bind(process.stdout)
  const stdoutBuf: string[] = []
  process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
    stdoutBuf.push(text)
    return originalWrite(chunk, ...(rest as []))
  }) as typeof process.stdout.write

  try {
    try {
      const ready = await Promise.race([
        host.start(),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('desktop rpc-b: host ready timed out (15s)')), 15_000)
        }),
      ])
      log.ready = ready
      log.hostStarted = true
    } catch (error) {
      log.hostStarted = false
      log.startError = error instanceof Error ? error.message : String(error)
    }

    const stdout = stdoutBuf.join('')
    const applyFailed = /vision\.probe\.rpc\.apply_failed/.test(stdout)
    const applyStarted = /vision\.probe\.rpc\.start/.test(stdout)
    log.applyFailed = applyFailed
    log.applyStarted = applyStarted
    log.stdoutHits = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.includes('vision.probe.rpc'))
    log.onFailure = stderrChunks

    // Scheme B rejected when: Host boots AND rpc apply failed OR never started;
    // or Host fails entirely because of rpc. Soft-fail path prefers Host up + apply_failed.
    const schemeBRejected = applyFailed || (!applyStarted && log.hostStarted === true) || log.hostStarted === false
    log.ok = schemeBRejected && (log.hostStarted === true || applyFailed)
    log.schemeBRejected = schemeBRejected
    log.decision =
      'rpc.handle depends on webServer; Desktop must use fetch.register (scheme A). Soft-fail keeps Host alive.'
    console.log(JSON.stringify(log, null, 2))
    if (!log.ok) process.exitCode = 1
  } finally {
    process.stdout.write = originalWrite
    await host.stop().catch(() => undefined)
    rmSync(home, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exitCode = 1
})
