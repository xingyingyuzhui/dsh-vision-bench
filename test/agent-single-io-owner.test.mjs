import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { getVisionIoBroker } from '../bench-io-broker.mjs'
import { saveWorkspace } from '../bench-store.mjs'
import { visionBenchTool } from '../bench-tool.mjs'
import { registerVisionHost, unregisterVisionHost } from '../src/infrastructure/host/vision-host-client.mjs'
import { createVisionCommandDispatcher } from '../src/interfaces/http/vision-command-routes.mjs'

test('agent tools reuse the host-registered I/O broker singleton', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-io-'))
  const cwd = join(home, 'board')
  mkdirSync(cwd)
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [{ id: 'c1', name: 'C1', conn: { mode: 'tcp', host: '127.0.0.1', sim: true } }],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
    },
  })
  const stop = registerVisionHost(createVisionCommandDispatcher(home))
  try {
    const hostBroker = getVisionIoBroker()
    const tool = visionBenchTool(home)
    const ran = await tool.execute({ action: 'status' }, { agent: { session: { header: { cwd, id: 's1' } } } })
    assert.equal(ran.ok, true)
    assert.equal(getVisionIoBroker(), hostBroker)
    assert.equal(hostBroker.pid(), 0, 'sim status does not spawn a second worker')
  } finally {
    stop()
    unregisterVisionHost()
    await rm(home, { recursive: true, force: true })
  }
})
