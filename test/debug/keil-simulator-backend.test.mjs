// @ts-check
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { createDebugRuntime } from '../../src/application/debug/debug-runtime.mjs'
import { createDebugEventRing } from '../../src/domain/debug/debug-event.mjs'
import {
  buildDebugInitScript,
  buildSignalFunctionScript,
  validateScriptIdentifier,
} from '../../src/infrastructure/debug/keil/debug-script-builder.mjs'
import { KeilSimBackend } from '../../src/infrastructure/debug/keil/keil-sim-backend.mjs'
import { KeilUvscClient, UVSC_OPCODES, UVSC_STATUS } from '../../src/infrastructure/debug/keil/uvsc-client.mjs'
import { UVSC_MAGIC, decodeFrames, encodeFrame } from '../../src/infrastructure/debug/keil/uvsc-framing.mjs'

test('debug-script-builder: validates identifiers to prevent script injection', () => {
  assert.doesNotThrow(() => validateScriptIdentifier('sensor_val'))
  assert.doesNotThrow(() => validateScriptIdentifier('Port_1.pin2'))
  assert.doesNotThrow(() => validateScriptIdentifier('ADC1_DR'))

  assert.throws(() => validateScriptIdentifier(''), /非法的脚本标识符/)
  assert.throws(() => validateScriptIdentifier('sensor; exec("rm -rf")'), /非法的脚本标识符/)
  assert.throws(() => validateScriptIdentifier('123abc'), /非法的脚本标识符/)
  assert.throws(() => validateScriptIdentifier('foo(bar)'), /非法的脚本标识符/)
  assert.throws(() => validateScriptIdentifier('a b c'), /非法的脚本标识符/)
})

test('debug-script-builder: generates safe Signal Function scripts', () => {
  const scenario = {
    name: 'SimulateCurrentSpike',
    repeatCount: 2,
    signals: [
      { target: 'MotorCurrent', kind: 'set', initialValue: 10, delaySeconds: 0.1 },
      { target: 'AlarmPin', kind: 'pulse', initialValue: 0, targetValue: 1, stepDelaySeconds: 0.05 },
      { target: 'RampValue', kind: 'ramp', initialValue: 0, targetValue: 100, steps: 5, stepDelaySeconds: 0.02 },
    ],
  }

  const script = buildSignalFunctionScript(scenario)
  assert.ok(script.includes('signal void SimulateCurrentSpike(void) {'))
  assert.ok(script.includes('for (_iter = 0; _iter < 2; _iter++) {'))
  assert.ok(script.includes('swatch(0.1000);'))
  assert.ok(script.includes('MotorCurrent = 10;'))
  assert.ok(script.includes('AlarmPin = 1;'))
  assert.ok(script.includes('AlarmPin = 0;'))
  assert.ok(script.includes('RampValue = 0.0000;'))
  assert.ok(script.includes('RampValue = 100.0000;'))
})

test('debug-script-builder: generates debug initialization (.ini) script', () => {
  const ini = buildDebugInitScript({
    vtorAddress: 0x08000000,
    signalScripts: ['LOAD "app.axf" INCREMENTAL', 'SimulateCurrentSpike()'],
  })

  assert.ok(ini.includes('RESET'))
  assert.ok(ini.includes('_WDWORD(0xE000ED08, 0x8000000); // VTOR'))
  assert.ok(ini.includes('LOAD "app.axf" INCREMENTAL'))
  assert.ok(ini.includes('SimulateCurrentSpike()'))
})

