#!/usr/bin/env node
/**
 * Stage-5 acceptance slice: aggregate prior automated gates + Desktop evidence.
 *
 * Desktop B2 / Vision Fetch / Fetch carrier must either:
 *   1) be executed in this process (`VISION_STAGE5_RUN_DESKTOP=1`), or
 *   2) be present as fresh schemaVersion=2 evidence under scripts/probes/evidence/
 *      with required source fields + saved tarball artifact hash match.
 *
 * Report fields:
 *   - labOk: gates + evidence conclusions (dirty allowed when VISION_STAGE5_ALLOW_DIRTY=1)
 *   - releaseOk: labOk AND both Vision/Desktop trees clean (evidence + live)
 * Exit code always follows releaseOk (formal merge gate).
 *
 * Usage: node scripts/probes/check-stage5-acceptance.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  b2TarballArtifactRel,
  packageFingerprint,
  validateStage5Evidence,
} from './lib/stage5-evidence.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const probesDir = join(root, 'scripts', 'probes')
const evidenceDir = join(probesDir, 'evidence')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const harnessRoot = resolve(root, '../../../deepseek-harness-desktop-official')
const harnessDesktop = join(harnessRoot, 'apps', 'desktop')
const allowDirty = process.env.VISION_STAGE5_ALLOW_DIRTY === '1'
const b2ProbePath = join(probesDir, 'run-desktop-b2-identity.mts')
const carrierProbePath = join(probesDir, 'run-desktop-dispatch-smoke.mts')

function read(rel) {
  return readFileSync(join(root, rel), 'utf8')
}

function runNode(script) {
  const r = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' })
  return { script, status: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' }
}

function gitHead(cwd) {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : ''
}

function gitDirty(cwd) {
  const r = spawnSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' })
  return r.status === 0 && r.stdout.trim().length > 0
}

function desktopRelease() {
  try {
    const desktopPkg = JSON.parse(readFileSync(join(harnessDesktop, 'package.json'), 'utf8'))
    return String(desktopPkg.version || '')
  } catch {
    return ''
  }
}

function runDesktopProbe(relScript) {
  if (!existsSync(join(harnessDesktop, 'package.json'))) {
    return {
      status: 'unavailable',
      ok: false,
      detail: `Desktop harness missing at ${harnessDesktop}`,
    }
  }
  const script = join(probesDir, relScript)
  const r = spawnSync('pnpm', ['exec', 'tsx', script], {
    cwd: harnessDesktop,
    encoding: 'utf8',
    env: process.env,
  })
  return {
    status: r.status === 0 ? 'ran' : 'failed',
    ok: r.status === 0,
    exitStatus: r.status ?? 1,
    stdoutTail: (r.stdout || '').slice(-4000),
    stderrTail: (r.stderr || '').slice(-2000),
  }
}

/**
 * @param {string} file
 * @param {'b2' | 'carrier'} kind
 */
function loadEvidence(file, kind) {
  const path = join(evidenceDir, file)
  if (!existsSync(path)) {
    return { status: 'unverified', ok: false, detail: `missing ${file}`, treesClean: false }
  }
  let data
  try {
    data = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    return {
      status: 'unverified',
      ok: false,
      detail: `invalid JSON in ${file}: ${error instanceof Error ? error.message : String(error)}`,
      treesClean: false,
    }
  }

  const artifactRel =
    kind === 'b2' ? b2TarballArtifactRel(pkg.name, pkg.version) : ''
  const validated = validateStage5Evidence(data, {
    kind,
    visionCommit: gitHead(root),
    desktopCommit: gitHead(harnessRoot),
    visionDirtyNow: gitDirty(root),
    desktopDirtyNow: gitDirty(harnessRoot),
    packageName: pkg.name,
    packageVersion: pkg.version,
    packageFingerprint: packageFingerprint(root),
    dshVersion: desktopRelease(),
    probeScriptPath: kind === 'b2' ? b2ProbePath : carrierProbePath,
    tarballArtifactPath: kind === 'b2' ? join(evidenceDir, artifactRel) : undefined,
    allowDirty,
  })

  if (!validated.ok) {
    return {
      status: 'stale',
      ok: false,
      detail: validated.reasons.join('; '),
      treesClean: validated.treesClean,
      evidence: data,
    }
  }
  return {
    status: 'pass',
    ok: true,
    treesClean: validated.treesClean,
    at: data.at || null,
    gitCommit: data.gitCommit,
    desktopGitCommit: data.desktopGitCommit || null,
    package: data.package,
    dshVersion: data.dshVersion || null,
    claim: data.claim,
    tarballSha256: data.tarballSha256 || null,
  }
}

const staticChecks = []

function check(name, ok, detail = '') {
  staticChecks.push({ name, ok: !!ok, detail })
}

const hostSrc = read('host.js')
check('host.inject.connectionOnly', /export const inject = \['connection'\]/.test(hostSrc), 'host.js inject')
check('host.noTopLevelWebServer', !/export const inject = \['connection',\s*'webServer'\]/.test(hostSrc))
check(
  'host.transactionalLease',
  hostSrc.includes('rollbackUncommitted') &&
    hostSrc.includes('Phase 2 — commit shared ownership') &&
    hostSrc.includes('createdSharedRuntime'),
  'lease commit after fallible mounts; first-load runtime rollback',
)

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
  /SUPPORTED_DSH_CONTRACT = '0\.1\.7-alpha\.2'/.test(dshContract),
  'keep pin until release re-measure',
)

