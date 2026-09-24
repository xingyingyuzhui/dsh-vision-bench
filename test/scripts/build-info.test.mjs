// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { computeBuildId, expandPublishedFiles, generateBuildInfo, verifyBuildInfo } from '../../scripts/gen-build-info.mjs'

test('buildId is content-addressed and stable for identical trees', () => {
  const root = mkdtempSync(join(tmpdir(), 'dvb-buildid-'))
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 't', version: '1.0.0', files: ['a.mjs', 'b.mjs'] }))
    writeFileSync(join(root, 'a.mjs'), 'export const a = 1\n')
    writeFileSync(join(root, 'b.mjs'), 'export const b = 2\n')
    const files = expandPublishedFiles(root, ['a.mjs', 'b.mjs'])
    const id1 = computeBuildId(root, files)
    const id2 = computeBuildId(root, files)
    assert.equal(id1, id2)
    writeFileSync(join(root, 'a.mjs'), 'export const a = 9\n')
    const id3 = computeBuildId(root, files)
    assert.notEqual(id1, id3)
    const info = generateBuildInfo(root)
    assert.equal(info.pluginVersion, '1.0.0')
    assert.ok(info.buildId)
    assert.equal(verifyBuildInfo(root).ok, true)
    writeFileSync(join(root, 'b.mjs'), 'changed\n')
    assert.equal(verifyBuildInfo(root).ok, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