test('uvsc-client: binary packet framing and responses', async () => {
  const client = new KeilUvscClient({ timeoutMs: 1000 })

  const mockSocket = new EventEmitter()
  // @ts-ignore
  mockSocket.write = (chunk) => {
    const { frames } = decodeFrames(chunk)
    for (const f of frames) {
      const respPayload = { status: UVSC_STATUS.OK, echo: JSON.parse(f.payload.toString('utf8')) }
      const respPacket = encodeFrame({
        msgId: f.msgId,
        opcode: f.opcode,
        status: UVSC_STATUS.OK,
        payload: respPayload,
      })
      setImmediate(() => mockSocket.emit('data', respPacket))
    }
    return true
  }
  // @ts-ignore
  mockSocket.destroy = () => {}

  mockSocket.on('data', (d) => client._onData(d))
  client.connected = true
  client.socket = /** @type {any} */ (mockSocket)

  const res = await client.sendRequest(UVSC_OPCODES.UV_GEN_GET_VERSION, { hello: 'keil' })
  assert.deepEqual(res, { status: UVSC_STATUS.OK, opcode: UVSC_OPCODES.UV_GEN_GET_VERSION, echo: { hello: 'keil' } })

  client.disconnect()
  assert.equal(client.connected, false)
  await assert.rejects(() => client.sendRequest(UVSC_OPCODES.UV_GEN_GET_VERSION), /UVSC 客户端未连接/)
})

test('uvsc-client: handles chunk splitting and unsolicited async events', async () => {
  const client = new KeilUvscClient({ timeoutMs: 1000 })
  const mockSocket = new EventEmitter()
  // @ts-ignore
  mockSocket.write = () => true
  // @ts-ignore
  mockSocket.destroy = () => {}

  client.connected = true
  client.socket = /** @type {any} */ (mockSocket)

  /** @type {any[]} */
  const events = []
  client.on('event', (ev) => events.push(ev))

  // Unsolicited async event: msgId = 0
  const fullPacket = encodeFrame({
    msgId: 0,
    opcode: UVSC_OPCODES.UV_DBG_STOP_EXECUTION,
    status: UVSC_STATUS.OK,
    payload: { reason: 'watchpoint-hit' },
  })

  // Split into two chunks to test stream framing
  const chunk1 = fullPacket.subarray(0, 8)
  const chunk2 = fullPacket.subarray(8)

  client._onData(chunk1)
  assert.equal(events.length, 0)

  client._onData(chunk2)
  assert.equal(events.length, 1)
  assert.equal(events[0].opcode, UVSC_OPCODES.UV_DBG_STOP_EXECUTION)
  assert.equal(events[0].payload.reason, 'watchpoint-hit')

  client.disconnect()
})

/**
 * Creates a mock Keil UVSC client for backend unit testing.
 */
function createMockUvscClient() {
  const client = new EventEmitter()
  /** @type {Array<{ opcode: number, payload: any }>} */
  const sentCommands = []
  // @ts-ignore
  client.connected = true
  // @ts-ignore
  client.connect = async () => {
    // @ts-ignore
    client.connected = true
  }
  // @ts-ignore
  client.disconnect = () => {
    // @ts-ignore
    client.connected = false
  }

  const handler = async (opcode, payload = {}) => {
    sentCommands.push({ opcode, payload })

    switch (opcode) {
      case UVSC_OPCODES.UV_PRJ_LOAD:
      case UVSC_OPCODES.UV_PRJ_SET_TARGET:
        return { status: UVSC_STATUS.OK }
      case UVSC_OPCODES.UV_DBG_ENTER:
        return {
          status: UVSC_STATUS.OK,
          location: { file: 'main.c', line: 15, function: 'main', address: '0x08000100' },
        }
      case UVSC_OPCODES.UV_DBG_STOP_EXECUTION:
      case UVSC_OPCODES.UV_DBG_STEP_HLL:
      case UVSC_OPCODES.UV_DBG_STEP_INTO:
      case UVSC_OPCODES.UV_DBG_STEP_OUT:
        return {
          status: UVSC_STATUS.OK,
          location: { file: 'main.c', line: 20, function: 'main', address: '0x08000120' },
        }
      case UVSC_OPCODES.UV_DBG_RESET:
        return {
          status: UVSC_STATUS.OK,
          location: { file: 'main.c', line: 1, function: 'Reset_Handler', address: '0x08000000' },
        }
      case UVSC_OPCODES.UV_DBG_CREATE_BP:
        return { status: UVSC_STATUS.OK, bpId: 101 }
      case UVSC_OPCODES.UV_DBG_CHANGE_BP:
        return { status: UVSC_STATUS.OK }
      case UVSC_OPCODES.UV_DBG_EVAL_EXPRESSION_TO_STR:
      case UVSC_OPCODES.UV_DBG_CALC_EXPRESSION:
        return { status: UVSC_STATUS.OK, value: '42', type: 'int' }
      case UVSC_OPCODES.UV_DBG_READ_REGISTERS:
        return {
          status: UVSC_STATUS.OK,
          registers: [
            { name: 'R0', value: '0x00000000' },
            { name: 'PC', value: '0x08000120' },
          ],
        }
      case UVSC_OPCODES.UV_DBG_MEM_READ:
        return {
          status: UVSC_STATUS.OK,
          contents: '0102030405060708',
          bytes: [1, 2, 3, 4, 5, 6, 7, 8],
        }
      case UVSC_OPCODES.UV_DBG_EXEC_CMD:
        return { status: UVSC_STATUS.OK, wpId: 202 }
      default:
        return { status: UVSC_STATUS.OK }
    }
  }

  // @ts-ignore
  client.sendRequest = handler
  // @ts-ignore
  client.sendCommand = handler

  return { client, sentCommands }
}

