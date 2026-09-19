#!/usr/bin/env node
/**
 * Stage-3 packaging gate: closed import graph + Desktop allowBuilds / install notes.
 * Usage: node scripts/probes/check-stage3-pack.mjs
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

const pack = spawnSync('npm', ['run', 'pack:check'], { cwd: root, encoding: 'utf8' })
if (pack.status !== 0) {
  console.error(pack.stdout || pack.stderr)
  process.exit(pack.status ?? 1)
}

/** Official Desktop allowBuilds (0.1.6-alpha.1 project-manager workspaceFile). */
const DESKTOP_ALLOW_BUILDS = Object.freeze({
  'node-pty': true,
  koffi: true,
  'fs-ext': true,
  '@google/genai': false,
  protobufjs: false,
  'node-addon-require-builtin': false,
})

const nativeDeps = ['serialport', '@serialport/bindings-cpp']
const nativeGate = nativeDeps.map((name) => ({
  name,
  inDesktopAllowBuilds: Object.prototype.hasOwnProperty.call(DESKTOP_ALLOW_BUILDS, name),
  allowed: DESKTOP_ALLOW_BUILDS[name] === true,
}))

const report = {
  event: 'vision.stage3.pack',
  package: `${pkg.name}@${pkg.version}`,
  packCheck: 'ok',
  filesCount: Array.isArray(pkg.files) ? pkg.files.length : 0,
  exports: pkg.exports,
  clientPlatform: pkg.dsh?.client?.platform ?? null,
  peerDependencies: pkg.peerDependencies ?? {},
  nativeGate,
  productInstall: {
    accepted: 'name@version registry (exact)',
    rejected: ['file:', 'tgz path', 'link:', 'URL'],
    example: `${pkg.name}@${pkg.version}`,
  },
  capabilityClaim: {
    desktopUiFetch: true,
    modbusTcpOrSim: true,
    modbusRtuNative:
      'blocked until serialport/@serialport/bindings-cpp enter official Desktop allowBuilds (or optional RTU package)',
  },
  ok: pack.status === 0,
}

console.log(JSON.stringify(report, null, 2))
if (!report.ok) process.exit(1)
