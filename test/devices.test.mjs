import assert from 'node:assert/strict'
import { mkdir, rm } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { handlePdu, startDeviceSlave, stopDeviceSlave, _internal } from '../bench-slave.mjs'
import { addDevice, recipePair, normalizeModbus, patchActiveDevice } from '../bench-devices.mjs'
import { loadWorkspace, saveWorkspace } from '../bench-store.mjs'
import { modbusPoll } from '../bench-actions.mjs'

test('legacy workspace becomes one master device', () => {
  const pack = normalizeModbus({
    mode: 'tcp',
    host: '10.0.0.8',
    sim: true,
    segments: [{ function: 3, address: 0, count: 4 }],
  })
  assert.equal(pack.devices.length, 1)
  assert.equal(pack.devices[0].role, 'master')
  assert.equal(pack.devices[0].host, '10.0.0.8')
  assert.equal(pack.sim, true)
  assert.equal(pack.segments.length, 1)
})

test('recipePair makes master plus listening slave', () => {
  const pack = recipePair()
  assert.equal(pack.devices.length, 2)
  assert.equal(pack.devices[0].role, 'master')
  assert.equal(pack.devices[1].role, 'slave')
  assert.equal(pack.devices[1].listen, true)
  assert.equal(pack.devices[1].tcpPort, 1502)
})

test('patchActiveDevice keeps the other device intact', () => {
  const added = addDevice(recipePair(), { name: '第三台', role: 'master' })
  const next = patchActiveDevice(added.modbus, { sim: true })
  assert.equal(next.devices.length, 3)
  const active = next.devices.find((item) => item.id === next.activeId)
  assert.equal(active.sim, true)
  assert.equal(next.devices[1].role, 'slave')
})

test('slave handlePdu returns holding registers from sim map', () => {
  const device = recipePair().devices[1]
  const pdu = Buffer.from([3, 0, 0, 0, 2])
  const resp = handlePdu(device, pdu, 1_000_000)
  assert.equal(resp[0], 3)
  assert.equal(resp[1], 4)
  assert.ok(resp.length >= 6)
})

test('startDeviceSlave reuses the same TCP listen', async () => {
  const cwd = join(tmpdir(), 'dvb-slave-' + process.pid)
  const device = { id: 'd-listen', host: '127.0.0.1', tcpPort: 0, role: 'slave' }
  try {
    const first = await startDeviceSlave(cwd, device, () => device)
    assert.equal(first.ok, true)
    const second = await startDeviceSlave(cwd, device, () => device)
    assert.equal(second.reused, true)
    assert.equal(_internal.servers.size, 1)
  } finally {
    stopDeviceSlave(cwd, device.id)
  }
})

test('saveWorkspace migrates segments onto devices', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-dev-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    saveWorkspace(home, cwd, {
      modbus: { sim: true, segments: [{ name: '模拟', function: 3, address: 0, count: 4 }] },
    })
    const ws = loadWorkspace(home, cwd)
    assert.equal(ws.modbus.devices.length, 1)
    assert.equal(ws.modbus.devices[0].segments[0].count, 4)
    const polled = await modbusPoll(home, cwd)
    assert.equal(polled.ok, true)
    assert.ok(polled.devices[0].values.length >= 4)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
