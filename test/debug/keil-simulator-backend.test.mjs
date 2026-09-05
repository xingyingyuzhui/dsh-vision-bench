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
import { UvSockClient } from '../../src/infrastructure/debug/keil/uvsock-client.mjs'

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

/**
 * Creates a mock semantic UvSock client for backend unit testing.
 */
function createMockSemanticClient() {
  const client = new EventEmitter()
  /** @type {Array<{ method: string, args: any }>} */
  const calls = []

  // @ts-ignore
  client.connected = true
  // @ts-ignore
  client.connect = async (...args) => {
    calls.push({ method: 'connect', args })
    // @ts-ignore
    client.connected = true
  }
  // @ts-ignore
  client.close = () => {
    calls.push({ method: 'close', args: [] })
    // @ts-ignore
    client.connected = false
  }
  // @ts-ignore
  client.loadProject = async (path) => {
    calls.push({ method: 'loadProject', args: [path] })
    return { ok: true }
  }
  // @ts-ignore
  client.setTarget = async (t) => {
    calls.push({ method: 'setTarget', args: [t] })
    return { ok: true }
  }
  // @ts-ignore
  client.enterDebug = async () => {
    calls.push({ method: 'enterDebug', args: [] })
    return {
      ok: true,
      location: { file: 'main.c', line: 15, function: 'main', address: '0x08000100' },
    }
  }
  // @ts-ignore
  client.exitDebug = async () => {
    calls.push({ method: 'exitDebug', args: [] })
    return { ok: true }
  }
  // @ts-ignore
  client.startExecution = async () => {
    calls.push({ method: 'startExecution', args: [] })
    return { ok: true }
  }
  // @ts-ignore
  client.stopExecution = async () => {
    calls.push({ method: 'stopExecution', args: [] })
    return {
      ok: true,
      location: { file: 'main.c', line: 20, function: 'main', address: '0x08000120' },
    }
  }
  // @ts-ignore
  client.stepOver = async () => {
    calls.push({ method: 'stepOver', args: [] })
    return {
      ok: true,
      location: { file: 'main.c', line: 21, function: 'main', address: '0x08000124' },
    }
  }
  // @ts-ignore
  client.stepInto = async () => {
    calls.push({ method: 'stepInto', args: [] })
    return {
      ok: true,
      location: { file: 'main.c', line: 22, function: 'main', address: '0x08000128' },
    }
  }
  // @ts-ignore
  client.stepOut = async () => {
    calls.push({ method: 'stepOut', args: [] })
    return {
      ok: true,
      location: { file: 'main.c', line: 30, function: 'caller', address: '0x08000180' },
    }
  }
  // @ts-ignore
  client.reset = async () => {
    calls.push({ method: 'reset', args: [] })
    return {
      ok: true,
      location: { file: 'main.c', line: 1, function: 'Reset_Handler', address: '0x08000000' },
    }
  }
  // @ts-ignore
  client.createBreakpoint = async (spec) => {
    calls.push({ method: 'createBreakpoint', args: [spec] })
    return { ok: true, id: '101', verified: true }
  }
  // @ts-ignore
  client.deleteBreakpoint = async (id) => {
    calls.push({ method: 'deleteBreakpoint', args: [id] })
    return { ok: true }
  }
  // @ts-ignore
  client.evaluateExpression = async (expr) => {
    calls.push({ method: 'evaluateExpression', args: [expr] })
    return { ok: true, value: '42', type: 'int' }
  }
  // @ts-ignore
  client.readRegisters = async () => {
    calls.push({ method: 'readRegisters', args: [] })
    return [
      { name: 'R0', value: '0x00000000' },
      { name: 'PC', value: '0x08000120' },
    ]
  }
  // @ts-ignore
  client.readMemory = async (addr, len) => {
    calls.push({ method: 'readMemory', args: [addr, len] })
    return {
      address: addr,
      hex: '0102030405060708',
      bytes: [1, 2, 3, 4, 5, 6, 7, 8],
    }
  }
  // @ts-ignore
  client.executeCommand = async (cmd) => {
    calls.push({ method: 'executeCommand', args: [cmd] })
    return { ok: true }
  }

  return { client, calls }
}

test('KeilSimBackend: lifecycle, capabilities, breakpoints, watchpoints, inspect, memory', async () => {
  const { client, calls } = createMockSemanticClient()
  const eventRing = createDebugEventRing(100)

  const backend = new KeilSimBackend({
    debugSessionId: 'dbg_sim_1',
    ownerSessionId: 'owner_1',
    workspaceCwd: '/workspaces/proj',
    eventRing,
    uvsockClient: /** @type {any} */ (client),
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

  // Verify semantic loadProject and enterDebug calls
  assert.ok(calls.some((c) => c.method === 'loadProject'))
  assert.ok(calls.some((c) => c.method === 'enterDebug'))

  // 2. Control operations
  await backend.continue()
  assert.equal(backend.state, 'running')
  assert.ok(calls.some((c) => c.method === 'startExecution'))
  assert.ok(backendEvents.some((e) => e.type === 'backend.running'))

  await backend.pause()
  assert.equal(backend.state, 'paused')
  assert.ok(calls.some((c) => c.method === 'stopExecution'))
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
  assert.equal(backend.watchpointMap.get('wp_1'), 'wp_1')

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
  const { client } = createMockSemanticClient()

  const runtime = createDebugRuntime({
    backendFactory: async (kind, ctx) => {
      if (kind === 'keil-simulator') {
        return new KeilSimBackend({
          ...ctx,
          uvsockClient: /** @type {any} */ (client),
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
