// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { listPendingWrites } from '../../bench-actions.mjs'
import { runVisionBench } from '../helpers/run-vision-bench.mjs'
import { projectAgentResult } from '../../src/application/commands/agent-result-projection.mjs'
import { ERROR_CODES } from '../../src/domain/modbus/errors.mjs'
import { createBench, pointSeries } from '../helpers/workspace-factory.mjs'

test('agent write pending approval does not expose the endpoint fingerprint', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-approval-pending-' })
  const { home, cwd } = bench
  bench.save({
    modbus: {
      conn: { sim: true },
      points: pointSeries('保持', 4),
    },
  })
  const first = await runVisionBench(
    home,
    { action: 'write', function: 3, address: 1, values: [9] },
    cwd,
    { source: 'agent', sessionId: 's1' },
  )
  assert.equal(first.ok, false)
  assert.equal(first.needsConfirm, true)
  assert.equal(first.errorCode, ERROR_CODES.APPROVAL_PENDING)
  assert.ok(first.requestId)
  assert.match(String(first.label || ''), /写/)
  assert.match(String(first.nextStep || ''), /不要重复调用 write/)
  assert.equal('request' in first, false)
  const pending = listPendingWrites(cwd, 's1')
  assert.equal(pending.length, 1)
  assert.equal(pending[0].id, first.requestId)
  assert.deepEqual(pending[0].values, [9])
  assert.ok(pending[0].endpoint)

  const projected = projectAgentResult(
    { action: 'write' },
    {
      ok: false,
      needsConfirm: true,
      errorCode: 'APPROVAL_PENDING',
      requestId: 'pw1',
      label: '写 HR1 = 9',
      nextStep: '等待用户在界面批准；结果会以通知返回，不要重复调用 write',
      error: '需要批准',
      request: { endpoint: { port: 'COM3', configVersion: 4 }, values: [9] },
    },
  )
  assert.deepEqual(projected, {
    ok: false,
    needsConfirm: true,
    errorCode: 'APPROVAL_PENDING',
    requestId: 'pw1',
    label: '写 HR1 = 9',
    nextStep: '等待用户在界面批准；结果会以通知返回，不要重复调用 write',
    error: '需要批准',
  })
})
