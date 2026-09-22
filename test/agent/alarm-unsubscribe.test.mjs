import assert from 'node:assert/strict'
import test from 'node:test'
import { visionBenchTool } from '../../bench-tool.mjs'
import {
  registerVisionHost,
  unregisterVisionHost,
} from '../../src/infrastructure/host/vision-host-client.mjs'
import { createVisionCommandDispatcher } from '../../src/interfaces/http/vision-command-routes.mjs'
import { validateAgentToolArgs } from '../../src/interfaces/agent/agent-tool-preflight.mjs'

test('alarm watch:false unsubscribe needs no connectionId; FIELD_CONFLICT on opposite flags', () => {
  const miss = validateAgentToolArgs({ action: 'alarm', watch: false }, {})
  assert.equal(miss, null, 'unsubscribe must not require connectionId')

  const conflict = validateAgentToolArgs({ action: 'alarm', watch: true, followup: false }, {})
  assert.equal(conflict?.errorCode, 'FIELD_CONFLICT')

  const conflict2 = validateAgentToolArgs({ action: 'alarm', watch: false, followup: true }, {})
  assert.equal(conflict2?.errorCode, 'FIELD_CONFLICT')

  const bothFalse = validateAgentToolArgs({ action: 'alarm', watch: false, followup: false }, {})
  assert.equal(bothFalse, null)

  const subscribeStillNeedsTarget = validateAgentToolArgs({ action: 'alarm', watch: true }, {})
  assert.equal(subscribeStillNeedsTarget?.errorCode, 'TARGET_REQUIRED')
})

test('production visionBenchTool alarm watch:false clears only this session without connectionId', async (t) => {
  const { createBench } = await import('../helpers/workspace-factory.mjs')
  const { setAgentAlarmWatch, getAgentAlarmWatch, disposeAlarmNotifyRuntime } = await import(
    '../../src/application/modbus/poll-alarm-notify.mjs'
  )
  const bench = await createBench(t, { prefix: 'dvb-unsub-' })
  const { home, cwd } = bench
  disposeAlarmNotifyRuntime()
  unregisterVisionHost()
  const stop = registerVisionHost(createVisionCommandDispatcher(home))
  try {
    setAgentAlarmWatch(cwd, { followup: true, sessionId: 'sess-a', pointIds: [] })
    setAgentAlarmWatch(cwd, { followup: true, sessionId: 'sess-b', pointIds: [] })
    const tool = visionBenchTool(home)
    const exec = {
      agent: { session: { header: { cwd, id: 'sess-a' } } },
    }
    const off = await tool.execute({ action: 'alarm', watch: false }, exec)
    assert.equal(off.ok, true, JSON.stringify(off))
    assert.equal(off.subscription?.cleared, true)
    assert.equal(off.subscription?.sessionId, 'sess-a')
    assert.equal(getAgentAlarmWatch(cwd, 'sess-a'), null)
    assert.ok(getAgentAlarmWatch(cwd, 'sess-b'), 'other session watch must survive')

    const again = await tool.execute({ action: 'alarm', watch: false }, exec)
    assert.equal(again.ok, true, 'unsubscribe is idempotent')

    const bad = await tool.execute({ action: 'alarm', watch: true, followup: false }, exec)
    assert.equal(bad.ok, false)
    assert.equal(bad.errorCode, 'FIELD_CONFLICT')
  } finally {
    stop()
    unregisterVisionHost()
    disposeAlarmNotifyRuntime()
  }
})

