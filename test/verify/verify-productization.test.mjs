import assert from 'node:assert/strict'
import test from 'node:test'
import { createTelemetryReader } from '../../src/application/verify/telemetry-reader.mjs'
import { createVerifyCommandService } from '../../src/application/verify/verify-command-service.mjs'
import { createVerifyService } from '../../src/application/verify/verify-service.mjs'
import { createVerifyResult } from '../../src/domain/verify/result.mjs'
import { visionDebugTool } from '../../src/interfaces/agent/vision-debug-tool.mjs'
import { createVerifyRpcHandler } from '../../src/interfaces/rpc/verify-rpc-handler.mjs'

test('telemetry-reader: reads live values and dispatches to subscribers', async () => {
  const reader = createTelemetryReader({
    workspaceCwd: 'C:/ws',
    workspaceLoader: () => ({
      modbus: {
        values: { receiver_level: 42.5 },
      },
    }),
  })

  // Read point from workspace values
  const r1 = await reader.readPoint('receiver_level')
  assert.ok(r1)
  assert.equal(r1.value, 42.5)

  // Subscribe and publish new value
  let notified = null
  const unsub = reader.subscribePoint('receiver_level', (reading) => {
    notified = reading
  })

  reader.publishPointValue('receiver_level', 45.0)
  assert.ok(notified)
  assert.equal(notified.value, 45.0)

  // After publish, readPoint returns the cached live value
  const r2 = await reader.readPoint('receiver_level')
  assert.equal(r2?.value, 45.0)

  unsub()
})

test('verify-service: runs scenario with unconstrained duration and rich evidence', async () => {
  const reader = createTelemetryReader()
  reader.publishPointValue('receiver_level', 25.0)

  const verifyService = createVerifyService({
    telemetryReader: reader,
  })

  const scenario = {
    name: 'test-scenario',
    timeoutMs: 5000,
    assertions: [
      {
        type: /** @type {const} */ ('modbus.point'),
        pointId: 'receiver_level',
        operator: '>=',
        expected: 20,
      },
      {
        type: /** @type {const} */ ('stable-for-duration'),
        pointId: 'receiver_level',
        durationMs: 150,
        sampleIntervalMs: 50,
        min: 20,
      },
    ],
  }

  const result = await verifyService.runVerification({
    scenario,
    workspaceCwd: 'C:/ws',
    ownerSessionId: 'sess-1',
    artifactSha256: 'sha-dummy-1234',
    firmwareHash: 'fw-hash-abcd',
  })

  assert.equal(result.status, 'pass')
  assert.equal(result.passedCount, 2)
  assert.equal(result.failedCount, 0)
  assert.equal(result.artifactSha256, 'sha-dummy-1234')
  assert.equal(result.firmwareHash, 'fw-hash-abcd')
  assert.ok(result.telemetrySamples && result.telemetrySamples.length >= 2)
})

test('verify-service: cancellation sets status to cancelled', async () => {
  const reader = createTelemetryReader()
  const verifyService = createVerifyService({ telemetryReader: reader })

  const abortController = new AbortController()
  const scenario = {
    name: 'cancel-scenario',
    assertions: [
      {
        type: /** @type {const} */ ('stable-for-duration'),
        pointId: 'level',
        durationMs: 5000,
        sampleIntervalMs: 50,
      },
    ],
  }

  setTimeout(() => abortController.abort(), 60)

  const result = await verifyService.runVerification({
    scenario,
    workspaceCwd: 'C:/ws',
    ownerSessionId: 'sess-cancel',
    signal: abortController.signal,
  })

  assert.equal(result.status, 'cancelled')
})

test('verify-command-service and RPC handler: executes and manages verification runs', async () => {
  const reader = createTelemetryReader()
  reader.publishPointValue('pressure', 10.0)

  const verifyService = createVerifyService({ telemetryReader: reader })
  const cmdService = createVerifyCommandService({ verifyService })
  const rpcHandler = createVerifyRpcHandler({ verifyCommandService: cmdService })

  const scenario = {
    name: 'rpc-test-scenario',
    assertions: [
      {
        type: /** @type {const} */ ('modbus.point'),
        pointId: 'pressure',
        op: '==',
        value: 10.0,
      },
    ],
  }

  const runRes = await rpcHandler['vision.verify.run']({
    cwd: 'C:/ws',
    sessionId: 'sess-rpc',
    scenario,
  })

  assert.ok(runRes.ok)
  assert.equal(runRes.result.status, 'pass')

  const statusRes = await rpcHandler['vision.verify.status']({
    sessionId: 'sess-rpc',
    scenarioId: runRes.result.scenarioId,
  })

  assert.ok(statusRes.ok)
  assert.equal(statusRes.running, false)
  assert.equal(statusRes.result?.status, 'pass')
})

test('vision-debug-tool: includes verify action and parameters in tool definition', () => {
  const tool = visionDebugTool('C:/home')
  assert.ok(tool.parameters.properties.action.enum.includes('verify'))
  assert.ok('scenario' in tool.parameters.properties)
  assert.ok('timeoutMs' in tool.parameters.properties)
})
