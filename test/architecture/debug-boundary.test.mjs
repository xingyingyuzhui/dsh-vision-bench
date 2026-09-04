import assert from 'node:assert/strict'
import test from 'node:test'
import { ACTIONS } from '../../bench-tool.mjs'
import { apply } from '../../host.js'
import { VISION_RPC_CHANNEL } from '../../src/shared/vision-rpc-contract.mjs'
import { DEBUG_SECTIONS } from '../../src/ui/workspace/vision-route.mjs'

test('debug boundary: VISION_RPC_CHANNEL remains strictly unique', () => {
  assert.equal(VISION_RPC_CHANNEL, '/vision-bench')
})

test('debug boundary: Host registers exactly one HTTP route (/dsh-vision-bench/command), no debug HTTP routes', async () => {
  const routes = []
  const registeredChannels = []

  const mockCtx = {
    connection: {
      rpc: {
        handle(channel) {
          registeredChannels.push(channel)
          return () => {}
        },
      },
    },
    webServer: {
      register(entry) {
        routes.push(entry)
        return () => {}
      },
    },
    tools: {
      register() {
        return () => {}
      },
    },
    agentPresets: {
      register() {
        return () => {}
      },
    },
    effect(factory) {
      const cleanup = factory()
      if (typeof cleanup === 'function') cleanup()
    },
  }

  await apply(mockCtx, { dshHome: '/tmp/mock-dsh-home' })

  // Exactly one HTTP route on webServer
  assert.equal(routes.length, 1, 'webServer must have exactly one registered route')
  assert.equal(routes[0]?.path, '/dsh-vision-bench/command')

  // No separate debug HTTP routes
  assert.ok(
    !routes.some((r) => r.path && r.path.includes('/debug')),
    'Host must not register any debug HTTP routes on webServer',
  )

  // Connection RPC channel is strictly unique
  assert.deepEqual(registeredChannels, ['/vision-bench'])
})

test('debug boundary: vision_bench ACTIONS contains no debug ops (must live in vision_debug)', () => {
  const actionsList = Array.from(ACTIONS)
  const debugActions = actionsList.filter((action) => {
    const act = String(action).toLowerCase()
    return (
      act.startsWith('debug') ||
      act.includes('breakpoint') ||
      act.includes('watchpoint') ||
      act.includes('step') ||
      act.includes('gdb') ||
      act.includes('openocd')
    )
  })

  assert.deepEqual(
    debugActions,
    [],
    `vision_bench ACTIONS must stay clean without debug operations; found: ${debugActions.join(', ')}`,
  )
})

test('debug boundary: DebugWorkspace sections only contain known sections (workbench, project, runtime)', () => {
  // Phase 7: expected sections are WORKBENCH, PROJECT, and RUNTIME
  const sectionValues = Object.values(DEBUG_SECTIONS).sort()
  assert.deepEqual(
    sectionValues,
    ['project', 'runtime', 'workbench'],
    'DebugWorkspace must only have known sections in Phase 7',
  )
})

test('program boundary: ProgramModel canonical model does not import archify or infrastructure (ADR-015)', async () => {
  const fs = await import('node:fs')
  const src = fs.readFileSync('src/domain/program/program-model.mjs', 'utf8')
  assert.ok(!src.includes('archify'), 'ProgramModel must never import or reference archify')
  assert.ok(!src.includes('infrastructure'), 'ProgramModel in domain must never import infrastructure')
  assert.ok(!src.includes('child_process'), 'ProgramModel in domain must never import child_process')
})
