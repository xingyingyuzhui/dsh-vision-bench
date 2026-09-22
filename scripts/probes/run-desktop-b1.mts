/**
 * Phase-0 Desktop B1: boot the official desktop-host pipe carrier with
 * @dsh-vision/probe-fetch linked into an isolated profile, then POST
 * /api/vision-probe through DesktopHostProcess.fetch (same path as
 * dsh-app:// renderer fetch). No Electron GUI; no user ~/.dsh mutation.
 *
 * Usage (from harness apps/desktop, so workspace deps resolve):
 *   pnpm exec tsx /abs/path/to/scripts/probes/run-desktop-b1.mts
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
const probeSrc = join(here, 'vision-probe-fetch')
const harnessRoot = resolve(here, '../../../../../deepseek-harness-desktop-official')
const appRoot = join(harnessRoot, 'apps', 'desktop')
const buildRoot = join(appRoot, '.desktop-build', 'vision-probe-b1')
const projectDir = join(buildRoot, 'project')
const pluginName = '@dsh-vision/probe-fetch'

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

async function main(): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), 'dsh-vision-desktop-b1-'))
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
  const pluginDir = join(profile, 'node_modules', '@dsh-vision', 'probe-fetch')
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

  const host = new DesktopHostProcess(
    process.execPath,
    projectDir,
    profile,
    // Non-zero inspect port enables --allow-linked-profile (dev project symlinks).
    19_231,
    { ...process.env, DSH_HOME: home, DSH_VISION_PROBE_TAG: 'desktop-b1-pipe' },
  )

  const log: Record<string, unknown> = {
    event: 'vision.probe.desktop.b1',
    home,
    profile,
    projectDir,
    dshVersion: release.version,
  }

  try {
    const ready = await host.start()
    log.ready = ready

    const miss = await host.fetch(new Request('dsh-app://app/api/vision-probe-missing', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }))
    log.missingStatus = miss.status

    const hit = await host.fetch(new Request('dsh-app://app/api/vision-probe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ping: 1, carrier: 'desktop-host-pipe' }),
    }))
    const body = await hit.json() as Record<string, unknown>
    log.status = hit.status
    log.body = body

    if (hit.status !== 200 || body.ok !== true || body.probe !== 'fetch') {
      throw new Error(`Desktop B1 failed: ${JSON.stringify(log)}`)
    }

    await host.stop()

    // Uninstall: remove bundle entry + package, reboot Host, expect 404.
    const after = readJson(join(profile, 'package.json')) as {
      dependencies: Record<string, string>
      dsh: { profile: { bundles: string[] } }
    }
    delete after.dependencies[pluginName]
    after.dsh.profile.bundles = after.dsh.profile.bundles.filter((name) => name !== pluginName)
    writeFileSync(join(profile, 'package.json'), `${JSON.stringify(after, null, 2)}\n`)
    rmSync(pluginDir, { recursive: true, force: true })

    const host2 = new DesktopHostProcess(
      process.execPath,
      projectDir,
      profile,
      19_232,
      { ...process.env, DSH_HOME: home, DSH_VISION_PROBE_TAG: 'desktop-b1-removed' },
    )
    try {
      await host2.start()
      const gone = await host2.fetch(new Request('dsh-app://app/api/vision-probe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }))
      log.uninstallStatus = gone.status
      if (gone.status !== 404) {
        throw new Error(`Desktop B1 uninstall expected 404, got ${String(gone.status)}`)
      }
    } finally {
      await host2.stop().catch(() => undefined)
    }

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
