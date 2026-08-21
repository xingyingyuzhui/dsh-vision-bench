import assert from 'node:assert/strict'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { listWorkspaceDir, pickArtifact } from '../bench-fs.mjs'

test('listWorkspaceDir stays inside the workspace and lists Keil files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dvb-fs-'))
  try {
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src', 'app.uvprojx'), '<Project/>')
    await writeFile(join(root, 'src', 'notes.txt'), 'no')
    const listed = listWorkspaceDir(root, join(root, 'src'))
    assert.equal(listed.ok, true)
    assert.equal(listed.files.length, 1)
    assert.equal(listed.files[0].name, 'app.uvprojx')
    const escaped = listWorkspaceDir(root, join(root, '..'))
    assert.equal(escaped.ok, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('pickArtifact prefers the requested download format', () => {
  const details = { hex_file: '/a.hex', axf_file: '/a.axf' }
  const hex = pickArtifact(details, 'hex')
  assert.equal(hex.path, '/a.hex')
  const bin = pickArtifact(details, 'bin')
  assert.equal(bin.path, null)
  assert.deepEqual(bin.available, ['hex', 'axf'])
})
