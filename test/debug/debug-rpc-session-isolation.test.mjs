import assert from 'node:assert/strict'
// @ts-check
import test from 'node:test'
import { createDebugRuntime } from '../../src/application/debug/debug-runtime.mjs'
import { createDebugRpcHandler } from '../../src/interfaces/rpc/debug-rpc-handler.mjs'
import { DEBUG_RPC_ENDPOINTS } from '../../src/shared/debug-contract.mjs'

test('PR-2: Browser RPC session isolation: same cwd foreign session cannot claim or observe debug session', async () => {
  const runtime = createDebugRuntime({
    backendFactory: () => ({
      start: async () => {},
      stop: async () => {},
    }),
  })

  const handler = createDebugRpcHandler({ debugRuntime: runtime })

  // Session A in /workspace/app1 starts debug session
  const startRes = await runtime.start({
    ownerSessionId: 'session_A',
    workspaceCwd: '/workspace/app1',
    backend: 'gdb-openocd',
    targetSpec: {
      artifactPath: '/workspace/app1/build.elf',
      interfaceName: 'cmsis-dap',
      probeSerial: 'PROBE_123',
    },
  })
  assert.ok(startRes.debugSessionId)

  // Session A queries state: active = true
  const stateA = await handler(DEBUG_RPC_ENDPOINTS.STATE, {
    sessionId: 'session_A',
    cwd: '/workspace/app1',
  })
  assert.equal(stateA.ok, true)
  assert.equal(stateA.active, true)
  assert.equal(stateA.session?.debugSessionId, startRes.debugSessionId)

  // Session B in SAME cwd (/workspace/app1) queries state: must be active = false, session = null
  const stateB = await handler(DEBUG_RPC_ENDPOINTS.STATE, {
    sessionId: 'session_B',
    cwd: '/workspace/app1',
  })
  assert.equal(stateB.ok, true)
  assert.equal(stateB.active, false)
  assert.equal(stateB.session, null)

  // Session B cannot stop Session A
  const stopB = await handler(DEBUG_RPC_ENDPOINTS.COMMAND, {
    sessionId: 'session_B',
    cwd: '/workspace/app1',
    op: 'stop',
  })
  assert.equal(stopB.alreadyStopped, true)

  // Session A is still running
  const stateA2 = await handler(DEBUG_RPC_ENDPOINTS.STATE, {
    sessionId: 'session_A',
    cwd: '/workspace/app1',
  })
  assert.equal(stateA2.active, true)

  await runtime.shutdown()
})
