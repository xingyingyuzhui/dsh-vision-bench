// @ts-check

import assert from 'node:assert/strict'
import test from 'node:test'
import { isMajorKind, isTaskType, taskTypeLabel, trimTimeline } from '../../bench-journal.mjs'
import { normalizeFocusRequest, normalizeFocusState } from '../../bench-store.mjs'
import { executeDebugCommand } from '../../src/application/debug/debug-command-service.mjs'
import { createDebugRuntime, setSharedDebugRuntime } from '../../src/application/debug/debug-runtime.mjs'
import { buildEvidenceRefs } from '../../src/application/modbus/evidence-service.mjs'
import { evidenceFromRef } from '../../src/ui/common/agent-reference.mjs'

test('debug-journal: task types and major kinds include debug lifecycle events', () => {
  assert.equal(taskTypeLabel('debug'), '调试')
  assert.equal(isTaskType('debug'), true)

  const majorKinds = [
    'debug-start',
    'debug-stop',
    'breakpoint-hit',
    'watchpoint-hit',
    'debug-exception',
    'snapshot-created',
    'verify-pass',
    'verify-fail',
  ]
  for (const k of majorKinds) {
    assert.equal(isMajorKind(k), true, `kind ${k} must be recognized as a major kind`)
  }

  // Verify trimming rescues major debug events
  const timeline = [
    { kind: 'read-point', at: 1000 },
    { kind: 'read-point', at: 1001 },
    { kind: 'snapshot-created', id: 'snap-1', at: 1002 },
    { kind: 'breakpoint-hit', id: 'bp-1', at: 1003 },
  ]
  const trimmed = trimTimeline(timeline, 2)
  assert.equal(trimmed.length, 4) // 2 latest + 2 rescued major events older than window
  assert.ok(trimmed.some((e) => e.kind === 'snapshot-created'))
  assert.ok(trimmed.some((e) => e.kind === 'breakpoint-hit'))
})

test('debug-evidence: normalizeFocusRequest and normalizeFocusState handle debug_snapshot', () => {
  // Focus request with debug identifiers
  const req = normalizeFocusRequest({
    kind: 'runtime',
    debugSessionId: 'ds-123',
    snapshotId: 'snap-456',
  })
  assert.ok(req)
  assert.equal(req.debugSessionId, 'ds-123')
  assert.equal(req.snapshotId, 'snap-456')

  // Focus state evidence normalization
  const state = normalizeFocusState({
    sessionId: 'sess-1',
    evidence: [
      {
        kind: 'debug_snapshot',
        id: 'snap-456',
        snapshotId: 'snap-456',
        debugSessionId: 'ds-123',
        reason: 'HardFault exception',
        file: 'main.c',
        line: 88,
        firmwareHash: 'deadbeef123',
      },
    ],
  })

  assert.equal(state.evidence.length, 1)
  const ev = state.evidence[0]
  assert.equal(ev.kind, 'debug_snapshot')
  assert.equal(ev.snapshotId, 'snap-456')
  assert.equal(ev.debugSessionId, 'ds-123')
  assert.equal(ev.reason, 'HardFault exception')
  assert.equal(ev.file, 'main.c')
  assert.equal(ev.line, 88)
  assert.equal(ev.firmwareHash, 'deadbeef123')
})

test('debug-evidence: evidenceFromRef correctly formats debug_snapshot shape', () => {
  const ref = {
    kind: 'debug_snapshot',
    snapshotId: 'snap-999',
    debugSessionId: 'ds-888',
    reason: 'watchpoint hit',
    file: 'sensor.c',
    line: 120,
    firmwareHash: 'abc0123456789',
    configVersion: 3,
  }
  const formatted = evidenceFromRef(ref)
  assert.equal(formatted.kind, 'debug_snapshot')
  assert.equal(formatted.id, 'snap-999')
  assert.equal(formatted.snapshotId, 'snap-999')
  assert.equal(formatted.debugSessionId, 'ds-888')
  assert.equal(formatted.reason, 'watchpoint hit')
  assert.equal(formatted.file, 'sensor.c')
  assert.equal(formatted.line, 120)
  assert.equal(formatted.firmwareHash, 'abc0123456789')
  assert.equal(formatted.version, 3)
})

