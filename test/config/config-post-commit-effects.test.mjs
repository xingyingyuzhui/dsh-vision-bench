import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadWorkspace, normalizeWorkspace, saveWorkspace, workspaceKey } from '../../bench-store.mjs'
import { createConfigMutationService, mutateConfig } from '../../src/application/config/config-mutation-service.mjs'
import { createWorkspaceRepository } from '../../src/infrastructure/persistence/workspace-repository.mjs'

function seed(home, cwd) {
  mkdirSync(cwd)
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [{ id: 'c1', name: 'C1', conn: { mode: 'tcp', host: '127.0.0.1', sim: true, port: '' } }],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
    },
  })
}

test('CONFIG_DRIFT and write failure do not emit post-commit connection release', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-pc-'))
  const cwd = join(home, 'board')
  seed(home, cwd)
  const cv = loadWorkspace(home, cwd).modbus.configVersion
  const drift = await mutateConfig({
    home,
    cwd,
    expectedConfigVersion: cv + 9,
    operation: 'connection.update',
    target: { connectionId: 'c1' },
    value: { name: 'nope', host: '10.0.0.9' },
  })
  assert.equal(drift.ok, false)
  assert.equal(drift.errorCode, 'CONFIG_DRIFT')
  assert.equal(loadWorkspace(home, cwd).modbus.connections[0].name, 'C1')

  const missing = await mutateConfig({
    home,
    cwd,
    expectedConfigVersion: loadWorkspace(home, cwd).modbus.configVersion,
    operation: 'connection.remove',
    target: { connectionId: 'c-missing' },
    value: {},
  })
  assert.equal(missing.ok, false)
  assert.ok(
    ['CONNECTION_NOT_FOUND', 'TARGET_REQUIRED'].includes(missing.errorCode) ||
      /不存在/.test(String(missing.error || '')),
  )
  assert.equal(loadWorkspace(home, cwd).modbus.connections.length, 1)
  await rm(home, { recursive: true, force: true })
})

test('persist success releases the connection exactly once', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-pc-ok-'))
  const cwd = join(home, 'board')
  seed(home, cwd)
  const released = []
  const notified = []
  const service = createConfigMutationService({
    releaseConnections(room, ids) {
      released.push({ room, ids: [...ids] })
    },
    notifyEvent(h, room, summary) {
      notified.push({ h, room, summary })
    },
    listConnectionStates: async () => ({ connectionStates: [] }),
  })
  const ran = await service.mutateConfig({
    home,
    cwd,
    expectedConfigVersion: loadWorkspace(home, cwd).modbus.configVersion,
    operation: 'connection.update',
    target: { connectionId: 'c1' },
    value: { name: 'C1b', host: '10.0.0.8' },
  })
  assert.equal(ran.ok, true, ran.error)
  assert.equal(released.length, 1)
  assert.deepEqual(released[0].ids, ['c1'])
  assert.equal(notified.length, 1)
  assert.equal(loadWorkspace(home, cwd).modbus.connections[0].name, 'C1b')
  await rm(home, { recursive: true, force: true })
})

test('agent-sourced config mutations do not echo a followup notice', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-pc-agent-'))
  const cwd = join(home, 'board')
  seed(home, cwd)
  const notified = []
  const service = createConfigMutationService({
    releaseConnections() {},
    notifyEvent(_h, _room, summary) {
      notified.push(summary)
    },
    listConnectionStates: async () => ({ connectionStates: [] }),
  })
  const ran = await service.mutateConfig({
    home,
    cwd,
    source: 'agent',
    sessionId: 'sess-live',
    expectedConfigVersion: loadWorkspace(home, cwd).modbus.configVersion,
    operation: 'points.add',
    target: { connectionId: 'c1', deviceId: 'd1' },
    value: { point: { name: 'T', function: 3, address: 0 } },
  })
  assert.equal(ran.ok, true, ran.error)
  assert.equal(notified.length, 0, 'agent origin must not splice a user notice')
  await rm(home, { recursive: true, force: true })
})

