import assert from 'node:assert/strict'
import test from 'node:test'
import { visionBenchTool } from '../bench-tool.mjs'
import { HOST_UNAVAILABLE } from '../src/application/commands/command-contract.mjs'
import { isLosslessJsonValue } from '../src/application/commands/lossless-json.mjs'
import {
  dispatchVisionCommand,
  registerVisionHost,
  unregisterVisionHost,
} from '../src/infrastructure/host/vision-host-client.mjs'

test('agent execute requires host and returns HOST_UNAVAILABLE when missing', async () => {
  unregisterVisionHost()
  const prev = process.env.VISION_BENCH_HOST_ORIGIN
  process.env.VISION_BENCH_HOST_ORIGIN = 'http://127.0.0.1:1'
  try {
    const tool = visionBenchTool('/tmp')
    const ran = await tool.execute(
      { action: 'status' },
      { agent: { session: { header: { cwd: '/tmp/proj', id: 's1' } } } },
    )
    assert.equal(ran.ok, false)
    assert.equal(ran.errorCode, HOST_UNAVAILABLE)
    assert.equal(isLosslessJsonValue(ran), true)
  } finally {
    if (prev == null) delete process.env.VISION_BENCH_HOST_ORIGIN
    else process.env.VISION_BENCH_HOST_ORIGIN = prev
  }
})

test('registered host receives agent commands', async () => {
  const calls = []
  const stop = registerVisionHost({
    dispatch(cmd) {
      calls.push(cmd)
      return { ok: true, action: cmd.action, via: 'host' }
    },
  })
  try {
    const ran = await dispatchVisionCommand({
      action: 'status',
      cwd: '/tmp/proj',
      source: 'agent',
      requireHost: true,
    })
    assert.equal(ran.ok, true)
    assert.equal(ran.via, 'host')
    assert.equal(calls.length, 1)
    assert.equal(isLosslessJsonValue(ran), true)
  } finally {
    stop()
  }
})
