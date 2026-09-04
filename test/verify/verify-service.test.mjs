import assert from 'node:assert/strict'
import test from 'node:test'
import { createVerifyService } from '../../src/application/verify/verify-service.mjs'
import { evaluateAssertion, evaluateOperator } from '../../src/domain/verify/assertion.mjs'
import { createVerifyResult } from '../../src/domain/verify/result.mjs'
import { createScenario, validateScenario } from '../../src/domain/verify/scenario.mjs'

test('evaluateOperator: numeric and string comparisons', () => {
  assert.equal(evaluateOperator(42, '==', 42), true)
  assert.equal(evaluateOperator('42', '==', 42), true)
  assert.equal(evaluateOperator(42, '!=', 43), true)
  assert.equal(evaluateOperator(50, '>', 40), true)
  assert.equal(evaluateOperator(50, '>=', 50), true)
  assert.equal(evaluateOperator(30, '<', 40), true)
  assert.equal(evaluateOperator(30, '<=', 30), true)
  assert.equal(evaluateOperator(40, '>', 50), false)
  assert.equal(evaluateOperator('READY', 'in', ['IDLE', 'READY', 'RUNNING']), true)
  assert.equal(evaluateOperator('STOP', 'in', ['IDLE', 'READY']), false)
  assert.equal(evaluateOperator('err_overflow_2', 'matches', '^err_'), true)
  assert.equal(evaluateOperator('ok_done', 'matches', '^err_'), false)
})

test('evaluateAssertion: covers all 7 assertion types', () => {
  // 1. debug.expression
  const exprPass = evaluateAssertion({ type: 'debug.expression', expr: 'val', op: '>=', value: 80 }, 85)
  assert.equal(exprPass.pass, true)
  const exprFail = evaluateAssertion({ type: 'debug.expression', expr: 'val', op: '>=', value: 80 }, 75)
  assert.equal(exprFail.pass, false)

  // 2. modbus.point
  const ptPass = evaluateAssertion({ type: 'modbus.point', pointId: 'p_temp', op: '==', value: 25 }, 25)
  assert.equal(ptPass.pass, true)
  const ptFail = evaluateAssertion({ type: 'modbus.point', pointId: 'p_temp', op: '==', value: 25 }, 30)
  assert.equal(ptFail.pass, false)

  // 3. no.exception
  const exPass = evaluateAssertion({ type: 'no.exception' }, false)
  assert.equal(exPass.pass, true)
  const exFail = evaluateAssertion({ type: 'no.exception' }, true)
  assert.equal(exFail.pass, false)

  // 4. no.alarm
  const almPass = evaluateAssertion({ type: 'no.alarm', pointId: 'p_pressure' }, 0)
  assert.equal(almPass.pass, true)
  const almFail = evaluateAssertion({ type: 'no.alarm', pointId: 'p_pressure' }, 2)
  assert.equal(almFail.pass, false)

  // 5. range
  const rngPass = evaluateAssertion({ type: 'range', expr: 'freq', min: 45, max: 55 }, 50)
  assert.equal(rngPass.pass, true)
  const rngFail = evaluateAssertion({ type: 'range', expr: 'freq', min: 45, max: 55 }, 60)
  assert.equal(rngFail.pass, false)

  // 6. changed
  const chgPass = evaluateAssertion({ type: 'changed', pointId: 'state', value: 0 }, { initial: 0, current: 1 })
  assert.equal(chgPass.pass, true)
  const chgFail = evaluateAssertion({ type: 'changed', pointId: 'state', value: 0 }, { initial: 0, current: 0 })
  assert.equal(chgFail.pass, false)

  // 7. stable-for-duration
  const stbPass = evaluateAssertion(
    { type: 'stable-for-duration', pointId: 'volt', tolerance: 2 },
    [220, 221, 220, 221],
  )
  assert.equal(stbPass.pass, true)
  const stbFail = evaluateAssertion({ type: 'stable-for-duration', pointId: 'volt', tolerance: 1 }, [220, 225, 218])
  assert.equal(stbFail.pass, false)
})

test('scenario domain: validation and creation', () => {
  assert.throws(() => validateScenario(null), /必须是一个非空对象/)
  assert.throws(() => validateScenario({}), /缺少有效的 id/)
  assert.throws(() => validateScenario({ id: 's1' }), /缺少有效的 name/)
  assert.throws(() => validateScenario({ id: 's1', name: 'S1', assertions: [] }), /至少一项断言/)
  assert.throws(
    () => validateScenario({ id: 's1', name: 'S1', assertions: [{ type: 'invalid' }] }),
    /未知或未支持的类型/,
  )

  const scenario = createScenario({
    id: 'scen_eev',
    name: 'low-load-eev-min',
    assertions: [
      { type: 'debug.expression', expr: 'eev_target', op: '>=', value: 80 },
      { type: 'modbus.point', pointId: 'eev-opening', op: '>=', value: 80 },
      { type: 'no.exception' },
    ],
  })

  assert.equal(scenario.id, 'scen_eev')
  assert.equal(scenario.assertions.length, 3)
  assert.ok(scenario.assertions[0].id)
})

