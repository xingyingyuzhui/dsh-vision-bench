import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import test from 'node:test'
import { runUv4Build } from '../../src/infrastructure/keil/uv4-build-runner.mjs'
import { buildEnv, toolchainBins } from '../../src/infrastructure/keil/uv4-env.mjs'

test('toolchainBins discovers ARM toolchains next to UV4 and UV4 dir', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'keil-bins-'))
  try {
    const uv4Dir = join(dir, 'UV4')
    const armccBin = join(dir, 'ARM', 'ARMCC', 'Bin')
    const armclangBin = join(dir, 'ARM', 'ARMCLANG', 'bin')
    await mkdir(uv4Dir, { recursive: true })
    await mkdir(armccBin, { recursive: true })
    await mkdir(armclangBin, { recursive: true })
    const uv4 = join(uv4Dir, 'UV4.exe')
    await writeFile(uv4, '')

    const bins = toolchainBins(uv4)
    assert.ok(bins.includes(resolve(armccBin)))
    assert.ok(bins.includes(resolve(armclangBin)))
    assert.ok(bins.includes(resolve(uv4Dir)))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('toolchainBins handles missing or empty paths safely', () => {
  assert.deepEqual(toolchainBins(''), [])
})

test('buildEnv prepends toolchain dirs without mutating baseEnv', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'keil-env-'))
  try {
    const uv4Dir = join(dir, 'UV4')
    await mkdir(uv4Dir, { recursive: true })
    const uv4 = join(uv4Dir, 'UV4.exe')
    await writeFile(uv4, '')

    const baseEnv = { PATH: '/usr/bin:/bin', CUSTOM_KEY: 'abc' }
    const createdEnv = buildEnv(uv4, baseEnv)

    assert.equal(baseEnv.PATH, '/usr/bin:/bin')
    assert.equal(baseEnv.CUSTOM_KEY, 'abc')
    assert.ok(createdEnv.PATH.startsWith(resolve(uv4Dir) + delimiter))
    assert.ok(createdEnv.PATH.endsWith('/usr/bin:/bin'))
    assert.equal(createdEnv.CUSTOM_KEY, 'abc')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('runUv4Build constructs arguments and delegates to runExec', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'keil-runner-'))
  try {
    const project = join(dir, 'test.uvprojx')
    const uv4 = join(dir, 'UV4.exe')
    const logDir = join(dir, 'logs')
    await writeFile(project, '<Project/>')
    await writeFile(uv4, '')

    /** @type {any[]} */
    const calls = []
    const mockExec = async (bin, args, opts) => {
      calls.push({ bin, args, opts })
      // Write dummy log file as UV4 would
      const logIdx = args.indexOf('-o')
      if (logIdx >= 0 && args[logIdx + 1]) {
        await writeFile(
          args[logIdx + 1],
          'Build target "Target 1"\nProgram Size: Code=10 RO-data=2 RW-data=1 ZI-data=0\n0 Error(s), 0 Warning(s).\n',
        )
      }
      return { exitCode: 0, stdout: '', stderr: '', cancelled: false, timedOut: false }
    }

    const res = await runUv4Build({
      uv4,
      project,
      target: 'Debug',
      logDir,
      taskId: 'task-123',
      runExec: mockExec,
    })

    assert.equal(res.ok, true)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].bin, uv4)
    assert.deepEqual(calls[0].args, [
      '-b',
      resolve(project),
      '-j0',
      '-o',
      resolve(logDir, 'task-123.log'),
      '-t',
      'Debug',
    ])
    assert.equal(calls[0].opts.cwd, resolve(dir))
    assert.ok(calls[0].opts.env.PATH)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('runUv4Build returns structured errors on missing project or uv4', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'keil-runner-err-'))
  try {
    const uv4 = join(dir, 'UV4.exe')
    await writeFile(uv4, '')
    const logDir = join(dir, 'logs')

    const noProj = await runUv4Build({
      uv4,
      project: join(dir, 'missing.uvprojx'),
      logDir,
    })
    assert.equal(noProj.ok, false)
    assert.equal(noProj.result.error.code, 'project_not_found')

    const noUv4 = await runUv4Build({
      uv4: join(dir, 'missing_uv4.exe'),
      project: uv4,
      logDir,
    })
    assert.equal(noUv4.ok, false)
    assert.equal(noUv4.result.error.code, 'uv4_not_found')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('runUv4Build handles process timeout and cancellation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'keil-runner-term-'))
  try {
    const project = join(dir, 'test.uvprojx')
    const uv4 = join(dir, 'UV4.exe')
    const logDir = join(dir, 'logs')
    await writeFile(project, '<Project/>')
    await writeFile(uv4, '')

    const resCancelled = await runUv4Build({
      uv4,
      project,
      logDir,
      runExec: async () => ({ exitCode: 1, stdout: '', stderr: '', cancelled: true, timedOut: false }),
    })
    assert.equal(resCancelled.cancelled, true)
    assert.equal(resCancelled.result.error.code, 'cancelled')

    const resTimeout = await runUv4Build({
      uv4,
      project,
      logDir,
      runExec: async () => ({ exitCode: 1, stdout: '', stderr: '', cancelled: false, timedOut: true }),
    })
    assert.equal(resTimeout.timedOut, true)
    assert.equal(resTimeout.result.error.code, 'timeout')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
