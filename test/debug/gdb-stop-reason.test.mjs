import assert from 'node:assert/strict'
import test from 'node:test'
import { MIRecord } from '../../src/infrastructure/debug/gdb-mi/mi-record.mjs'
import { mapGdbStopReason } from '../../src/infrastructure/debug/gdb-mi/stop-reason.mjs'

test('mapGdbStopReason handles null/undefined safely', () => {
  assert.equal(mapGdbStopReason(null), 'unknown')
  assert.equal(mapGdbStopReason(undefined), 'unknown')
})

test('mapGdbStopReason maps breakpoint stops', () => {
  const rec = new MIRecord({
    kind: 'exec-async',
    class: 'stopped',
    results: { reason: 'breakpoint-hit', bkptno: '1' },
  })
  assert.equal(mapGdbStopReason(rec), 'breakpoint')

  const locReached = new MIRecord({
    kind: 'exec-async',
    class: 'stopped',
    results: { reason: 'location-reached' },
  })
  assert.equal(mapGdbStopReason(locReached), 'breakpoint')
})

test('mapGdbStopReason maps watchpoint triggers', () => {
  const rec = new MIRecord({
    kind: 'exec-async',
    class: 'stopped',
    results: { reason: 'watchpoint-trigger', wpt: { number: '1' } },
  })
  assert.equal(mapGdbStopReason(rec), 'watchpoint')

  const readWp = new MIRecord({
    kind: 'exec-async',
    class: 'stopped',
    results: { reason: 'read-watchpoint-trigger' },
  })
  assert.equal(mapGdbStopReason(readWp), 'watchpoint')
})

test('mapGdbStopReason maps stepping completion', () => {
  const stepRec = new MIRecord({
    kind: 'exec-async',
    class: 'stopped',
    results: { reason: 'end-stepping-range' },
  })
  assert.equal(mapGdbStopReason(stepRec), 'step')

  const finishRec = new MIRecord({
    kind: 'exec-async',
    class: 'stopped',
    results: { reason: 'function-finished' },
  })
  assert.equal(mapGdbStopReason(finishRec), 'step')
})

test('mapGdbStopReason maps signals correctly', () => {
  const sigInt = new MIRecord({
    kind: 'exec-async',
    class: 'stopped',
    results: { reason: 'signal-received', 'signal-name': 'SIGINT' },
  })
  assert.equal(mapGdbStopReason(sigInt), 'pause')

  const sigTrap = new MIRecord({
    kind: 'exec-async',
    class: 'stopped',
    results: { reason: 'signal-received', 'signal-name': 'SIGTRAP' },
  })
  assert.equal(mapGdbStopReason(sigTrap), 'breakpoint')

  const sigSegv = new MIRecord({
    kind: 'exec-async',
    class: 'stopped',
    results: { reason: 'signal-received', 'signal-name': 'SIGSEGV' },
  })
  assert.equal(mapGdbStopReason(sigSegv), 'exception')

  const sigTerm = new MIRecord({
    kind: 'exec-async',
    class: 'stopped',
    results: { reason: 'signal-received', 'signal-name': 'SIGTERM' },
  })
  assert.equal(mapGdbStopReason(sigTerm), 'signal')
})

test('mapGdbStopReason maps exit reasons', () => {
  const exitRec = new MIRecord({
    kind: 'exec-async',
    class: 'stopped',
    results: { reason: 'exited-normally' },
  })
  assert.equal(mapGdbStopReason(exitRec), 'exit')

  const exitClass = new MIRecord({
    kind: 'result',
    class: 'exit',
  })
  assert.equal(mapGdbStopReason(exitClass), 'exit')
})

test('mapGdbStopReason falls back to pause on empty reason in stopped', () => {
  const noReason = new MIRecord({
    kind: 'exec-async',
    class: 'stopped',
    results: {},
  })
  assert.equal(mapGdbStopReason(noReason), 'pause')
})
