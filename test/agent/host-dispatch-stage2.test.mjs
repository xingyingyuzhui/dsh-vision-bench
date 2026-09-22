import assert from 'node:assert/strict'
import test from 'node:test'
import { HOST_UNAVAILABLE } from '../../src/application/commands/command-contract.mjs'
import {
  describeHostBridge,
  dispatchVisionCommand,
  getVisionHostEpoch,
  hostOriginOf,
  registerVisionHost,
  unregisterVisionHost,
} from '../../src/infrastructure/host/vision-host-client.mjs'
import { visionBenchTool } from '../../bench-tool.mjs'

test('hostOriginOf never guesses 127.0.0.1:3080', () => {
  const prevVision = process.env.VISION_BENCH_HOST_ORIGIN
  const prevWeb = process.env.DSH_WEB_ORIGIN
  delete process.env.VISION_BENCH_HOST_ORIGIN
  delete process.env.DSH_WEB_ORIGIN
  try {
    assert.equal(hostOriginOf(), '')
    assert.doesNotMatch(hostOriginOf(), /3080/)
  } finally {
    if (prevVision == null) delete process.env.VISION_BENCH_HOST_ORIGIN
    else process.env.VISION_BENCH_HOST_ORIGIN = prevVision
    if (prevWeb == null) delete process.env.DSH_WEB_ORIGIN
    else process.env.DSH_WEB_ORIGIN = prevWeb
  }
})

test('dispatch without Host handle does not run local executeHostCommand', async () => {
  unregisterVisionHost()
  const prevVision = process.env.VISION_BENCH_HOST_ORIGIN
  const prevWeb = process.env.DSH_WEB_ORIGIN
  delete process.env.VISION_BENCH_HOST_ORIGIN
  delete process.env.DSH_WEB_ORIGIN
  try {
    const ran = await dispatchVisionCommand({
      action: 'status',
      cwd: '/tmp/proj',
      source: 'agent',
      home: '/tmp/should-not-write',
    })
    assert.equal(ran.ok, false)
    assert.equal(ran.errorCode, HOST_UNAVAILABLE)
    assert.equal(describeHostBridge().transport, 'unavailable')
  } finally {
    if (prevVision == null) delete process.env.VISION_BENCH_HOST_ORIGIN
    else process.env.VISION_BENCH_HOST_ORIGIN = prevVision
    if (prevWeb == null) delete process.env.DSH_WEB_ORIGIN
    else process.env.DSH_WEB_ORIGIN = prevWeb
  }
})

test('requireHost without origin returns HOST_UNAVAILABLE (no localhost guess)', async () => {
  unregisterVisionHost()
  const prevVision = process.env.VISION_BENCH_HOST_ORIGIN
  const prevWeb = process.env.DSH_WEB_ORIGIN
  delete process.env.VISION_BENCH_HOST_ORIGIN
  delete process.env.DSH_WEB_ORIGIN
  try {
    const tool = visionBenchTool('/tmp')
    const ran = await tool.execute(
      { action: 'status' },
      { agent: { session: { header: { cwd: '/tmp/proj', id: 's1' } } } },
    )
    assert.equal(ran.ok, false)
    assert.equal(ran.errorCode, HOST_UNAVAILABLE)
  } finally {
    if (prevVision == null) delete process.env.VISION_BENCH_HOST_ORIGIN
    else process.env.VISION_BENCH_HOST_ORIGIN = prevVision
    if (prevWeb == null) delete process.env.DSH_WEB_ORIGIN
    else process.env.DSH_WEB_ORIGIN = prevWeb
  }
})

test('registerVisionHost epoch invalidates stale disposer', async () => {
  unregisterVisionHost()
  const stopA = registerVisionHost({
    dispatch() {
      return { ok: true, via: 'a' }
    },
  })
  const epochA = getVisionHostEpoch()
  assert.ok(epochA)
  const stopB = registerVisionHost({
    dispatch() {
      return { ok: true, via: 'b' }
    },
  })
  const epochB = getVisionHostEpoch()
  assert.notEqual(epochA, epochB)
  stopA()
  assert.equal(getVisionHostEpoch(), epochB, 'stale disposer must not clear newer registration')
  const ran = await dispatchVisionCommand({ action: 'status', source: 'agent', requireHost: true })
  assert.equal(ran.via, 'b')
  stopB()
  assert.equal(getVisionHostEpoch(), null)
})
