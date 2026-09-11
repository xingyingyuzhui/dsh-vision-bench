// @ts-check
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createDebugRuntime } from '../../src/application/debug/debug-runtime.mjs'
import { createDebugApprovalStore } from '../../src/application/debug/debug-approval-service.mjs'
import { startDebugSession } from '../../src/application/debug/debug-start-service.mjs'
import { createDebugRpcHandler } from '../../src/interfaces/rpc/debug-rpc-handler.mjs'
import { DEBUG_RPC_ENDPOINTS } from '../../src/shared/debug-contract.mjs'

const AXF = join(tmpdir(), `dvb-home-${Date.now()}.axf`)
writeFileSync(AXF, 'ELF payload')
const HOME = '/tmp/fake-dsh-home'

function stubRuntime() {
  return createDebugRuntime({
    backendFactory: async () => ({ async start() {}, async stop() {}, subscribe: () => () => {} }),
  })
}

test('C1: startDebugSession 把 deps.home 传给 specResolver', async () => {
  /** @type {any} */
  let seen = null
  await startDebugSession(
    { sessionId: 'agent_x', cwd: '/ws', source: 'agent', backend: 'gdb-openocd', targetSpec: {} },
    {
      debugRuntime: stubRuntime(),
      approvalStore: createDebugApprovalStore(),
      home: HOME,
      specResolver: async (_req, deps) => {
        seen = deps
        return {
          backend: 'gdb-openocd',
          source: 'auto-resolved',
          projectPath: '',
          targetName: '',
          targetSpec: { artifactPath: AXF },
        }
      },
    },
  )
  assert.deepEqual(seen, { home: HOME })
})

test('C1: 没有 home 时 specResolver 收到空对象（不传 undefined）', async () => {
  /** @type {any} */
  let seen = 'unset'
  await startDebugSession(
    { sessionId: 'agent_x', cwd: '/ws', source: 'agent', backend: 'gdb-openocd', targetSpec: {} },
    {
      debugRuntime: stubRuntime(),
      approvalStore: createDebugApprovalStore(),
      specResolver: async (_req, deps) => {
        seen = deps
        return {
          backend: 'gdb-openocd',
          source: 'auto-resolved',
          projectPath: '',
          targetName: '',
          targetSpec: { artifactPath: AXF },
        }
      },
    },
  )
  assert.deepEqual(seen, {})
})

test('C1: request.home 作为 deps.home 的兜底', async () => {
  /** @type {any} */
  let seen = null
  await startDebugSession(
    {
      sessionId: 'agent_x',
      cwd: '/ws',
      source: 'agent',
      backend: 'gdb-openocd',
      targetSpec: {},
      home: HOME,
    },
    {
      debugRuntime: stubRuntime(),
      approvalStore: createDebugApprovalStore(),
      specResolver: async (_req, deps) => {
        seen = deps
        return {
          backend: 'gdb-openocd',
          source: 'auto-resolved',
          projectPath: '',
          targetName: '',
          targetSpec: { artifactPath: AXF },
        }
      },
    },
  )
  assert.deepEqual(seen, { home: HOME })
})

test('C1: debug-rpc-handler 的 getHome 可被依赖注入', async () => {
  const handler = createDebugRpcHandler({
    debugRuntime: stubRuntime(),
    approvalStore: createDebugApprovalStore(),
    getHome: () => HOME,
  })
  const res = await handler(DEBUG_RPC_ENDPOINTS.STATE, { cwd: '/ws', sessionId: 's1' })
  assert.equal(res.ok, true)
  assert.equal(res.active, false)
})

test('C1: getHome 抛错时不炸掉请求', async () => {
  const handler = createDebugRpcHandler({
    debugRuntime: stubRuntime(),
    approvalStore: createDebugApprovalStore(),
    getHome: () => {
      throw new Error('home unavailable')
    },
  })
  const res = await handler(DEBUG_RPC_ENDPOINTS.STATE, { cwd: '/ws', sessionId: 's1' })
  assert.equal(res.ok, true)
})

test('C1: 无 getHome 的旧构造方式仍然可用（向后兼容）', async () => {
  const handler = createDebugRpcHandler({
    debugRuntime: stubRuntime(),
    approvalStore: createDebugApprovalStore(),
  })
  const res = await handler(DEBUG_RPC_ENDPOINTS.STATE, { cwd: '/ws', sessionId: 's1' })
  assert.equal(res.ok, true)
})