test('KeilSimBackend: lifecycle, capabilities, breakpoints, watchpoints, inspect, memory', async () => {
  const { client, sentCommands } = createMockUvscClient()
  const eventRing = createDebugEventRing(100)

  const backend = new KeilSimBackend({
    debugSessionId: 'dbg_sim_1',
    ownerSessionId: 'owner_1',
    workspaceCwd: '/workspaces/proj',
    eventRing,
    uvscClient: /** @type {any} */ (client),
  })

  // Verify capabilities
  const caps = backend.capabilities()
  assert.equal(caps.breakpoints, true)
  assert.equal(caps.watchpoints, true)
  assert.equal(caps.memoryRead, true)
  assert.equal(caps.registers, true)
  assert.equal(caps.simulatorSignals, true)

  // Verify backend event subscription
  /** @type {import('../../src/types/debug-backend.d.ts').DebugBackendEvent[]} */
  const backendEvents = []
  backend.subscribe((ev) => backendEvents.push(ev))

  // 1. Start session
  const startRes = await backend.start({
    targetSpec: {
      projectPath: '/workspaces/proj/app.uvprojx',
      target: 'Target 1',
      host: '127.0.0.1',
      port: 5100,
    },
  })
  assert.equal(startRes.ok, true)
  assert.equal(backend.state, 'paused')
  assert.equal(startRes.location?.file, 'main.c')

  // Verify UVSC project load and enter debug sent
  assert.ok(sentCommands.some((c) => c.opcode === UVSC_OPCODES.UV_PRJ_LOAD))
  assert.ok(sentCommands.some((c) => c.opcode === UVSC_OPCODES.UV_DBG_ENTER))

  // 2. Control operations
  await backend.continue()
  assert.equal(backend.state, 'running')
  assert.ok(sentCommands.some((c) => c.opcode === UVSC_OPCODES.UV_DBG_START_EXECUTION))
  assert.ok(backendEvents.some((e) => e.type === 'backend.running'))

  await backend.pause()
  assert.equal(backend.state, 'paused')
  assert.ok(sentCommands.some((c) => c.opcode === UVSC_OPCODES.UV_DBG_STOP_EXECUTION))
  assert.ok(backendEvents.some((e) => e.type === 'backend.stopped' && e.reason === 'manual'))

  await backend.step('over')
  assert.equal(backend.state, 'paused')

  await backend.resetHalt()
  assert.equal(backend.state, 'paused')
  assert.equal(backend.currentLocation?.function, 'Reset_Handler')

  // 3. Breakpoints
  const bpRes = await backend.addBreakpoint({
    id: 'bp_1',
    file: 'main.c',
    line: 25,
    verified: false,
  })
  assert.equal(bpRes.verified, true)
  assert.equal(backend.breakpointMap.get('bp_1'), '101')

  await backend.removeBreakpoint('bp_1')
  assert.equal(backend.breakpointMap.has('bp_1'), false)

  // 4. Watchpoints
  const wpRes = await backend.addWatchpoint({
    id: 'wp_1',
    expression: 'SensorStatus',
    verified: false,
  })
  assert.equal(wpRes.verified, true)
  assert.equal(backend.watchpointMap.get('wp_1'), '202')

  await backend.removeWatchpoint({ id: 'wp_1' })
  assert.equal(backend.watchpointMap.has('wp_1'), false)

  // 5. Evaluate and inspect
  const evalVal = await backend.evaluate('1 + 41')
  assert.equal(evalVal, '42')

  const inspectRes = await backend.inspect()
  assert.equal(inspectRes.stack.length, 1)
  assert.equal(inspectRes.registers.length, 2)
  assert.equal(inspectRes.evalProbe, '42')

  // 6. Memory read
  const memHex = await backend.readMemory('0x20000000', 8)
  assert.equal(memHex, '0102030405060708')

  const memObj = await backend.memory('0x20000000', 8)
  assert.deepEqual(memObj.bytes, [1, 2, 3, 4, 5, 6, 7, 8])

  // 7. Scenario application
  const scenarioRes = await backend.applyScenario({
    name: 'InjectFault',
    signals: [{ target: 'SystemFault', kind: 'set', initialValue: 1 }],
  })
  assert.equal(scenarioRes.ok, true)
  assert.equal(scenarioRes.scenario, 'InjectFault')

  // 8. Command dispatcher
  const cmdRes = await backend.command({ type: 'evaluate', expression: 'x' })
  assert.equal(cmdRes, '42')

  // 9. Stop
  await backend.stop()
  assert.equal(backend.state, 'idle')
  assert.ok(backendEvents.some((e) => e.type === 'backend.exited'))

  // Events in event ring
  const events = eventRing.getEventsSince(0).events
  assert.ok(events.some((e) => e.type === 'debug.session.ready'))
  assert.ok(events.some((e) => e.type === 'debug.running'))
  assert.ok(events.some((e) => e.type === 'debug.paused'))
  assert.ok(events.some((e) => e.type === 'debug.session.stopped'))
})