test('debug-runtime: snapshot capture, get by id, and journal notifications', async () => {
  const journalEvents = []
  const runtime = createDebugRuntime({
    backendFactory: async () => ({
      start: async () => {},
      stop: async () => {},
      stack: async () => [
        { level: 0, function: 'HardFault_Handler', file: 'stm32f4xx_it.c', line: 45 },
        { level: 1, function: 'process_sensor', file: 'sensor.c', line: 110 },
      ],
      locals: async () => [
        { name: 'val', value: '42' },
        { name: 'ptr', value: '0x00000000' },
      ],
      registers: async () => [{ name: 'pc', value: '0x08000120' }],
    }),
    onJournalEvent: async (ev) => {
      journalEvents.push(ev)
    },
  })

  // Start session
  const session = await runtime.start({
    ownerSessionId: 'owner-1',
    workspaceCwd: '/test/cwd',
    targetSpec: { target: 'stm32f4', artifactSha256: 'firmwarehash123' },
  })

  assert.equal(journalEvents.length, 1)
  assert.equal(journalEvents[0].action, 'debug-start')

  // Create snapshot
  const snapRes = await runtime.command(
    { debugSessionId: session.debugSessionId, ownerSessionId: 'owner-1' },
    { type: 'snapshot', reason: 'null pointer dereference', watches: ['g_state'] },
  )

  assert.equal(snapRes.ok, true)
  assert.ok(snapRes.snapshot.id.startsWith('snap_'))
  assert.equal(snapRes.snapshot.reason, 'null pointer dereference')
  assert.equal(snapRes.snapshot.firmwareHash, 'firmwarehash123')
  assert.equal(snapRes.snapshot.watches[0], 'g_state')

  // Journal event recorded
  assert.equal(journalEvents.length, 2)
  assert.equal(journalEvents[1].action, 'snapshot-created')
  assert.equal(journalEvents[1].snapshotId, snapRes.snapshot.id)

  // Retrieve snapshot by id (full object)
  const getRes = await runtime.command(
    { debugSessionId: session.debugSessionId, ownerSessionId: 'owner-1' },
    { type: 'snapshot', op: 'get', snapshotId: snapRes.snapshot.id },
  )
  assert.equal(getRes.ok, true)
  assert.equal(getRes.snapshot.id, snapRes.snapshot.id)
  assert.equal(getRes.snapshot.reason, 'null pointer dereference')

  // Stop session
  await runtime.stop({ debugSessionId: session.debugSessionId, ownerSessionId: 'owner-1' })
  assert.equal(journalEvents.length, 3)
  assert.equal(journalEvents[2].action, 'debug-stop')
})

test('debug-command-service: returns compact summary for inspect and snapshot to agent', async () => {
  const runtime = createDebugRuntime({
    backendFactory: async () => ({
      start: async () => {},
      stop: async () => {},
      stack: async () => [
        { level: 0, function: 'foo', file: 'foo.c', line: 10 },
        { level: 1, function: 'bar', file: 'bar.c', line: 20 },
        { level: 2, function: 'baz', file: 'baz.c', line: 30 },
        { level: 3, function: 'main', file: 'main.c', line: 40 },
        { level: 4, function: 'init', file: 'init.c', line: 50 },
        { level: 5, function: 'startup', file: 'startup.s', line: 60 },
      ],
      locals: async () => [
        { name: 'a', value: '1' },
        { name: 'b', value: '2' },
      ],
    }),
  })

  // Start session
  const startCmd = {
    action: 'start',
    source: 'user',
    sessionId: 'agent-sess',
    cwd: '/test/cwd',
    payload: { targetSpec: { target: 'stm32', artifactSha256: 'hash456' } },
  }
  const startRes = await executeDebugCommand(startCmd, { debugRuntime: runtime })
  assert.equal(startRes.ok, true)
  const dsId = startRes.debugSessionId

  // Inspect: returns compact summary (capped stack top 5)
  const inspectCmd = {
    action: 'inspect',
    source: 'agent',
    sessionId: 'agent-sess',
    cwd: '/test/cwd',
    payload: { debugSessionId: dsId },
  }
  const inspectRes = await executeDebugCommand(inspectCmd, { debugRuntime: runtime })
  assert.equal(inspectRes.ok, true)
  assert.ok(Array.isArray(inspectRes.stackTop))
  assert.equal(inspectRes.stackTop.length, 5, 'stackTop should be capped at 5 for agent compact summary')
  assert.ok(Array.isArray(inspectRes.relevantVariables))

  // Snapshot create: returns compact summary
  const snapCmd = {
    action: 'snapshot',
    source: 'agent',
    sessionId: 'agent-sess',
    cwd: '/test/cwd',
    payload: { debugSessionId: dsId, reason: 'test crash' },
  }
  const snapRes = await executeDebugCommand(snapCmd, { debugRuntime: runtime })
  assert.equal(snapRes.ok, true)
  assert.ok(snapRes.snapshotId)
  assert.equal(snapRes.reason, 'test crash')
  assert.ok(Array.isArray(snapRes.stackTop))
  assert.equal(snapRes.stackTop.length, 5)

  // Snapshot get by ID: returns full snapshot
  const getSnapCmd = {
    action: 'snapshot',
    source: 'agent',
    sessionId: 'agent-sess',
    cwd: '/test/cwd',
    payload: { debugSessionId: dsId, op: 'get', snapshotId: snapRes.snapshotId },
  }
  const fullSnapRes = await executeDebugCommand(getSnapCmd, { debugRuntime: runtime })
  assert.equal(fullSnapRes.ok, true)
  assert.equal(fullSnapRes.snapshot.id, snapRes.snapshotId)
  assert.equal(fullSnapRes.snapshot.reason, 'test crash')
})
