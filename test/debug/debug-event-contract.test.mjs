// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { BACKEND_EVENT_TYPES, createBackendEvent } from '../../src/domain/debug/backend-event.mjs'
import { DEBUG_EVENT_TYPES } from '../../src/shared/debug-events.mjs'

test('debug event types contract conforms to schema', () => {
  assert.equal(DEBUG_EVENT_TYPES.RUNNING, 'debug.running')
  assert.equal(DEBUG_EVENT_TYPES.TARGET_RUNNING, 'debug.running')
  assert.equal(DEBUG_EVENT_TYPES.PAUSED, 'debug.paused')
  assert.equal(DEBUG_EVENT_TYPES.TARGET_PAUSED, 'debug.paused')
  assert.equal(DEBUG_EVENT_TYPES.STEP_COMPLETE, 'debug.step.complete')
  assert.equal(DEBUG_EVENT_TYPES.BREAKPOINT_HIT, 'debug.breakpoint.hit')
  assert.equal(DEBUG_EVENT_TYPES.WATCHPOINT_HIT, 'debug.watchpoint.hit')
  assert.equal(DEBUG_EVENT_TYPES.CONSOLE, 'debug.console')
  assert.equal(DEBUG_EVENT_TYPES.CONSOLE_OUTPUT, 'debug.console')
  assert.equal(DEBUG_EVENT_TYPES.SESSION_STOPPED, 'debug.session.stopped')
  assert.equal(DEBUG_EVENT_TYPES.SESSION_FAILED, 'debug.session.failed')
})

test('backend event types and factory function', () => {
  assert.equal(BACKEND_EVENT_TYPES.RUNNING, 'backend.running')
  assert.equal(BACKEND_EVENT_TYPES.STOPPED, 'backend.stopped')
  assert.equal(BACKEND_EVENT_TYPES.CONSOLE, 'backend.console')
  assert.equal(BACKEND_EVENT_TYPES.EXITED, 'backend.exited')
  assert.equal(BACKEND_EVENT_TYPES.ERROR, 'backend.error')

  const stoppedEv = createBackendEvent('backend.stopped', {
    reason: 'breakpoint',
    breakpointNumber: '1',
  })
  assert.equal(stoppedEv.type, 'backend.stopped')
  assert.equal(stoppedEv.reason, 'breakpoint')
  assert.equal(stoppedEv.breakpointNumber, '1')

  assert.throws(() => {
    // @ts-ignore
    createBackendEvent('invalid.type')
  })
})
