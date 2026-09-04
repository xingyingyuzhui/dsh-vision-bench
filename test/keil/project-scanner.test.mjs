import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  calculateDepth,
  checkFileReadable,
  isBroadRoot,
  isInside,
  looksBinary,
  readSource,
  scanProjects,
} from '../../src/infrastructure/keil/keil-project-scanner.mjs'

test('isBroadRoot identifies root and home directories as broad', () => {
  assert.equal(isBroadRoot(homedir()), true)
  assert.equal(isBroadRoot('/'), true)
  assert.equal(isBroadRoot('/tmp/some-project'), false)
})

test('calculateDepth and isInside handle path boundaries correctly', () => {
  const root = '/workspace/project'
  assert.equal(calculateDepth(root, '/workspace/project/a/b'), 2)
  assert.equal(calculateDepth(root, '/workspace/project'), 0)

  assert.equal(isInside(root, '/workspace/project/src/main.c'), true)
  assert.equal(isInside(root, '/workspace/outside/secret.c'), false)
  assert.equal(isInside(root, '/etc/passwd'), false)
})

test('looksBinary and checkFileReadable distinguish text from binary', async () => {
  assert.equal(looksBinary(Buffer.from('hello world\n')), false)
  assert.equal(looksBinary(Buffer.from([0, 1, 2, 3, 0])), true)

  const tempDir = await mkdtemp(join(tmpdir(), 'dvb-scanner-'))
  try {
    const textFile = join(tempDir, 'plain.txt')
    await writeFile(textFile, 'int main() { return 0; }')
    const [textOk, textReason] = await checkFileReadable(textFile)
    assert.equal(textOk, true)
    assert.equal(textReason, 'ok')

    const binFile = join(tempDir, 'data.bin')
    await writeFile(binFile, Buffer.from([0, 1, 2, 3, 0, 255]))
    const [binOk, binReason] = await checkFileReadable(binFile)
    assert.equal(binOk, false)
    assert.equal(binReason, 'binary')

    const [missingOk, missingReason] = await checkFileReadable(join(tempDir, 'nonexistent.txt'))
    assert.equal(missingOk, false)
    assert.equal(missingReason, 'missing')

    const readText = await readSource(textFile)
    assert.equal(readText, 'int main() { return 0; }')
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('scanProjects finds .uvprojx and skips ignored directories', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'dvb-scan-'))
  try {
    await mkdir(join(tempDir, 'board1'), { recursive: true })
    await mkdir(join(tempDir, 'board2/nested'), { recursive: true })
    await mkdir(join(tempDir, '.git'), { recursive: true })
    await mkdir(join(tempDir, 'node_modules/pkg'), { recursive: true })

    await writeFile(join(tempDir, 'board1/app.uvprojx'), '<Project></Project>')
    await writeFile(join(tempDir, 'board2/nested/core.uvprojx'), '<Project></Project>')
    await writeFile(join(tempDir, '.git/ignored.uvprojx'), '<Project></Project>')
    await writeFile(join(tempDir, 'node_modules/pkg/ignored.uvprojx'), '<Project></Project>')

    const { projects, error } = await scanProjects(tempDir)
    assert.equal(error, null)
    assert.equal(projects.length, 2)
    assert.equal(projects[0].name, 'app')
    assert.equal(projects[1].name, 'core')
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('scanProjects rejects non-existent root or too broad root', async () => {
  const missing = await scanProjects('/path/that/definitely/does/not/exist/12345')
  assert.ok(missing.error)
  assert.equal(missing.error.error.code, 'root_not_found')

  const broad = await scanProjects(homedir())
  assert.ok(broad.error)
  assert.equal(broad.error.error.code, 'scan_scope_too_broad')
})