test('CONFIG_INVALID does not release connections', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-pc-inv-'))
  const cwd = join(home, 'board')
  mkdirSync(cwd)
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [
        { id: 'c1', name: 'C1', conn: { mode: 'rtu', port: 'COM3', baudrate: 9600, sim: false } },
        { id: 'c2', name: 'C2', conn: { mode: 'rtu', port: 'COM4', baudrate: 9600, sim: false } },
      ],
      devices: [
        { id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 },
        { id: 'd2', connectionId: 'c2', name: 'D2', unitId: 1 },
      ],
    },
  })
  let releases = 0
  let notifies = 0
  const service = createConfigMutationService({
    releaseConnections() {
      releases += 1
    },
    notifyEvent() {
      notifies += 1
    },
    listConnectionStates: async () => ({ connectionStates: [] }),
  })
  const ran = await service.mutateConfig({
    home,
    cwd,
    expectedConfigVersion: loadWorkspace(home, cwd).modbus.configVersion,
    operation: 'connection.update',
    target: { connectionId: 'c2' },
    value: { port: 'COM3' },
  })
  assert.equal(ran.ok, false)
  assert.equal(ran.errorCode, 'CONFIG_INVALID')
  assert.equal(releases, 0)
  assert.equal(notifies, 0)
  assert.equal(loadWorkspace(home, cwd).modbus.connections[1].conn.port, 'COM4')
  await rm(home, { recursive: true, force: true })
})

test('WORKSPACE_WRITE_FAILED is injected into production mutateConfig and skips effects', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-pc-disk-'))
  const cwd = join(home, 'board')
  seed(home, cwd)
  let persistCalls = 0
  let releases = 0
  let notifies = 0
  const service = createConfigMutationService({
    repositoryFactory: (h) =>
      createWorkspaceRepository({
        home: h,
        keyOf: workspaceKey,
        normalizeWorkspace,
        persistWorkspace() {
          persistCalls += 1
          throw new Error('disk full')
        },
      }),
    releaseConnections() {
      releases += 1
    },
    notifyEvent() {
      notifies += 1
    },
    listConnectionStates: async () => ({ connectionStates: [] }),
  })
  const ran = await service.mutateConfig({
    home,
    cwd,
    expectedConfigVersion: loadWorkspace(home, cwd).modbus.configVersion,
    operation: 'connection.update',
    target: { connectionId: 'c1' },
    value: { name: 'WillFail', host: '10.0.0.7' },
  })
  assert.equal(ran.ok, false)
  assert.equal(ran.errorCode, 'WORKSPACE_WRITE_FAILED')
  assert.match(String(ran.error), /disk full/)
  assert.equal(persistCalls, 1)
  assert.equal(releases, 0)
  assert.equal(notifies, 0)
  assert.equal(loadWorkspace(home, cwd).modbus.connections[0].name, 'C1')
  await rm(home, { recursive: true, force: true })
})

test('saved config is not rolled back when connection release fails', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-pc-rel-'))
  const cwd = join(home, 'board')
  seed(home, cwd)
  const service = createConfigMutationService({
    releaseConnections() {
      throw new Error('release boom')
    },
    notifyEvent() {
      return Promise.resolve()
    },
    listConnectionStates: async () => ({ connectionStates: [] }),
  })
  const ran = await service.mutateConfig({
    home,
    cwd,
    expectedConfigVersion: loadWorkspace(home, cwd).modbus.configVersion,
    operation: 'connection.update',
    target: { connectionId: 'c1' },
    value: { name: 'Kept', host: '10.0.0.6' },
  })
  assert.equal(ran.ok, true, ran.error)
  assert.equal(loadWorkspace(home, cwd).modbus.connections[0].name, 'Kept')
  assert.ok(Array.isArray(ran.postCommitWarnings))
  assert.equal(ran.postCommitWarnings[0].code, 'CONNECTION_RELEASE_FAILED')
  assert.deepEqual(ran.postCommitWarnings[0].connectionIds, ['c1'])
  await rm(home, { recursive: true, force: true })
})

test('event notify failure does not mark a saved config as failed', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-pc-n-'))
  const cwd = join(home, 'board')
  seed(home, cwd)
  const service = createConfigMutationService({
    releaseConnections() {},
    notifyEvent() {
      return Promise.reject(new Error('notify boom'))
    },
    listConnectionStates: async () => ({ connectionStates: [] }),
  })
  const ran = await service.mutateConfig({
    home,
    cwd,
    expectedConfigVersion: loadWorkspace(home, cwd).modbus.configVersion,
    operation: 'connection.update',
    target: { connectionId: 'c1' },
    value: { name: 'Named', host: '10.0.0.5' },
  })
  assert.equal(ran.ok, true, ran.error)
  assert.equal(loadWorkspace(home, cwd).modbus.connections[0].name, 'Named')
  assert.equal(ran.postCommitWarnings[0].code, 'EVENT_NOTIFY_FAILED')
  await rm(home, { recursive: true, force: true })
})
