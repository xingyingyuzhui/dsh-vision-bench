import assert from 'node:assert/strict'
import { readFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { BROKER_GRACE_MS, createVisionIoBroker } from '../../bench-io-broker.mjs'
const workerPath = fileURLToPath(new URL('../fixtures/timeout-io-worker.mjs', import.meta.url))

const readPayload = (timeoutMs) => ({
  op: 'modbus.read',
  cwd: '/tmp/a',
  connectionId: 'c1',
  deviceId: 'd1',
  unitId: 1,
  functionCode: 3,
  address: 0,
  count: 1,
  timeoutMs,
  endpoint: { mode: 'tcp', host: '127.0.0.1', tcpPort: 1502 },
})

/**
 * @param {string} mode
 * @param {string} log
 */
function brokerFor(mode, log) {
  return createVisionIoBroker({
    workerPath,
    env: { ...process.env, VISION_IO_TIMEOUT_MODE: mode, VISION_IO_OPLOG: log },
  })
}

test('driver MODBUS_TIMEOUT does not make the broker cancel the shared port', async () => {
  const log = join(tmpdir(), 'dvb-io-grace-reply-' + Date.now() + '.log')
  const broker = brokerFor('reply', log)
  try {
    const health = await broker.health()
    assert.equal(health.ok, true, health.error && health.error.message)
    const timeoutMs = 80
    await assert.rejects(
      () => broker.request(readPayload(timeoutMs), { timeoutMs }),
      (error) => {
        assert.equal(error.code, 'MODBUS_TIMEOUT')
        return true
      },
    )
    const watchUntil = Date.now() + 400
    let sawCancel = false
    while (Date.now() < watchUntil) {
      try {
        if (/"op":"cancel"/.test(readFileSync(log, 'utf8'))) {
          sawCancel = true
          break
        }
      } catch {
        /* worker has not logged yet */
      }
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    assert.equal(sawCancel, false, 'a driver timeout inside the grace window must not close the port')
  } finally {
    await broker.stop()
    try {
      unlinkSync(log)
    } catch {
      /* ignore */
    }
  }
})

test('a stuck worker is cancelled only after the broker grace window', async () => {
  const log = join(tmpdir(), 'dvb-io-grace-stuck-' + Date.now() + '.log')
  const broker = brokerFor('stuck', log)
  try {
    await broker.health()
    const timeoutMs = 80
    const started = Date.now()
    await assert.rejects(
      () => broker.request(readPayload(timeoutMs), { timeoutMs }),
      (error) => {
        assert.equal(error.code, 'MODBUS_TIMEOUT')
        return true
      },
    )
    const elapsed = Date.now() - started
    assert.ok(
      elapsed >= timeoutMs + BROKER_GRACE_MS - 40,
      `cancel arrived at ${elapsed}ms, before timeout+grace`,
    )
    const watchUntil = Date.now() + 1000
    let text = ''
    while (Date.now() < watchUntil) {
      try {
        text = readFileSync(log, 'utf8')
        if (/"op":"cancel"/.test(text)) break
      } catch {
        /* worker has not logged the cancel yet */
      }
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
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
