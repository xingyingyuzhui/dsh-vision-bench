import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { mutateConfig } from '../../src/application/config/config-mutation-service.mjs'

test('stale expectedConfigVersion returns CONFIG_DRIFT and does not write', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-race-'))
  const cwd = join(home, 'board')
  mkdirSync(cwd)
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [{ id: 'c1', name: 'C1', conn: { mode: 'tcp', sim: true } }],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
    },
  })
  const v1 = loadWorkspace(home, cwd).modbus.configVersion
  const first = await mutateConfig({
    home,
    cwd,
    expectedConfigVersion: v1,
    operation: 'device.update',
    target: { deviceId: 'd1' },
    value: { name: 'D1b' },
  })
  assert.equal(first.ok, true)
  const stale = await mutateConfig({
    home,
    cwd,
    expectedConfigVersion: v1,
    operation: 'device.update',
    target: { deviceId: 'd1' },
    value: { name: 'D1c' },
  })
  assert.equal(stale.ok, false)
  assert.equal(stale.errorCode, 'CONFIG_DRIFT')
  assert.equal(loadWorkspace(home, cwd).modbus.devices[0].name, 'D1b')
  await rm(home, { recursive: true, force: true })
})
