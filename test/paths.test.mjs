import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isBroadCwd, pathInside, requireKeilProject, requireWorkspaceCwd } from '../bench-paths.mjs'
import { runExecFile, _internal } from '../bench-run.mjs'

test('pathInside rejects parents and relatives', () => {
  const root = join('/tmp', 'ws')
  assert.equal(pathInside(root, join(root, 'src', 'a.uvprojx')), true)
  assert.equal(pathInside(root, root), true)
  assert.equal(pathInside(root, join(root, '..', 'other')), false)
  assert.equal(pathInside(root, 'a.uvprojx'), false)
})

test('requireWorkspaceCwd rejects home and relatives', () => {
  assert.match(requireWorkspaceCwd('proj').error, /工作区/)
  assert.match(requireWorkspaceCwd('/').error, /盘根|主目录/)
  const room = requireWorkspaceCwd(join('/tmp', 'vision-proj-' + Date.now()))
  assert.equal(room.error, undefined)
  assert.ok(room.cwd)
})

test('isBroadCwd treats user home as too wide', () => {
  assert.equal(isBroadCwd('/Users/qin', '/Users/qin'), true)
})

test('pythonArgv inserts -3 for the Windows launcher', () => {
  assert.deepEqual(_internal.pythonArgv('/usr/bin/python3', ['a.py']), ['a.py'])
  assert.deepEqual(_internal.pythonArgv('C:\\Windows\\py.exe', ['a.py', '--json']), ['-3', 'a.py', '--json'])
})

test('runExecFile honours an already-aborted signal', async () => {
  const ac = new AbortController()
  ac.abort()
  const ran = await runExecFile(process.execPath, ['-e', 'process.exit(0)'], { signal: ac.signal, timeoutMs: 2000 })
  assert.equal(ran.cancelled, true)
})

test('parseJsonStdout reads trailing JSON after noise', () => {
  const hit = _internal.parseJsonStdout('noise\n{"status":"ok","action":"scan"}\n')
  assert.equal(hit.data.status, 'ok')
  assert.equal(_internal.parseJsonStdout('').error, '脚本没有输出')
})

test('requireKeilProject rejects .uvmpw until map supports it', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'dvb-uvmpw-'))
  try {
    const file = join(cwd, 'suite.uvmpw')
    await mkdir(cwd, { recursive: true })
    await writeFile(file, '<Workspace/>')
    const ran = requireKeilProject(cwd, file)
    assert.match(ran.error, /\.uvprojx/)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
