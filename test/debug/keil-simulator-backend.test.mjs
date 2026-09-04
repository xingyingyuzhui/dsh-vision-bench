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
import { KeilUvSockClient, UVSOCK_OPCODES, UVSOCK_STATUS } from '../../src/infrastructure/debug/keil/uvsock-client.mjs'

test('debug-script-builder: validates identifiers to prevent script injection', () => {
  assert.doesNotThrow(() => validateScriptIdentifier('sensor_val'))
  assert.doesNotThrow(() => validateScriptIdentifier('Port_1.pin2'))
  assert.doesNotThrow(() => validateScriptIdentifier('ADC1_DR'))

  assert.throws(() => validateScriptIdentifier(''), /非法的脚本标识符/)
  assert.throws(() => validateScriptIdentifier('sensor; exec("rm -rf")', /非法的脚本标识符/))
  assert.throws(() => validateScriptIdentifier('123abc', /非法的脚本标识符/))
  assert.throws(() => validateScriptIdentifier('foo(bar)', /非法的脚本标识符/))
  assert.throws(() => validateScriptIdentifier('a b c', /非法的脚本标识符/))
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

test('uvsock-client: packet framing and responses', async () => {
  const client = new KeilUvSockClient({ timeoutMs: 1000 })

  // Mock socket implementation
  const mockSocket = new EventEmitter()
  mockSocket.write = (chunk) => {
    // Read header: [seq: uint32BE, opcode: uint16BE, len: uint32BE]
    const seq = chunk.readUInt32BE(0)
    const opcode = chunk.readUInt16BE(4)
    const len = chunk.readUInt32BE(6)
    const payload = JSON.parse(chunk.subarray(10, 10 + len).toString('utf8'))

    // Echo response packet with status OK
    const responsePayload = Buffer.from(JSON.stringify({ status: UVSOCK_STATUS.OK, echo: payload }), 'utf8')
    const respHeader = Buffer.alloc(10)
    respHeader.writeUInt32BE(seq, 0)
    respHeader.writeUInt16BE(opcode, 4)
    respHeader.writeUInt32BE(responsePayload.length, 6)

    const respPacket = Buffer.concat([respHeader, responsePayload])
    // Simulate async delivery
    setImmediate(() => mockSocket.emit('data', respPacket))
    return true
  }
  mockSocket.destroy = () => {}

  mockSocket.on('data', (d) => client._onData(d))
  client.connected = true
  client.socket = /** @type {any} */ (mockSocket)

  const res = await client.sendCommand(UVSOCK_OPCODES.PING, { hello: 'keil' })
  assert.deepEqual(res, { status: UVSOCK_STATUS.OK, echo: { hello: 'keil' } })

  client.disconnect()
  assert.equal(client.connected, false)
  await assert.rejects(() => client.sendCommand(UVSOCK_OPCODES.PING), /UVSOCK 客户端未连接/)
})

test('uvsock-client: handles chunk splitting and unsolicited async events', async () => {
  const client = new KeilUvSockClient({ timeoutMs: 1000 })
  const mockSocket = new EventEmitter()
  mockSocket.write = () => true
  mockSocket.destroy = () => {}

  client.connected = true
  client.socket = /** @type {any} */ (mockSocket)

  /** @type {any[]} */
  const events = []
  client.on('event', (ev) => events.push(ev))

  // Unsolicited event: seq = 0
  const eventPayload = Buffer.from(JSON.stringify({ event: 'stop', reason: 'watchpoint-hit' }), 'utf8')
  const header = Buffer.alloc(10)
  header.writeUInt32BE(0, 0)
  header.writeUInt16BE(UVSOCK_OPCODES.PAUSE, 4)
  header.writeUInt32BE(eventPayload.length, 6)
  const fullPacket = Buffer.concat([header, eventPayload])

  // Split into two chunks to test stream framing
  const chunk1 = fullPacket.subarray(0, 6)
  const chunk2 = fullPacket.subarray(6)

  client._onData(chunk1)
  assert.equal(events.length, 0)

  client._onData(chunk2)
  assert.equal(events.length, 1)
  assert.equal(events[0].opcode, UVSOCK_OPCODES.PAUSE)
  assert.equal(events[0].payload.reason, 'watchpoint-hit')

  client.disconnect()
})

/**
 * Creates a mock Keil UvSock client for backend unit testing.
 */
function createMockUvSockClient() {
  const client = new EventEmitter()
  /** @type {Array<{ opcode: number, payload: any }>} */
  const sentCommands = []
  client.connected = true
  client.connect = async () => {
    client.connected = true
  }
  client.disconnect = () => {
    client.connected = false
  }
  client.sendCommand = async (opcode, payload = {}) => {
    sentCommands.push({ opcode, payload })

    switch (opcode) {
      case UVSOCK_OPCODES.START_DEBUG:
        return {
          status: UVSOCK_STATUS.OK,
          location: { file: 'main.c', line: 15, function: 'main', address: '0x08000100' },
        }
      case UVSOCK_OPCODES.PAUSE:
      case UVSOCK_OPCODES.STEP:
        return {
          status: UVSOCK_STATUS.OK,
          location: { file: 'main.c', line: 20, function: 'main', address: '0x08000120' },
        }
      case UVSOCK_OPCODES.RESET:
        return {
          status: UVSOCK_STATUS.OK,
          location: { file: 'main.c', line: 1, function: 'Reset_Handler', address: '0x08000000' },
        }
      case UVSOCK_OPCODES.SET_BP:
        return { status: UVSOCK_STATUS.OK, bpId: 101 }
      case UVSOCK_OPCODES.DEL_BP:
        return { status: UVSOCK_STATUS.OK }
      case UVSOCK_OPCODES.SET_WP:
        return { status: UVSOCK_STATUS.OK, wpId: 202 }
      case UVSOCK_OPCODES.DEL_WP:
        return { status: UVSOCK_STATUS.OK }
      case UVSOCK_OPCODES.EVAL:
        return { status: UVSOCK_STATUS.OK, value: '42', type: 'int' }
      case UVSOCK_OPCODES.READ_REGS:
        return {
          status: UVSOCK_STATUS.OK,
          registers: [
            { name: 'R0', value: '0x00000000' },
            { name: 'PC', value: '0x08000120' },
          ],
        }
      case UVSOCK_OPCODES.READ_MEM:
        return {
          status: UVSOCK_STATUS.OK,
          contents: '0102030405060708',
          bytes: [1, 2, 3, 4, 5, 6, 7, 8],
        }
      case UVSOCK_OPCODES.EXEC_CMD:
        return { status: UVSOCK_STATUS.OK }
      default:
        return { status: UVSOCK_STATUS.OK }
    }
  }

  return { client, sentCommands }
}

test('KeilSimBackend: lifecycle, breakpoints, watchpoints, inspect, memory', async () => {
  const { client, sentCommands } = createMockUvSockClient()
  const eventRing = createDebugEventRing(100)

  const backend = new KeilSimBackend({
    debugSessionId: 'dbg_sim_1',
    ownerSessionId: 'owner_1',
    workspaceCwd: '/workspaces/proj',
    eventRing,
    uvsockClient: /** @type {any} */ (client),
  })

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

  // Verify open project and start debug sent
  assert.ok(sentCommands.some((c) => c.opcode === UVSOCK_OPCODES.OPEN_PROJECT))
  assert.ok(sentCommands.some((c) => c.opcode === UVSOCK_OPCODES.START_DEBUG))

  // 2. Control operations
  await backend.continue()
  assert.equal(backend.state, 'running')
  assert.ok(sentCommands.some((c) => c.opcode === UVSOCK_OPCODES.RUN))

  await backend.pause()
  assert.equal(backend.state, 'paused')

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

  // Events in event ring
  const events = eventRing.getEventsSince(0).events
  assert.ok(events.some((e) => e.type === 'debug.session.ready'))
  assert.ok(events.some((e) => e.type === 'debug.running'))
  assert.ok(events.some((e) => e.type === 'debug.paused'))
  assert.ok(events.some((e) => e.type === 'debug.session.stopped'))
})

test('DebugRuntime integrates with KeilSimBackend via backend factory', async () => {
  const { client } = createMockUvSockClient()

  const runtime = createDebugRuntime({
    backendFactory: async (kind, ctx) => {
      if (kind === 'keil-simulator') {
        return new KeilSimBackend({
          ...ctx,
          uvsockClient: /** @type {any} */ (client),
        })
      }
      throw new Error(`Unsupported: ${kind}`)
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
