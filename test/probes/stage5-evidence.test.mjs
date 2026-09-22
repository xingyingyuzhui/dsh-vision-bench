import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  b2TarballArtifactRel,
  validateStage5Evidence,
} from '../../scripts/probes/lib/stage5-evidence.mjs'

function baseEvidence(over = {}) {
  return {
    schemaVersion: 2,
    ok: true,
    claim: 'runtime-identity-lab',
    at: '2026-09-19T00:00:00.000Z',
    gitCommit: 'aaa',
    visionDirty: false,
    desktopGitCommit: 'bbb',
    desktopDirty: false,
    package: 'dsh-vision-bench@0.29.0',
    packageFingerprint: 'fp',
    probeScriptSha256: 'probe',
    dshVersion: '0.1.6-alpha.1',
    hostProtocolVersion: 3,
    presetMount: 'agentPresets.mount',
    presetId: 'vision-b2',
    toolsStartEvent: 'vision.tools.start',
    agentApplyRan: true,
    childPass: true,
    registeredToolNames: ['vision_bench'],
    identity: {
      samePid: true,
      sameModuleInstance: true,
      hasHandle: true,
      dispatchPath: 'in-process-handle',
      via: 'agentPresets.mount→tools.execute(vision_bench,system.ping)',
      presetId: 'vision-b2',
    },
    visionFetch: { ok: true, stateOk: true, cancelOk: true },
    tarballSha256: 'x'.repeat(64),
    tarballArtifact: 'artifacts/dsh-vision-bench-0.29.0.tgz',
    ...over,
  }
}

function ctx(over = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'stage5-ev-'))
  const probe = join(dir, 'probe.mts')
  writeFileSync(probe, 'export {}\n')
  const probeHash = createHash('sha256').update(readFileSync(probe)).digest('hex')
  const artifactDir = join(dir, 'artifacts')
  mkdirSync(artifactDir, { recursive: true })
  const artifact = join(artifactDir, 'dsh-vision-bench-0.29.0.tgz')
  writeFileSync(artifact, 'tarball-bytes')
  const tarballHash = createHash('sha256').update('tarball-bytes').digest('hex')
  return {
    dir,
    probe,
    artifact,
    probeHash,
    tarballHash,
    base: {
      kind: /** @type {'b2'} */ ('b2'),
      visionCommit: 'aaa',
      desktopCommit: 'bbb',
      visionDirtyNow: false,
      desktopDirtyNow: false,
      packageName: 'dsh-vision-bench',
      packageVersion: '0.29.0',
      packageFingerprint: 'fp',
      dshVersion: '0.1.6-alpha.1',
      probeScriptPath: probe,
      tarballArtifactPath: artifact,
      allowDirty: false,
      ...over,
    },
  }
}

test('stage5 evidence: missing required source fields fails', () => {
  const { base, probeHash, tarballHash } = ctx()
  const data = baseEvidence({
    probeScriptSha256: probeHash,
    tarballSha256: tarballHash,
  })
  delete data.desktopGitCommit
  delete data.dshVersion
  delete data.probeScriptSha256
  const result = validateStage5Evidence(data, base)
  assert.equal(result.ok, false)
  assert.match(result.reasons.join(';'), /desktopGitCommit/)
  assert.match(result.reasons.join(';'), /dshVersion/)
  assert.match(result.reasons.join(';'), /probeScriptSha256/)
})

test('stage5 evidence: wrong schemaVersion fails', () => {
  const { base, probeHash, tarballHash } = ctx()
  const result = validateStage5Evidence(
    baseEvidence({ schemaVersion: 1, probeScriptSha256: probeHash, tarballSha256: tarballHash }),
    base,
  )
  assert.equal(result.ok, false)
  assert.match(result.reasons.join(';'), /schemaVersion must be 2/)
})

test('stage5 evidence: tarball hash must match saved artifact', () => {
  const { base, probeHash, tarballHash } = ctx()
  const result = validateStage5Evidence(
    baseEvidence({
      probeScriptSha256: probeHash,
      tarballSha256: '0'.repeat(64),
    }),
    base,
  )
  assert.equal(result.ok, false)
  assert.match(result.reasons.join(';'), /tarballSha256 mismatch/)
  assert.notEqual(tarballHash, '0'.repeat(64))
})

test('stage5 evidence: missing tarball artifact fails', () => {
  const { base, probeHash, tarballHash } = ctx()
  const result = validateStage5Evidence(
    baseEvidence({ probeScriptSha256: probeHash, tarballSha256: tarballHash }),
    { ...base, tarballArtifactPath: join(base.tarballArtifactPath, 'missing.tgz') },
  )
  assert.equal(result.ok, false)
  assert.match(result.reasons.join(';'), /tarball artifact missing/)
})

test('stage5 evidence: allowDirty strips dirty reasons for labOk', () => {
  const { base, probeHash, tarballHash } = ctx({ allowDirty: true, visionDirtyNow: true })
  const result = validateStage5Evidence(
    baseEvidence({
      probeScriptSha256: probeHash,
      tarballSha256: tarballHash,
      visionDirty: true,
    }),
    { ...base, allowDirty: true, visionDirtyNow: true },
  )
  assert.equal(result.ok, true)
  assert.equal(result.treesClean, false)
})

test('stage5 evidence: happy path pass + treesClean', () => {
  const { base, probeHash, tarballHash } = ctx()
  const result = validateStage5Evidence(
    baseEvidence({ probeScriptSha256: probeHash, tarballSha256: tarballHash }),
    base,
  )
  assert.equal(result.ok, true, result.reasons.join('; '))
  assert.equal(result.treesClean, true)
})

test('b2TarballArtifactRel is stable', () => {
  assert.equal(b2TarballArtifactRel('dsh-vision-bench', '0.29.0'), join('artifacts', 'dsh-vision-bench-0.29.0.tgz'))
})
