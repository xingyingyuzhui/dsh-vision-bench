#!/usr/bin/env node
/**
 * Stage-5 acceptance slice: aggregate prior automated gates + static contract checks.
 * Manual / Windows / registry product install remain checklist items in
 * docs/ACCEPTANCE_NATIVE_WEB_DESKTOP.md.
 *
 * Usage: node scripts/probes/check-stage5-acceptance.mjs
 */
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

function read(rel) {
  return readFileSync(join(root, rel), 'utf8')
}

function runNode(script) {
  const r = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' })
  return { script, status: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' }
}

const staticChecks = []

function check(name, ok, detail = '') {
  staticChecks.push({ name, ok: !!ok, detail })
}

const hostSrc = read('host.js')
check('host.inject.connectionOnly', /export const inject = \['connection'\]/.test(hostSrc), 'host.js inject')
check('host.noTopLevelWebServer', !/export const inject = \['connection',\s*'webServer'\]/.test(hostSrc))

const hostClient = read('src/infrastructure/host/vision-host-client.mjs')
check(
  'agent.noDefault3080',
  !/['"`]https?:\/\/(?:127\.0\.0\.1|localhost):3080['"`]/.test(hostClient),
  'no hardcoded origin literal (comment may mention 3080)',
)
check('agent.HOST_UNAVAILABLE', hostClient.includes('HOST_UNAVAILABLE'))

const contract = read('src/shared/vision-rpc-contract.mjs')
check(
  'fetch.dispatchPath',
  contract.includes("VISION_FETCH_DISPATCH_PATH = '/api/vision-bench/dispatch'"),
)
check('rpc.channelCompat', contract.includes("VISION_RPC_CHANNEL = '/vision-bench'"))

const dshContract = read('src/infrastructure/harness/dsh-contract.mjs')
check(
  'supportedContractPinned',
  /SUPPORTED_DSH_CONTRACT = '0\.1\.5-rc\.1'/.test(dshContract),
  'keep pin until release re-measure',
)

check('client.platform.web', pkg.dsh?.client?.platform === 'web')
check('adr012.fetchCarrier', read('docs/architecture/ADR-012-remote-transport.md').includes('Fetch'))
check('adr014.waitForOwnerSession', read('docs/architecture/ADR-014-debug-events-over-connection-rpc.md').includes('waitForOwnerSession'))
check(
  'acceptanceMatrixDoc',
  read('docs/ACCEPTANCE_NATIVE_WEB_DESKTOP.md').includes('registry `name@version`'),
)
check(
  'desktopB2.probeScript',
  read('scripts/probes/run-desktop-b2-identity.mts').includes('run-desktop-b2-identity') ||
    read('scripts/probes/run-desktop-b2-identity.mts').includes('vision.probe.desktop.b2'),
  'real Desktop B2 probe present',
)
check(
  'desktopB2.resultsRecorded',
  read('scripts/probes/RESULTS.md').includes('Real Desktop B2') &&
    read('scripts/probes/RESULTS.md').includes('run-desktop-b2-identity.mts'),
)

const staticOk = staticChecks.every((c) => c.ok)

const stage3 = runNode('scripts/probes/check-stage3-pack.mjs')
const stage4 = runNode('scripts/probes/run-stage4-lifecycle.mjs')
const unitB2 = runNode('scripts/probes/run-b2-identity.mjs')
const quality = spawnSync('npm', ['run', 'quality'], { cwd: root, encoding: 'utf8' })

const report = {
  event: 'vision.stage5.acceptance',
  package: `${pkg.name}@${pkg.version}`,
  staticChecks,
  staticOk,
  priorGates: {
    quality: { ok: quality.status === 0, status: quality.status },
    stage3: { ok: stage3.status === 0, status: stage3.status },
    stage4: { ok: stage4.status === 0, status: stage4.status },
    unitB2: { ok: unitB2.status === 0, status: unitB2.status },
    desktopB2:
      'required evidence: pnpm exec tsx scripts/probes/run-desktop-b2-identity.mts from apps/desktop (RESULTS.md)',
    desktopFetch: 'required evidence: run-desktop-dispatch-smoke.mts / B1 (RESULTS.md)',
  },
  capabilityClaim: {
    uiFetchTcpSim: true,
    noVisionListenPort: true,
    desktopRtuNative: false,
    registryProductInstall: 'manual',
    windowsHardware: 'docs/WINDOWS_ACCEPTANCE_0.27.md',
    soak10to15min: 'deferred',
    desktopB2Identity: true,
  },
  ok:
    staticOk &&
    quality.status === 0 &&
    stage3.status === 0 &&
    stage4.status === 0 &&
    unitB2.status === 0,
}

if (quality.stdout) process.stdout.write(quality.stdout)
if (quality.stderr) process.stderr.write(quality.stderr)
if (stage3.stdout) process.stdout.write(stage3.stdout)
if (stage3.stderr) process.stderr.write(stage3.stderr)
if (stage4.stdout) process.stdout.write(stage4.stdout)
if (stage4.stderr) process.stderr.write(stage4.stderr)
if (unitB2.stdout) process.stdout.write(unitB2.stdout)
if (unitB2.stderr) process.stderr.write(unitB2.stderr)
console.log(JSON.stringify(report, null, 2))
process.exit(report.ok ? 0 : 1)
