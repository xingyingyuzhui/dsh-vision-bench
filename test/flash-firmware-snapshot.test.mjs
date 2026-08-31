import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  createFirmwareSnapshot,
  hashFileSha256,
  isTaskSnapshotDir,
  removeFirmwareSnapshot,
} from '../src/infrastructure/files/firmware-snapshot.mjs'

const shaOf = (buf) => createHash('sha256').update(buf).digest('hex')

test('snapshot copies, re-hashes, and rejects a mutated source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dvb-snap-'))
  const cwd = join(root, 'board')
  mkdirSync(cwd)
  try {
    const src = join(cwd, 'app.hex')
    const bytes = Buffer.from(':020000040800F2\n')
    await writeFile(src, bytes)
    const staging = join(root, 'flash-staging')
    const snap = createFirmwareSnapshot({
      sourcePath: src,
      stagingRoot: staging,
      taskId: 't1',
      expectedSha256: shaOf(bytes),
      expectedSize: bytes.length,
    })
    assert.equal(snap.ok, true, snap.error)
    assert.match(snap.path, /flash-staging/)
    assert.equal(hashFileSha256(snap.path), shaOf(bytes))
    await writeFile(src, Buffer.concat([bytes, Buffer.from(':00000001FF\n')]))
    assert.equal(hashFileSha256(snap.path), shaOf(bytes), 'mutating source does not change snapshot')
    const mismatch = createFirmwareSnapshot({
      sourcePath: src,
      stagingRoot: staging,
      taskId: 't2',
      expectedSha256: shaOf(bytes),
      expectedSize: bytes.length,
    })
    assert.equal(mismatch.ok, false)
    assert.equal(mismatch.errorCode, 'FIRMWARE_SNAPSHOT_MISMATCH')
    const cleaned = removeFirmwareSnapshot(snap.dir, staging)
    assert.equal(cleaned.ok, true)
    assert.equal(existsSync(snap.dir), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('cleanup refuses broad directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dvb-snap-deny-'))
  try {
    const staging = join(root, 'flash-staging')
    mkdirSync(staging)
    assert.equal(isTaskSnapshotDir(staging, staging), false)
    const denied = removeFirmwareSnapshot(staging, staging)
    assert.equal(denied.ok, false)
    assert.equal(denied.errorCode, 'FIRMWARE_SNAPSHOT_CLEANUP_FAILED')
    const outside = removeFirmwareSnapshot(root, staging)
    assert.equal(outside.ok, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
