// @ts-check

import assert from 'node:assert/strict'
import test from 'node:test'
import { executeHostCommand } from '../../src/application/commands/host-command-service.mjs'
import { createDebugRuntime, setSharedDebugRuntime } from '../../src/application/debug/debug-runtime.mjs'
import {
  dispatchHostCommand,
  dispatchVisionCommand,
  dispatchVisionDebugCommand,
  registerVisionHost,
  unregisterVisionHost,
} from '../../src/infrastructure/host/vision-host-client.mjs'
import { createVisionCommandDispatcher, handleCommand } from '../../src/interfaces/http/vision-command-routes.mjs'

test('host-command-routing: routes debug.* to debug command service and others to vision command service', async () => {
  const mockRuntime = createDebugRuntime()
  setSharedDebugRuntime(mockRuntime)

  try {
    // 1. debug.* routes to executeDebugCommand
    const debugRes = await executeHostCommand({
      action: 'debug.status',
      cwd: '/workspace/test',
      sessionId: 'sess_1',
    })

    assert.equal(debugRes.ok, true)
    assert.equal(debugRes.action, 'debug.status')
    assert.equal(debugRes.active, false)

    // 2. non-debug action routes to executeVisionCommand (e.g. system.ping)
    const visionRes = await executeHostCommand({
      action: 'system.ping',
      sessionId: 'sess_1',
    })

    assert.equal(visionRes.ok, true)
    assert.equal(visionRes.action, 'system.ping')
    assert.equal(visionRes.data?.service, 'dsh-vision-bench')
  } finally {
    setSharedDebugRuntime(null)
  }
})

test('host-command-routing: HTTP handleCommand routes both vision and debug actions via executeHostCommand', async () => {
  const mockRuntime = createDebugRuntime()
  setSharedDebugRuntime(mockRuntime)

  try {
    const mockReq = {}
    const readBodyAndTouchSession = async () => ({
      action: 'debug.status',
      sessionId: 'sess_http_1',
      cwd: '/workspace/app',
    })

    const res = await handleCommand('/tmp/dsh-home', mockReq, readBodyAndTouchSession)
    assert.equal(res.ok, true)
    assert.equal(res.action, 'debug.status')
    assert.equal(res.active, false)

    const readPingBody = async () => ({
      action: 'system.ping',
      sessionId: 'sess_http_2',
    })

    const pingRes = await handleCommand('/tmp/dsh-home', mockReq, readPingBody)
    assert.equal(pingRes.ok, true)
    assert.equal(pingRes.action, 'system.ping')
  } finally {
    setSharedDebugRuntime(null)
  }
})

test('host-command-routing: dispatcher dispatches both vision and debug commands', async () => {
  const mockRuntime = createDebugRuntime()
  setSharedDebugRuntime(mockRuntime)

  try {
    const dispatcher = createVisionCommandDispatcher('/tmp/dsh-home')
    const unregister = registerVisionHost(dispatcher)

    try {
      // dispatchVisionCommand for regular vision action
      const pingRes = await dispatchVisionCommand({
        action: 'system.ping',
        sessionId: 'sess_disp_1',
      })
      assert.equal(pingRes.ok, true)
      assert.equal(pingRes.action, 'system.ping')

      // dispatchVisionDebugCommand auto-prefixes debug.
      const debugRes = await dispatchVisionDebugCommand({
        action: 'status',
        sessionId: 'sess_disp_2',
        cwd: '/workspace/embedded',
      })
      assert.equal(debugRes.ok, true)
      assert.equal(debugRes.action, 'debug.status')
    } finally {
      unregister()
    }
  } finally {
    setSharedDebugRuntime(null)
  }
})
