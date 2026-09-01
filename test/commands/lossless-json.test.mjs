import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { saveWorkspace } from '../../bench-store.mjs'
import { visionBenchTool } from '../../bench-tool.mjs'
import { envelope } from '../../src/application/commands/command-contract.mjs'
import {
  compactAgentResult,
  isLosslessJsonValue,
  losslessCommandResult,
  toLosslessJson,
} from '../../src/application/commands/lossless-json.mjs'
import { executeVisionCommand } from '../../src/application/commands/vision-command-service.mjs'
import {
  dispatchVisionCommand,
  pingVisionHost,
  registerVisionHost,
  unregisterVisionHost,
} from '../../src/infrastructure/host/vision-host-client.mjs'
import { createVisionCommandDispatcher, handleCommand } from '../../src/interfaces/http/vision-command-routes.mjs'

function assertLossless(value, label = 'value') {
  assert.equal(isLosslessJsonValue(value), true, `${label} must be lossless JSON`)
  assert.deepEqual(value, JSON.parse(JSON.stringify(value)), `${label} must survive JSON round-trip`)
}

test('isLosslessJsonValue rejects undefined properties, holes, NaN, Date and AbortSignal', () => {
  assert.equal(isLosslessJsonValue({ ok: true }), true)
  assert.equal(isLosslessJsonValue({ ok: true, error: undefined }), false)
  assert.equal(isLosslessJsonValue([1, undefined, 2]), false)
  const holey = Array(3)
  holey[0] = 1
  holey[2] = 2
  assert.equal(isLosslessJsonValue(holey), false)
  assert.equal(isLosslessJsonValue({ n: Number.NaN }), false)
  assert.equal(isLosslessJsonValue({ n: Number.POSITIVE_INFINITY }), false)
  assert.equal(isLosslessJsonValue({ when: new Date() }), false)
  assert.equal(isLosslessJsonValue({ signal: new AbortController().signal }), false)
  assert.equal(isLosslessJsonValue({ err: new Error('x') }), false)
})

test('toLosslessJson matches HTTP stringify: drops undefined, nulls holes/NaN, ISO dates', () => {
  const when = new Date('2026-01-01T00:00:00.000Z')
  const cleaned = toLosslessJson({
    ok: true,
    error: undefined,
    errorCode: undefined,
    workspace: { a: undefined, n: Number.NaN, when, nested: { list: [1, undefined, 2] } },
    signal: new AbortController().signal,
    boom: new Error('nope'),
    big: 10n,
    skip: () => {},
  })
  assertLossless(cleaned)
  assert.equal('error' in cleaned, false)
  assert.equal('errorCode' in cleaned, false)
  assert.equal('a' in cleaned.workspace, false)
  assert.equal(cleaned.workspace.n, null)
  assert.equal(cleaned.workspace.when, '2026-01-01T00:00:00.000Z')
  assert.deepEqual(cleaned.workspace.nested.list, [1, null, 2])
  assert.equal('signal' in cleaned, false)
  assert.equal('skip' in cleaned, false)
  assert.deepEqual(cleaned.boom, { name: 'Error', message: 'nope' })
  assert.equal(cleaned.big, '10')
})

test('compactAgentResult drops workspace dumps but keeps config fields', () => {
  const compact = compactAgentResult({
    ok: true,
    nextConfigVersion: 4,
    changedPointIds: ['p1'],
    points: [{ id: 'p1' }],
    workspace: { log: [{ action: 'build' }], keil: { project: 'x' } },
  })
  assert.equal('workspace' in compact, false)
  assert.equal(compact.nextConfigVersion, 4)
  assert.deepEqual(compact.changedPointIds, ['p1'])
})

test('circular structures fail closed as HOST_INVALID_RESPONSE', () => {
  const cycle = { ok: true }
  cycle.self = cycle
  assert.equal(toLosslessJson(cycle), undefined)
  const ran = losslessCommandResult(cycle)
  assertLossless(ran)
  assert.equal(ran.ok, false)
  assert.equal(ran.errorCode, 'HOST_INVALID_RESPONSE')
})

