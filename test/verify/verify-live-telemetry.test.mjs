import assert from 'node:assert/strict'
import test from 'node:test'
import { createVerifyService } from '../../src/application/verify/verify-service.mjs'
import { createVerifyTelemetryAdapter } from '../../src/infrastructure/modbus/verify-telemetry-adapter.mjs'

test('verify-telemetry-adapter: strictly rejects static workspace points[].value as live data', async () => {
  const adapter = createVerifyTelemetryAdapter({
    workspaceLoader: () => ({
      modbus: {
        points: [
          { id: 'p_static', value: 99.9, rawValue: 99.9 }, // static point default, NOT live
        ],
        // modbus.values is empty (no live poll has run)
      },
    }),
  })

  // Attempting to read p_static without live polling or direct read must return null (NO DATA)
  const reading = await adapter.readPoint({ cwd: '/test/cwd' }, 'p_static')
  assert.equal(reading, null)
})

test('verify-telemetry-adapter: reads from active poll-cache and evaluates maxAgeMs freshness', async () => {
  const now = Date.now()
  const adapter = createVerifyTelemetryAdapter({
    workspaceLoader: () => ({
      modbus: {
        values: [
          { pointId: 'p_live_fresh', val: 12.5, at: now - 100 }, // 100ms ago
          { pointId: 'p_live_old', val: 40.0, at: now - 5000 }, // 5000ms ago
        ],
      },
    }),
  })

  // Fresh point with maxAgeMs = 1000 -> quality: good
  const fresh = await adapter.readPoint({ cwd: '/test/cwd' }, 'p_live_fresh', { maxAgeMs: 1000 })
  assert.ok(fresh)
  assert.equal(fresh.value, 12.5)
  assert.equal(fresh.source, 'poll-cache')
  assert.equal(fresh.quality, 'good')

  // Old point with maxAgeMs = 1000 -> quality: stale
  const stale = await adapter.readPoint({ cwd: '/test/cwd' }, 'p_live_old', { maxAgeMs: 1000 })
  assert.ok(stale)
  assert.equal(stale.value, 40.0)
  assert.equal(stale.quality, 'stale')
  assert.ok(stale.freshnessMs >= 5000)
})

test('verify-service: fails assertion when telemetry is stale beyond maxAgeMs', async () => {
  const now = Date.now()
  const adapter = createVerifyTelemetryAdapter({
    workspaceLoader: () => ({
      modbus: {
        values: [
          { pointId: 'temp_c', val: 25.0, at: now - 10000 }, // 10s old
        ],
      },
    }),
  })

  const verifyService = createVerifyService({
    telemetryReader: adapter,
  })

  const result = await verifyService.runVerification({
    scenario: {
      name: 'Stale Check Scenario',
      assertions: [
        {
          type: /** @type {const} */ ('modbus.point'),
          pointId: 'temp_c',
          maxAgeMs: 2000, // require data fresher than 2s
          operator: '==',
          expected: 25.0,
        },
      ],
    },
    workspaceCwd: '/test/cwd',
    ownerSessionId: 'sess-1',
  })

  assert.equal(result.status, 'fail')
  assert.equal(result.failedCount, 1)
  assert.ok(result.assertions[0].message.includes('STALE'))
})
