import assert from 'node:assert/strict'
import test from 'node:test'
import { modbusWrite } from '../../bench-actions.mjs'
import { connection, createBench } from '../helpers/workspace-factory.mjs'
import { device, hrPoint } from '../hmi/multi-conn-fixtures.mjs'

test('a second write is rejected while the first still owns the bus', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-write-lock-' })
  const { home, cwd } = bench
  bench.save({
    modbus: {
      version: 3,
      connections: [connection('c1', 'tcp', '', { host: '127.0.0.1', sim: false })],
      devices: [device('d1', 'c1', 1)],
      points: [hrPoint('p1', 'c1', 'd1', 0)],
      values: [],
    },
  })
  /** @type {() => void} */
  let release = () => {}
  const gate = new Promise((resolve) => {
    release = resolve
  })
  let calls = 0
  const transport = {
    write: async () => {
      calls += 1
      await gate
      return { ok: true, data: [9] }
    },
    read: async () => ({ ok: true, data: [9] }),
  }
  const body = {
    source: 'user',
    function: 3,
    address: 0,
    values: [9],
    connectionId: 'c1',
    deviceId: 'd1',
  }
  /** @type {any[]} */
  const done = []
  const track = (promise) =>
    promise.then((result) => {
      done.push(result)
      return result
    })
  const first = track(modbusWrite(home, cwd, body, { transport }))
  const second = track(modbusWrite(home, cwd, body, { transport }))
  const deadline = Date.now() + 1000
  while (done.length < 1 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  try {
    assert.equal(done.length, 1, 'the overlapping write should be rejected before the bus returns')
    assert.equal(done[0].ok, false)
    assert.equal(done[0].errorCode, 'WRITE_BUSY')
    assert.equal(done[0].error, '已有写入任务进行中')
  } finally {
    release()
  }
  const all = await Promise.all([first, second])
  assert.equal(all.filter((item) => item.ok).length, 1)
  assert.equal(all.filter((item) => item.errorCode === 'WRITE_BUSY').length, 1)
  assert.equal(calls, 1, 'only the lock holder may reach the transport')
})