test('envelope of a successful ping has no undefined own properties', () => {
  const ran = envelope(
    { commandId: 'cmd1', action: 'system.ping', cwd: '', sessionId: '', source: 'system', payload: {} },
    { ok: true, action: 'system.ping', data: { service: 'dsh-vision-bench', pid: 1 } },
  )
  assertLossless(ran)
  assert.equal(ran.ok, true)
  assert.equal(ran.action, 'system.ping')
  assert.equal('error' in ran, false)
  assert.equal('errorCode' in ran, false)
  assert.equal('workspace' in ran, false)
})

test('in-process executeVisionCommand system.ping/status/ls are lossless JSON', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-json-'))
  const cwd = join(home, 'board')
  mkdirSync(cwd, { recursive: true })
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [{ id: 'c1', name: 'C1', conn: { mode: 'tcp', host: '127.0.0.1', sim: true } }],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points: [
        { id: 'p1', connectionId: 'c1', deviceId: 'd1', name: 'T', function: 3, address: 0, monitorEnabled: true },
      ],
    },
  })
  try {
    const ping = await executeVisionCommand({ home, cwd, action: 'system.ping', source: 'system' })
    assert.equal(ping.ok, true)
    assertLossless(ping, 'system.ping')
    const status = await executeVisionCommand({ home, cwd, action: 'status', source: 'agent', sessionId: 's1' })
    assert.equal(status.ok, true)
    assertLossless(status, 'status')
    const ls = await executeVisionCommand({ home, cwd, action: 'ls', source: 'agent', sessionId: 's1' })
    assert.equal(ls.ok, true)
    assertLossless(ls, 'ls')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('in-process Agent tool execute sanitizes dirty host results', async () => {
  unregisterVisionHost()
  const when = new Date('2026-01-02T00:00:00.000Z')
  const stop = registerVisionHost({
    dispatch() {
      return {
        ok: true,
        action: 'status',
        error: undefined,
        errorCode: undefined,
        workspace: { a: undefined, n: Number.NaN, when },
        nested: { list: [1, undefined, 2] },
        signal: new AbortController().signal,
      }
    },
  })
  try {
    const tool = visionBenchTool('/tmp')
    const ran = await tool.execute(
      { action: 'status' },
      { agent: { session: { header: { cwd: '/tmp/proj', id: 's1' } } } },
    )
    assertLossless(ran, 'agent execute dirty host')
    assert.equal(ran.ok, true)
    assert.equal('error' in ran, false)
    assert.equal('errorCode' in ran, false)
    assert.equal('signal' in ran, false)
    assert.equal('workspace' in ran, false)
    assert.deepEqual(ran.nested.list, [1, null, 2])
  } finally {
    stop()
    unregisterVisionHost()
  }
})

test('in-process Agent tool execute rejects circular host results', async () => {
  unregisterVisionHost()
  const cycle = { ok: true, action: 'status' }
  cycle.self = cycle
  const stop = registerVisionHost({ dispatch: () => cycle })
  try {
    const tool = visionBenchTool('/tmp')
    const ran = await tool.execute(
      { action: 'status' },
      { agent: { session: { header: { cwd: '/tmp/proj', id: 's1' } } } },
    )
    assertLossless(ran, 'agent execute circular')
    assert.equal(ran.ok, false)
    assert.equal(ran.errorCode, 'HOST_INVALID_RESPONSE')
  } finally {
    stop()
    unregisterVisionHost()
  }
})

test('Agent tool with real in-process dispatcher matches HTTP lossless ping', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-json-host-'))
  const cwd = join(home, 'board')
  mkdirSync(cwd, { recursive: true })
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [{ id: 'c1', name: 'C1', conn: { mode: 'tcp', sim: true } }],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points: [],
    },
  })
  unregisterVisionHost()
  const stop = registerVisionHost(createVisionCommandDispatcher(home))
  try {
    const tool = visionBenchTool(home)
    const agentPing = await tool.execute(
      { action: 'system.ping' },
      { agent: { session: { header: { cwd, id: 's1' } } } },
    )
    assert.equal(agentPing.ok, true, agentPing.error)
    assertLossless(agentPing, 'agent in-process ping')
    assert.equal(agentPing.data.service, 'dsh-vision-bench')
    assert.equal(typeof agentPing.data.pid, 'number')

    const httpPing = await handleCommand(home, { method: 'POST', headers: {} }, async () => ({
      action: 'system.ping',
      cwd,
      sessionId: 's1',
      source: 'agent',
    }))
    assert.equal(httpPing.ok, true)
    assertLossless(httpPing, 'http ping')
    assert.equal(httpPing.data.service, agentPing.data.service)
    assert.equal(httpPing.data.pid, agentPing.data.pid)

    const status = await tool.execute({ action: 'status' }, { agent: { session: { header: { cwd, id: 's1' } } } })
    assert.equal(status.ok, true, status.error)
    assertLossless(status, 'agent in-process status')
  } finally {
    stop()
    unregisterVisionHost()
    await rm(home, { recursive: true, force: true })
  }
})

