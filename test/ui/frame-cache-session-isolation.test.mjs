// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { clearAllFramesLogs, clearFramesLog, getFramesLog, pushFramesLog } from '../../src/ui/common/frame-cache.mjs'

test('frame-cache isolates frames per sessionId for the same cwd', () => {
  clearAllFramesLogs()
  const cwd = '/workspace/test-device'

  // Push frames to Session A and Session B on the same cwd
  pushFramesLog({ cwd, sessionId: 'session-A' }, 'conn-1', [{ frameId: 'frame-A1', label: 'Read Holding Registers' }])

  pushFramesLog({ cwd, sessionId: 'session-B' }, 'conn-1', [{ frameId: 'frame-B1', label: 'Write Coil' }])

  // Query Session A
  const framesA = getFramesLog({ cwd, sessionId: 'session-A' }, 'conn-1')
  assert.equal(framesA.length, 1)
  assert.equal(framesA[0].frameId, 'frame-A1')

  // Query Session B
  const framesB = getFramesLog({ cwd, sessionId: 'session-B' }, 'conn-1')
  assert.equal(framesB.length, 1)
  assert.equal(framesB[0].frameId, 'frame-B1')

  // Cross-session frames are not visible
  assert.equal(
    framesA.some((f) => f.frameId === 'frame-B1'),
    false,
  )
  assert.equal(
    framesB.some((f) => f.frameId === 'frame-A1'),
    false,
  )
})

test('frame-cache shares frames across sessions when isShared is true', () => {
  clearAllFramesLogs()
  const cwd = '/workspace/shared-device'

  // Push frame into shared scope
  pushFramesLog({ cwd, sessionId: 'session-A', isShared: true }, 'conn-1', [
    { frameId: 'frame-shared-1', label: 'Shared Query' },
  ])

  // Read back via session-A with isShared: true
  const framesA = getFramesLog({ cwd, sessionId: 'session-A', isShared: true }, 'conn-1')
  assert.equal(framesA.length, 1)
  assert.equal(framesA[0].frameId, 'frame-shared-1')

  // Read back via session-B with isShared: true
  const framesB = getFramesLog({ cwd, sessionId: 'session-B', isShared: true }, 'conn-1')
  assert.equal(framesB.length, 1)
  assert.equal(framesB[0].frameId, 'frame-shared-1')

  // Session-private query on session-A must NOT see the shared frame
  const framesAPrivate = getFramesLog({ cwd, sessionId: 'session-A', isShared: false }, 'conn-1')
  assert.equal(framesAPrivate.length, 0)
})

test('clearFramesLog on session-A does not touch session-B or shared frames', () => {
  clearAllFramesLogs()
  const cwd = '/workspace/clear-test'

  pushFramesLog({ cwd, sessionId: 'session-A' }, 'conn-1', [{ frameId: 'f-A' }])
  pushFramesLog({ cwd, sessionId: 'session-B' }, 'conn-1', [{ frameId: 'f-B' }])
  pushFramesLog({ cwd, isShared: true }, 'conn-1', [{ frameId: 'f-shared' }])

  // Clear session A
  clearFramesLog({ cwd, sessionId: 'session-A' })

  assert.equal(getFramesLog({ cwd, sessionId: 'session-A' }, 'conn-1').length, 0)
  assert.equal(getFramesLog({ cwd, sessionId: 'session-B' }, 'conn-1').length, 1)
  assert.equal(getFramesLog({ cwd, sessionId: 'session-B' }, 'conn-1')[0].frameId, 'f-B')
  assert.equal(getFramesLog({ cwd, isShared: true }, 'conn-1').length, 1)
  assert.equal(getFramesLog({ cwd, isShared: true }, 'conn-1')[0].frameId, 'f-shared')
})
