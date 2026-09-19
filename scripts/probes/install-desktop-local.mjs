#!/usr/bin/env node
/**
 * Install current dsh-vision-bench into ~/.dsh/profiles/desktop using the same
 * local-tarball pattern as dsh-chat-tune (package.json exact version + lockfile file:).
 *
 * Does NOT publish to npm. For lab Desktop only.
 *
 * Usage:
 *   node scripts/probes/install-desktop-local.mjs
 *
 * Prerequisites:
 *   - Quit DeepSeek Harness Desktop first (profile lock).
 *   - ~/.dsh/.credentials.yaml version must match the Desktop build
 *     (0.1.6-alpha.1 expects unquoted integer `version: 1`).
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const profile = join(homedir(), '.dsh', 'profiles', 'desktop')
const localDir = join(profile, '.dsh-local-plugins')
const tarballName = `${pkg.name}-${pkg.version}.tgz`
const tarballPath = join(localDir, tarballName)

if (!existsSync(join(profile, 'package.json'))) {
  console.error(`Desktop profile missing: ${profile}`)
  process.exit(1)
}

mkdirSync(localDir, { recursive: true })

const pack = spawnSync('npm', ['pack', '--pack-destination', localDir], {
  cwd: root,
  encoding: 'utf8',
})
if (pack.status !== 0) {
  console.error(pack.stdout || pack.stderr)
  process.exit(pack.status ?? 1)
}
if (!existsSync(tarballPath)) {
  console.error(`expected pack output ${tarballPath}`)
  process.exit(1)
}

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

const manifestPath = join(profile, 'package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const deps = { ...(manifest.dependencies || {}) }

// Preserve other exact-version plugins; point install targets at local tarballs temporarily.
const chatTune = deps['dsh-chat-tune']
const installDeps = { ...deps }
if (chatTune && existsSync(join(localDir, 'dsh-chat-tune-0.4.2.tgz'))) {
  installDeps['dsh-chat-tune'] = 'file:./.dsh-local-plugins/dsh-chat-tune-0.4.2.tgz'
}
installDeps[pkg.name] = `file:./.dsh-local-plugins/${tarballName}`

const baseBundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
const plugins = Object.keys(installDeps).sort()
manifest.dependencies = installDeps
manifest.dsh = {
  ...(manifest.dsh || {}),
  profile: { bundles: [...baseBundles, ...plugins] },
}
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

const install = spawnSync('pnpm', ['install', '--config.strict-dep-builds=false'], {
  cwd: profile,
  encoding: 'utf8',
  env: process.env,
})
process.stdout.write(install.stdout || '')
process.stderr.write(install.stderr || '')
if (install.status !== 0) process.exit(install.status ?? 1)

// Rewrite to exact registry-shaped versions (Desktop projectManifest gate).
const exact = { ...installDeps }
for (const name of Object.keys(exact)) {
  if (name === pkg.name) exact[name] = pkg.version
  else if (name === 'dsh-chat-tune') exact[name] = '0.4.2'
}
manifest.dependencies = exact
manifest.dsh.profile.bundles = [...baseBundles, ...Object.keys(exact).sort()]
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

console.log(
  JSON.stringify(
    {
      event: 'vision.desktop.local-install',
      profile,
      package: `${pkg.name}@${pkg.version}`,
      tarball: tarballPath,
      bundles: manifest.dsh.profile.bundles,
      ok: true,
    },
    null,
    2,
  ),
)