test('Agent points add batch is one version bump and omits workspace dump', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-json-batch-'))
  const cwd = join(home, 'board')
  mkdirSync(cwd, { recursive: true })
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [{ id: 'c1', name: 'C1', conn: { mode: 'tcp', sim: true } }],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points: [],
    },
  })
  unregisterVisionHost()
  const stop = registerVisionHost(createVisionCommandDispatcher(home))
  try {
    const tool = visionBenchTool(home)
    const before = await tool.execute({ action: 'status' }, { agent: { session: { header: { cwd, id: 's1' } } } })
    const cv = before.modbus.configVersion
    const ran = await tool.execute(
      {
        action: 'points',
        op: 'add',
        expectedConfigVersion: cv,
        connectionId: 'c1',
        deviceId: 'd1',
        points: [
          { name: '回风温度1', function: 3, address: 0, monitorEnabled: true },
          { name: '回风温度2', function: 3, address: 1, monitorEnabled: true },
        ],
      },
      { agent: { session: { header: { cwd, id: 's1' } } } },
    )
    assert.equal(ran.ok, true, ran.error)
    assert.equal(ran.changedPointIds.length, 2)
    assert.equal(ran.nextConfigVersion, cv + 1)
    assert.equal('workspace' in ran, false, 'agent result must not dump workspace/log')
    assertLossless(ran, 'batch add')
    const listed = await tool.execute(
      { action: 'points', op: 'list' },
      { agent: { session: { header: { cwd, id: 's1' } } } },
    )
    assert.equal(listed.points.length, 2)
  } finally {
    stop()
    unregisterVisionHost()
    await rm(home, { recursive: true, force: true })
  }
})

test('dispatchVisionCommand HTTP error objects are lossless JSON', async () => {
  unregisterVisionHost()
  const prev = process.env.VISION_BENCH_HOST_ORIGIN
  process.env.VISION_BENCH_HOST_ORIGIN = 'http://127.0.0.1:1'
  try {
    const ran = await dispatchVisionCommand({
      requireHost: true,
      commandId: 'c-down',
      action: 'status',
      cwd: '/tmp/x',
      payload: { action: 'status' },
    })
    assert.equal(ran.ok, false)
    assertLossless(ran, 'HOST_UNAVAILABLE')
    assert.equal(ran.errorCode, 'HOST_UNAVAILABLE')
  } finally {
    if (prev == null) delete process.env.VISION_BENCH_HOST_ORIGIN
    else process.env.VISION_BENCH_HOST_ORIGIN = prev
  }
})

test('pingVisionHost failure omits undefined optional fields', async () => {
  unregisterVisionHost()
  const prev = process.env.VISION_BENCH_HOST_ORIGIN
  process.env.VISION_BENCH_HOST_ORIGIN = 'http://127.0.0.1:1'
  try {
    const ping = await pingVisionHost({ timeoutMs: 200 })
    assert.equal(ping.ok, false)
    assertLossless(ping, 'pingVisionHost down')
    assert.equal(ping.errorCode, 'HOST_UNAVAILABLE')
    assert.equal('httpStatus' in ping, false)
  } finally {
    if (prev == null) delete process.env.VISION_BENCH_HOST_ORIGIN
    else process.env.VISION_BENCH_HOST_ORIGIN = prev
    unregisterVisionHost()
  }
})
