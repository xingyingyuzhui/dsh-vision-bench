#!/usr/bin/env node
/**
 * Install current dsh-vision-bench into ~/.dsh/profiles/desktop via a local tarball.
 * Does NOT publish to npm. Quit DeepSeek Harness Desktop first.
 *
 *   node scripts/probes/install-desktop-local.mjs
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir, tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const profile = join(homedir(), '.dsh', 'profiles', 'desktop')
const localDir = join(profile, '.dsh-local-plugins')
const tarballName = `${pkg.name}-${pkg.version}.tgz`
const tarballPath = join(localDir, tarballName)
const DESKTOP_PROFILE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

if (!existsSync(join(profile, 'package.json'))) {
  console.error(`Desktop profile missing: ${profile}`)
  process.exit(1)
}

const running = spawnSync('pgrep', ['-f', 'DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness'], { encoding: 'utf8' })
if (running.status === 0) {
  console.error('Quit DeepSeek Harness completely (Cmd+Q) before installing into the Desktop profile.')
  process.exit(2)
}

mkdirSync(localDir, { recursive: true })

const packedInRoot = join(root, tarballName)
if (existsSync(packedInRoot)) {
  copyFileSync(packedInRoot, tarballPath)
} else {
  const cache = mkdtempSync(join(tmpdir(), 'npm-cache-'))
  const pack = spawnSync('npm', ['pack', '--cache', cache, '--pack-destination', localDir], {
    cwd: root,
    encoding: 'utf8',
  })
  rmSync(cache, { recursive: true, force: true })
  if (pack.status !== 0) {
    console.error(pack.stdout || pack.stderr)
    process.exit(pack.status ?? 1)
  }
}
if (!existsSync(tarballPath)) {
  console.error(`expected pack output ${tarballPath}`)
  process.exit(1)
}

const workspacePath = join(profile, 'pnpm-workspace.yaml')
if (existsSync(workspacePath)) {
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
}

function localFileSpec(name, spec) {
  const current = String(spec || '')
  if (current.startsWith('file:')) return current
  const tgz = `${name}-${current}.tgz`
  if (existsSync(join(localDir, tgz))) return `file:./.dsh-local-plugins/${tgz}`
  return current
}

function exactVersion(name, spec) {
  if (name === pkg.name) return pkg.version
  const current = String(spec || '')
  const match = current.match(/[/]([^/]+)-(\d+\.\d+\.\d+[^/]*)\.tgz$/)
  if (match) return match[2]
  return current
}

const manifestPath = join(profile, 'package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const previous = { ...(manifest.dependencies || {}) }
const installDeps = {}
for (const [name, spec] of Object.entries(previous)) {
  installDeps[name] = localFileSpec(name, spec)
}
installDeps[pkg.name] = `file:./.dsh-local-plugins/${tarballName}`
const plugins = Object.keys(installDeps).sort()
manifest.dependencies = installDeps
manifest.dsh = {
  ...(manifest.dsh || {}),
  profile: { bundles: [...DESKTOP_PROFILE_BUNDLES, ...plugins] },
}
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

const install = spawnSync('pnpm', ['install', '--config.strict-dep-builds=false', '--no-frozen-lockfile'], {
  cwd: profile,
  encoding: 'utf8',
  env: { ...process.env, CI: '' },
})
process.stdout.write(install.stdout || '')
process.stderr.write(install.stderr || '')
if (install.status !== 0) process.exit(install.status ?? 1)

const exact = {}
for (const [name, spec] of Object.entries(installDeps)) {
  exact[name] = exactVersion(name, spec)
}
manifest.dependencies = exact
manifest.dsh.profile.bundles = [...DESKTOP_PROFILE_BUNDLES, ...Object.keys(exact).sort()]
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

console.log(JSON.stringify({
  event: 'vision.desktop.local-install',
  profile,
  package: `${pkg.name}@${pkg.version}`,
  tarball: tarballPath,
  bundles: manifest.dsh.profile.bundles,
  ok: true,
}, null, 2))