check('client.platform.web', pkg.dsh?.client?.platform === 'web')
check('adr012.fetchCarrier', read('docs/architecture/ADR-012-remote-transport.md').includes('Fetch'))
check('adr014.waitForOwnerSession', read('docs/architecture/ADR-014-debug-events-over-connection-rpc.md').includes('waitForOwnerSession'))
check(
  'acceptanceMatrixDoc',
  read('docs/ACCEPTANCE_NATIVE_WEB_DESKTOP.md').includes('registry `name@version`') &&
    read('docs/ACCEPTANCE_NATIVE_WEB_DESKTOP.md').includes('agentPresets.mount'),
)
const b2Src = read('scripts/probes/run-desktop-b2-identity.mts')
check(
  'desktopB2.probeScript',
  b2Src.includes('agentPresets.mount') &&
    b2Src.includes('composedPreset(handle.agent.ctx)') &&
    b2Src.includes('runtime-identity-lab') &&
    b2Src.includes('vision.tools.start'),
  'Desktop B2 mounts via agentPresets + composedPreset(ctx)',
)
check(
  'desktopB2.resultsRecorded',
  read('scripts/probes/RESULTS.md').includes('runtime-identity-lab') &&
    read('scripts/probes/RESULTS.md').includes('agentPresets.mount'),
)
check(
  'desktopCarrier.cancelFallback',
  read('scripts/probes/run-desktop-dispatch-smoke.mts').includes('FALLBACK_MS = 20_000') ||
    read('scripts/probes/run-desktop-dispatch-smoke.mts').includes('FALLBACK_MS = 20000'),
  'carrier cancel fallback longer than fail budget',
)

const staticOk = staticChecks.every((c) => c.ok)

const stage3 = runNode('scripts/probes/check-stage3-pack.mjs')
const stage4 = runNode('scripts/probes/run-stage4-lifecycle.mjs')
const unitB2 = runNode('scripts/probes/run-b2-identity.mjs')
const quality = spawnSync('npm', ['run', 'quality'], { cwd: root, encoding: 'utf8' })

const runDesktop = process.env.VISION_STAGE5_RUN_DESKTOP === '1'
/** @type {Record<string, unknown>} */
let desktopB2 = loadEvidence('desktop-b2-identity.json', 'b2')
/** @type {Record<string, unknown>} */
let desktopFetchCarrier = loadEvidence('desktop-dispatch-smoke.json', 'carrier')

if (runDesktop) {
  const b2Run = runDesktopProbe('run-desktop-b2-identity.mts')
  const fetchRun = runDesktopProbe('run-desktop-dispatch-smoke.mts')
  desktopB2 = b2Run.ok
    ? loadEvidence('desktop-b2-identity.json', 'b2')
    : { ...b2Run, status: b2Run.status === 'unavailable' ? 'unverified' : 'failed', treesClean: false }
  desktopFetchCarrier = fetchRun.ok
    ? loadEvidence('desktop-dispatch-smoke.json', 'carrier')
    : { ...fetchRun, status: fetchRun.status === 'unavailable' ? 'unverified' : 'failed', treesClean: false }
  desktopB2.run = b2Run
  desktopFetchCarrier.run = fetchRun
}

const visionDirty = gitDirty(root)
const desktopDirty = gitDirty(harnessRoot)
const desktopOk = desktopB2.ok === true && desktopFetchCarrier.ok === true
const coreOk =
  staticOk &&
  quality.status === 0 &&
  stage3.status === 0 &&
  stage4.status === 0 &&
  unitB2.status === 0 &&
  desktopOk

const treesClean =
  visionDirty === false &&
  desktopDirty === false &&
  desktopB2.treesClean === true &&
  desktopFetchCarrier.treesClean === true

const labOk = coreOk
const releaseOk = labOk && treesClean

const report = {
  event: 'vision.stage5.acceptance',
  package: `${pkg.name}@${pkg.version}`,
  gitCommit: gitHead(root),
  visionDirty,
  desktopGitCommit: gitHead(harnessRoot),
  desktopDirty,
  packageFingerprint: packageFingerprint(root),
  allowDirty,
  staticChecks,
  staticOk,
  priorGates: {
    quality: { ok: quality.status === 0, status: quality.status },
    stage3: { ok: stage3.status === 0, status: stage3.status },
    stage4: { ok: stage4.status === 0, status: stage4.status },
    unitB2: { ok: unitB2.status === 0, status: unitB2.status },
    desktopB2,
    desktopFetchCarrier,
  },
  capabilityClaim: {
    uiFetchTcpSim: 'manual',
    noVisionListenPort: true,
    desktopRtuNative: false,
    registryProductInstall: 'manual',
    windowsHardware: 'docs/WINDOWS_ACCEPTANCE_0.27.md',
    soak10to15min: 'deferred',
    desktopB2Identity:
      desktopB2.ok === true ? 'runtime-identity-lab' : desktopB2.status || 'unverified',
    desktopVisionFetch: desktopB2.ok === true ? 'pass' : desktopB2.status || 'unverified',
    desktopFetchCarrier:
      desktopFetchCarrier.ok === true ? 'pass' : desktopFetchCarrier.status || 'unverified',
  },
  labOk,
  releaseOk,
  /** @deprecated use releaseOk for merge gates; labOk for dirty local experiments */
  ok: releaseOk,
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
process.exit(releaseOk ? 0 : 1)
