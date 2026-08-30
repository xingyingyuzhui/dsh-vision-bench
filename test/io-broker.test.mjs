import assert from 'node:assert/strict'
import { readFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createVisionIoBroker } from '../bench-io-broker.mjs'

const fakeWorker = fileURLToPath(new URL('./fixtures/fake-io-worker.mjs', import.meta.url))

test('broker correlates concurrent requests by id', async () => {
  const broker = createVisionIoBroker({ workerPath: fakeWorker })
  try {
    const health = await broker.health()
    assert.equal(health.ok, true)
    const [a, b] = await Promise.all([
      broker.request({
        op: 'modbus.read',
        cwd: '/tmp/a',
        connectionId: 'c1',
        deviceId: 'd1',
        unitId: 1,
        functionCode: 3,
        address: 0,
        count: 1,
        endpoint: { mode: 'tcp', host: '127.0.0.1', tcpPort: 1502 },
      }),
      broker.request({
        op: 'modbus.read',
        cwd: '/tmp/a',
        connectionId: 'c1',
        deviceId: 'd2',
        unitId: 2,
        functionCode: 3,
        address: 0,
        count: 1,
        endpoint: { mode: 'tcp', host: '127.0.0.1', tcpPort: 1502 },
      }),
    ])
    assert.equal(a.ok, true)
    assert.equal(b.ok, true)
    assert.notEqual(a.transactionId, b.transactionId)
    assert.notEqual(a.data[0], b.data[0])
  } finally {
    await broker.stop()
    assert.equal(broker.pendingSize(), 0)
  }
})

test('broker abort cleans pending map', async () => {
  const broker = createVisionIoBroker({ workerPath: fakeWorker })
  try {
    await broker.health()
    const ac = new AbortController()
    ac.abort()
    await assert.rejects(() =>
      broker.request(
        {
          op: 'modbus.read',
          cwd: '/tmp/a',
          connectionId: 'c1',
          deviceId: 'd1',
          unitId: 1,
          functionCode: 3,
          address: 0,
          count: 1,
          endpoint: { mode: 'tcp', host: '127.0.0.1', tcpPort: 1502 },
        },
        { signal: ac.signal },
      ),
    )
    assert.equal(broker.pendingSize(), 0)
  } finally {
    await broker.stop()
  }
})

test('broker timeout sends cancel and ignores late response', async () => {
  const delayWorker = fileURLToPath(new URL('./fixtures/delay-io-worker.mjs', import.meta.url))
  const log = join(tmpdir(), 'dvb-io-cancel-' + Date.now() + '.log')
  const broker = createVisionIoBroker({
    workerPath: delayWorker,
    env: { ...process.env, VISION_IO_DELAY_MS: '400', VISION_IO_OPLOG: log },
  })
  try {
    await broker.health()
    await assert.rejects(() =>
      broker.request(
        {
          op: 'modbus.read',
          cwd: '/tmp/a',
          connectionId: 'c1',
          deviceId: 'd1',
          unitId: 1,
          functionCode: 3,
          address: 0,
          count: 1,
          endpoint: { mode: 'tcp', host: '127.0.0.1', tcpPort: 1502 },
        },
        { timeoutMs: 50 },
      ),
    )
    assert.equal(broker.pendingSize(), 0)
    await new Promise((resolve) => setTimeout(resolve, 120))
    const text = readFileSync(log, 'utf8')
    assert.match(text, /"op":"cancel"/)
  } finally {
    await broker.stop()
    try {
      unlinkSync(log)
    } catch {
      /* ignore */
    }
  }
})

test('queued write that times out is cancelled before exec', async () => {
  const delayWorker = fileURLToPath(new URL('./fixtures/delay-io-worker.mjs', import.meta.url))
  const log = join(tmpdir(), 'dvb-io-write-to-' + Date.now() + '.log')
  const broker = createVisionIoBroker({
    workerPath: delayWorker,
    env: { ...process.env, VISION_IO_DELAY_MS: '200', VISION_IO_OPLOG: log },
  })
  try {
    await broker.health()
    const first = broker.request(
      {
        op: 'modbus.read',
        cwd: '/tmp/a',
        connectionId: 'c1',
        deviceId: 'd1',
        unitId: 1,
        functionCode: 3,
        address: 0,
        count: 1,
        timeoutMs: 2000,
        endpoint: { mode: 'tcp', host: '127.0.0.1', tcpPort: 1502 },
      },
      { timeoutMs: 2000 },
    )
    const second = broker.request(
      {
        op: 'modbus.write',
        cwd: '/tmp/a',
        connectionId: 'c1',
        deviceId: 'd1',
        unitId: 1,
        functionCode: 6,
        address: 0,
        values: [9],
        timeoutMs: 40,
        endpoint: { mode: 'tcp', host: '127.0.0.1', tcpPort: 1502 },
      },
      { timeoutMs: 40 },
    )
    await assert.rejects(() => second)
    await first.catch(() => {})
    const text = readFileSync(log, 'utf8')
    assert.doesNotMatch(text, /"phase":"exec"/)
  } finally {
    await broker.stop()
    try {
      unlinkSync(log)
    } catch {
      /* ignore */
    }
  }
})

test('stop leaves pending map empty', async () => {
  const delayWorker = fileURLToPath(new URL('./fixtures/delay-io-worker.mjs', import.meta.url))
  const broker = createVisionIoBroker({
    workerPath: delayWorker,
    env: { ...process.env, VISION_IO_DELAY_MS: '800' },
  })
  try {
    await broker.health()
    const pending = broker.request(
      {
        op: 'modbus.read',
        cwd: '/tmp/a',
        connectionId: 'c1',
        deviceId: 'd1',
        unitId: 1,
        functionCode: 3,
        address: 0,
        count: 1,
        endpoint: { mode: 'tcp', host: '127.0.0.1', tcpPort: 1502 },
      },
      { timeoutMs: 5000 },
    )
    pending.catch(() => {})
    await broker.stop()
    assert.equal(broker.pendingSize(), 0)
    assert.equal(broker.getState(), 'stopped')
  } finally {
    await broker.stop()
  }
})

test('missing worker path becomes unhealthy instead of throwing uncaught', async () => {
  const broker = createVisionIoBroker({ workerPath: '/no/such/vision-io-worker.mjs' })
  const ran = await broker.health()
  assert.equal(ran.ok, false)
  assert.equal(broker.getState() === 'unhealthy' || broker.getState() === 'stopped', true)
  await broker.stop()
})
