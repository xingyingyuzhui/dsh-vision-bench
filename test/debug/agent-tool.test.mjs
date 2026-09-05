// @ts-check

import assert from 'node:assert/strict'
import test from 'node:test'
import { ACTIONS as BENCH_ACTIONS, visionBenchTool } from '../../bench-tool.mjs'
import { apply } from '../../host.js'
import { registerVisionHost, unregisterVisionHost } from '../../src/infrastructure/host/vision-host-client.mjs'
import {
  DEBUG_TOOL_ACTIONS,
  cwdOf,
  sessionIdOf,
  visionDebugTool,
} from '../../src/interfaces/agent/vision-debug-tool.mjs'

test('agent-tool: vision_debug schema matches specification', () => {
  const tool = visionDebugTool('/tmp/dsh-home')
  assert.equal(tool.name, 'vision_debug')
  assert.ok(tool.description.includes('Firmware runtime debugging tool'))

  const actions = tool.parameters.properties.action.enum
  const expectedActions = [
    'status',
    'start',
    'stop',
    'run',
    'pause',
    'step',
    'breakpoint',
    'watchpoint',
    'inspect',
    'evaluate',
    'snapshot',
    'reset',
    'verify',
  ]

  assert.deepEqual(actions.sort(), expectedActions.sort())
  assert.equal(tool.parameters.required[0], 'action')
  assert.equal(tool.parameters.additionalProperties, false)

  const props = tool.parameters.properties
  assert.ok(props.backend)
  assert.ok(props.file)
  assert.ok(props.line)
  assert.ok(props.function)
  assert.ok(props.expression)
  assert.ok(props.access)
  assert.ok(props.breakpointId)
  assert.ok(props.watchpointId)
  assert.ok(props.stepType)
  assert.ok(props.frame)
  assert.ok(props.include)
  assert.ok(props.address)
  assert.ok(props.length)
  assert.ok(props.commandId)

  // Does not leak raw commands
  assert.equal(props.rawMi, undefined)
  assert.equal(props.rawCommand, undefined)
  assert.equal(props.openocdCommand, undefined)
  assert.equal(props.uvsock, undefined)
})

test('agent-tool: vision_bench and vision_debug are strictly isolated', () => {
  const benchTool = visionBenchTool('/tmp/dsh-home')
  const debugTool = visionDebugTool('/tmp/dsh-home')

  const benchActions = new Set(benchTool.parameters.properties.action.enum)
  const debugActions = new Set(debugTool.parameters.properties.action.enum)

  // Bench actions must not contain debug operations
  const debugOps = [
    'start',
    'stop',
    'run',
    'pause',
    'step',
    'breakpoint',
    'watchpoint',
    'inspect',
    'evaluate',
    'snapshot',
    'reset',
  ]
  for (const op of debugOps) {
    assert.ok(!benchActions.has(op), `bench action enum must not contain debug op: ${op}`)
  }

  // Debug actions must not contain bench domain operations
  const benchOps = [
    'ls',
    'select',
    'build',
    'map',
    'read',
    'write',
    'points',
    'frames',
    'focus',
    'trend',
    'visualization',
    'alarm',
    'evidence',
    'configureConnection',
    'openConnection',
    'closeConnection',
    'system.ping',
  ]
  for (const op of benchOps) {
    assert.ok(!debugActions.has(op), `debug action enum must not contain bench op: ${op}`)
  }

  // Both tools only share contextual status
  const common = [...benchActions].filter((act) => debugActions.has(act))
  assert.deepEqual(common, ['status'])
})

test('agent-tool: host registers both tools when role is agent', async () => {
  const registeredTools = []
  let guidanceRegistered = false

  const mockCtx = {
    tools: {
      register(tool) {
        registeredTools.push(tool)
        return () => {
          const idx = registeredTools.indexOf(tool)
          if (idx >= 0) registeredTools.splice(idx, 1)
        }
      },
    },
    systemPrompt: {
      section(opts) {
        guidanceRegistered = true
        assert.equal(opts.name, 'vision-bench:guidance')
        return () => {}
      },
    },
    effect(factory) {
      this.teardown = factory()
    },
  }

  apply(mockCtx, { role: 'agent' })

  assert.equal(registeredTools.length, 2)
  const toolNames = registeredTools.map((t) => t.name).sort()
  assert.deepEqual(toolNames, ['vision_bench', 'vision_debug'])
  assert.equal(guidanceRegistered, true)

  // Teardown cleans up both
  if (typeof mockCtx.teardown === 'function') {
    mockCtx.teardown()
  }
  assert.equal(registeredTools.length, 0)
})

test('agent-tool: vision_debug execute dispatches namespaced command and handles cancellation', async () => {
  const dispatched = []
  const unregister = registerVisionHost({
    async dispatch(cmd) {
      dispatched.push(cmd)
      return { ok: true, action: cmd.action, commandId: cmd.commandId }
    },
  })

  try {
    const tool = visionDebugTool('/tmp/dsh-home')

    // 1. Normal execution
    const mockAgent = {
      session: {
        header: {
          id: 'sess_agent_1',
          cwd: '/workspace/test',
        },
      },
    }

    const res = await tool.execute(
      { action: 'status', commandId: 'cmd_123' },
      { agent: mockAgent, signal: new AbortController().signal },
    )

    assert.equal(res.ok, true)
    assert.equal(dispatched.length, 1)
    assert.equal(dispatched[0].action, 'debug.status')
    assert.equal(dispatched[0].source, 'agent')
    assert.equal(dispatched[0].sessionId, 'sess_agent_1')
    assert.equal(dispatched[0].cwd, '/workspace/test')

    // 2. Aborted execution
    const ac = new AbortController()
    ac.abort()

    const cancelledRes = await tool.execute({ action: 'run' }, { agent: mockAgent, signal: ac.signal })
    assert.equal(cancelledRes.ok, false)
    assert.equal(cancelledRes.cancelled, true)
  } finally {
    unregister()
  }
})

test('agent-tool: helpers cwdOf and sessionIdOf extract session headers safely', () => {
  assert.equal(cwdOf(null), '')
  assert.equal(cwdOf({}), '')
  assert.equal(cwdOf({ session: {} }), '')
  assert.equal(cwdOf({ session: { header: { cwd: '/test/cwd' } } }), '/test/cwd')

  assert.equal(sessionIdOf(null), '')
  assert.equal(sessionIdOf({}), '')
  assert.equal(sessionIdOf({ session: { id: 'fallback_id' } }), 'fallback_id')
  assert.equal(sessionIdOf({ session: { header: { id: 'hdr_id' }, id: 'fallback_id' } }), 'hdr_id')
})
