import assert from 'node:assert/strict'
import { mkdir, rm } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runSelfCheck } from '../bench-check.mjs'
import { saveBindings } from '../bench-store.mjs'

test('runSelfCheck reports structured results without bindings', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-check-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const ran = await runSelfCheck(home, cwd)
    assert.equal(typeof ran.ok, 'boolean')
    assert.ok(Array.isArray(ran.checks))
    const names = ran.checks.map((item) => item.name)
    for (const key of ['bind-python', 'bind-uv4', 'bind-openocd', 'workspace', 'serial-scan']) {
      assert.ok(names.includes(key), 'missing check ' + key)
    }
    const workspace = ran.checks.find((item) => item.name === 'workspace')
    assert.equal(workspace.ok, true)
    const binds = ran.checks.filter((item) => item.name.startsWith('bind-'))
    assert.equal(binds.every((item) => item.ok === false), true)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('runSelfCheck probes a runnable interpreter', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-check-py-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    saveBindings(home, { python: process.execPath, uv4: '', openocd: '' })
    const ran = await runSelfCheck(home, cwd)
    const runs = ran.checks.find((item) => item.name === 'python-runs')
    assert.equal(runs.ok, true)
    const modbus = ran.checks.find((item) => item.name === 'pymodbus')
    assert.equal(typeof modbus.ok, 'boolean')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