test('result domain: status and summary computation', () => {
  const passResult = createVerifyResult({
    scenario: { id: 's1', name: 'Scenario 1' },
    assertions: [
      { id: 'a1', type: 'no.exception', pass: true, actual: 'none', expected: 'none', message: 'ok', timestamp: 1 },
      { id: 'a2', type: 'range', pass: true, actual: 50, expected: '[40, 60]', message: 'ok', timestamp: 1 },
    ],
    durationMs: 120,
    evidence: [{ kind: 'log', id: 'l1' }],
  })

  assert.equal(passResult.status, 'pass')
  assert.equal(passResult.passedCount, 2)
  assert.equal(passResult.failedCount, 0)
  assert.ok(passResult.summary.includes('PASS'))

  const failResult = createVerifyResult({
    scenario: { id: 's2', name: 'Scenario 2' },
    assertions: [
      { id: 'a1', type: 'no.exception', pass: true, actual: 'none', expected: 'none', message: 'ok', timestamp: 1 },
      { id: 'a2', type: 'debug.expression', pass: false, actual: 10, expected: 50, message: 'fail', timestamp: 1 },
    ],
    durationMs: 95,
  })

  assert.equal(failResult.status, 'fail')
  assert.equal(failResult.passedCount, 1)
  assert.equal(failResult.failedCount, 1)
  assert.ok(failResult.summary.includes('FAIL'))
  assert.ok(failResult.summary.includes('a2'))
})

test('VerifyService: orchestrates verification loop with debug and telemetry', async () => {
  /** @type {any[]} */
  const journalEvents = []

  const mockDebugRuntime = {
    findSession: () => ({ debugSessionId: 'ds_test_123', workspaceCwd: '/workspaces/proj' }),
    command: async (_scope, cmd) => {
      if (cmd.type === 'evaluate') {
        if (cmd.expression === 'eev_target') return { value: '85' }
        if (cmd.expression === 'temp_c') return { value: '24.5' }
        return { value: '0' }
      }
      if (cmd.type === 'snapshot') {
        return { snapshot: { id: 'snap_verify_1', reason: cmd.reason } }
      }
      return {}
    },
    getEvents: () => ({
      events: [{ type: 'debug.session.ready' }, { type: 'debug.paused', payload: { reason: 'step' } }],
    }),
  }

  const mockWorkspaceLoader = () => ({
    modbus: {
      points: [
        { id: 'eev-opening', value: 85 },
        { id: 'sensor-temp', value: 24.5 },
      ],
    },
    alarms: [],
  })

  const mockEvidenceBuilder = () => [
    { kind: 'build', id: 'build_42' },
    { kind: 'log', id: 'log_99' },
  ]

  const verifyService = createVerifyService({
    debugRuntime: mockDebugRuntime,
    workspaceLoader: mockWorkspaceLoader,
    evidenceBuilder: mockEvidenceBuilder,
    onJournalEvent: async (ev) => {
      journalEvents.push(ev)
    },
  })

  // Run full verification scenario
  const result = await verifyService.runVerification({
    scenario: {
      id: 'scen_cooling',
      name: 'low-load-eev-min',
      assertions: [
        { type: 'debug.expression', expr: 'eev_target', op: '>=', value: 80 },
        { type: 'modbus.point', pointId: 'eev-opening', op: '>=', value: 80 },
        { type: 'no.exception' },
        { type: 'no.alarm' },
        { type: 'range', expr: 'temp_c', min: 20, max: 30 },
      ],
    },
    workspaceCwd: '/workspaces/proj',
    ownerSessionId: 'agent_session_1',
  })

  assert.equal(result.status, 'pass')
  assert.equal(result.passedCount, 5)
  assert.equal(result.totalCount, 5)
  assert.equal(result.failedCount, 0)
  assert.ok(result.summary.includes('PASS'))

  // Verify evidence collection includes both workspace evidence and verification debug snapshot
  assert.ok(result.evidence.some((e) => e.kind === 'build'))
  assert.ok(result.evidence.some((e) => e.kind === 'debug_snapshot' && e.id === 'snap_verify_1'))

  // Verify journal timeline notification was dispatched
  assert.equal(journalEvents.length, 1)
  assert.equal(journalEvents[0].action, 'verify-scenario')
  assert.equal(journalEvents[0].ok, true)
  assert.equal(journalEvents[0].scenarioId, 'scen_cooling')
})

test('VerifyService: reports FAIL when assertions fail and does not declare repair success', async () => {
  const mockDebugRuntime = {
    findSession: () => ({ debugSessionId: 'ds_test_123', workspaceCwd: '/workspaces/proj' }),
    command: async (_scope, cmd) => {
      if (cmd.type === 'evaluate') {
        return { value: '40' } // less than expected 80!
      }
      return {}
    },
    getEvents: () => ({ events: [] }),
  }

  const mockWorkspaceLoader = () => ({
    modbus: {
      points: [{ id: 'eev-opening', value: 40 }],
    },
    alarms: [{ id: 'alm_1', active: true }],
  })

  const verifyService = createVerifyService({
    debugRuntime: mockDebugRuntime,
    workspaceLoader: mockWorkspaceLoader,
  })

  const result = await verifyService.runVerification({
    scenario: {
      id: 'scen_failing',
      name: 'failing-test',
      assertions: [{ type: 'debug.expression', expr: 'eev_target', op: '>=', value: 80 }, { type: 'no.alarm' }],
    },
    workspaceCwd: '/workspaces/proj',
    ownerSessionId: 'agent_session_1',
  })

  assert.equal(result.status, 'fail')
  assert.equal(result.passedCount, 0)
  assert.equal(result.failedCount, 2)
  assert.ok(result.summary.includes('FAIL'))
})