test('DebugRuntime integrates with KeilSimBackend via backend factory', async () => {
  const { client } = createMockUvscClient()

  const runtime = createDebugRuntime({
    backendFactory: async (kind, ctx) => {
      if (kind === 'keil-simulator') {
        return new KeilSimBackend({
          ...ctx,
          uvscClient: /** @type {any} */ (client),
        })
      }
      throw new Error('Unsupported: ' + kind)
    },
  })

  // Start session on keil-simulator
  const startSessionView = await runtime.start({
    debugSessionId: 'dbg_runtime_sim',
    ownerSessionId: 'owner_agent',
    workspaceCwd: '/workspaces/test_proj',
    backend: 'keil-simulator',
    targetSpec: {
      projectPath: '/workspaces/test_proj/test.uvprojx',
    },
  })

  assert.equal(startSessionView.backend, 'keil-simulator')
  assert.equal(startSessionView.state, 'ready')

  // Step via runtime command
  const stepOut = await runtime.command(
    { debugSessionId: 'dbg_runtime_sim', ownerSessionId: 'owner_agent' },
    { type: 'step', stepType: 'into' },
  )
  assert.equal(stepOut.ok, true)

  // Evaluate via runtime command
  const evalOut = await runtime.command(
    { debugSessionId: 'dbg_runtime_sim', ownerSessionId: 'owner_agent' },
    { type: 'evaluate', expression: 'sensor_reading' },
  )
  assert.equal(evalOut.ok, true)
  assert.equal(evalOut.value, '42')

  // Stop session
  const stopOut = await runtime.stop({
    debugSessionId: 'dbg_runtime_sim',
    ownerSessionId: 'owner_agent',
  })
  assert.equal(stopOut.ok, true)
})
