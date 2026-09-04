import assert from 'node:assert/strict'
import test from 'node:test'
import { VALID_TRANSITIONS, canTransition, transition } from '../../src/domain/debug/debug-state.mjs'
import { DEBUG_ERRORS, DebugError } from '../../src/domain/debug/errors.mjs'

test('canTransition validates legal and illegal transitions', () => {
  // Legal
  assert.equal(canTransition('idle', 'starting'), true)
  assert.equal(canTransition('starting', 'ready'), true)
  assert.equal(canTransition('starting', 'failed'), true)
  assert.equal(canTransition('ready', 'running'), true)
  assert.equal(canTransition('ready', 'paused'), true)
  assert.equal(canTransition('running', 'paused'), true)
  assert.equal(canTransition('paused', 'running'), true)
  assert.equal(canTransition('running', 'stopping'), true)
  assert.equal(canTransition('stopping', 'idle'), true)
  assert.equal(canTransition('failed', 'idle'), true)

  // Illegal
  assert.equal(canTransition('idle', 'running'), false)
  assert.equal(canTransition('idle', 'paused'), false)
  assert.equal(canTransition('running', 'starting'), false)
  assert.equal(canTransition('stopping', 'running'), false)
})

test('transition returns nextState on valid transition', () => {
  assert.equal(transition('idle', 'starting'), 'starting')
  assert.equal(transition('starting', 'ready'), 'ready')
  assert.equal(transition('ready', 'running'), 'running')
  assert.equal(transition('running', 'paused'), 'paused')
})

test('transition throws DebugError with DEBUG_INVALID_TRANSITION on illegal transition', () => {
  assert.throws(
    () => transition('idle', 'running'),
    (err) => {
      assert.ok(err instanceof DebugError)
      assert.equal(err.code, DEBUG_ERRORS.INVALID_TRANSITION)
      assert.equal(err.details.from, 'idle')
      assert.equal(err.details.to, 'running')
      return true
    },
  )
})
