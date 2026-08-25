// Task5/0.18.3: frame increment accounting across data streams — pure functions
// from bench-frames-model, no React needed.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  countAddedFrameIds,
  frameStreamKey,
  rawLineId,
} from '../bench-frames-model.mjs'

const ids = (n, start = 0) => Array.from({ length: n }, (_, i) => 'f' + (start + i))

test('identical frame set twice → 0 added (no phantom 460)', () => {
  const first = ids(500)
  // anchor is the FULL previous set (not a 40-slice)
  assert.equal(countAddedFrameIds(first, first), 0)
  assert.equal(countAddedFrameIds(new Set(first), first), 0)
})

test('ring shift f0..f499 → f1..f500 adds exactly 1', () => {
  assert.equal(countAddedFrameIds(ids(500), ids(500, 1)), 1)
})

test('ring shift replacing 5 frames adds exactly 5', () => {
  assert.equal(countAddedFrameIds(ids(500), ids(500, 5)), 5)
})

test('first-entry baseline semantics: same ids counted as 0 on next poll', () => {
  const first = ids(1000)
  // simulate "first observation establishes baseline": anchor=first
  const anchor = new Set(first)
  assert.equal(countAddedFrameIds(anchor, first), 0)
  const next = ids(1000, 1)
  assert.equal(countAddedFrameIds(anchor, next), 1)
})

test('streams are strictly separated per mode/selection', () => {
  assert.notEqual(frameStreamKey('proto', 'all'), frameStreamKey('proto', 'conn:c1'))
  assert.notEqual(frameStreamKey('proto', 'conn:c1'), frameStreamKey('proto', 'conn:c2'))
  assert.notEqual(frameStreamKey('raw', 'conn:c1'), frameStreamKey('proto', 'conn:c1'))
  assert.notEqual(frameStreamKey('raw', 'conn:c1'), frameStreamKey('raw', 'conn:c2'))
  assert.equal(frameStreamKey('raw', 'raw:COM7'), frameStreamKey('raw', 'all'))
  assert.equal(frameStreamKey('proto', 'conn:c1'), frameStreamKey('proto', 'conn:c1'))
  assert.equal(frameStreamKey('raw', 'all'), 'raw:all')
})

test('raw lines get stable ids independent of array index', () => {
  const l1 = { id: 12, epoch: 'e1', connectionId: 'c1', t: 1000, line: 'x' }
  const l2 = { id: 13, epoch: 'e1', connectionId: 'c1', t: 1001, line: 'y' }
  const a1 = rawLineId('COM3', l1, 0)
  const a2 = rawLineId('COM3', l2, 1)
  assert.equal(a1, 'c1:e1:12')
  assert.notEqual(a1, a2)
  assert.equal(rawLineId('COM3', { id: 12, epoch: 'e1', connectionId: 'c1' }, 0), rawLineId('COM3', { id: 12, epoch: 'e1', connectionId: 'c1' }, 9))
  assert.notEqual(rawLineId('COM4', { t: 1 }, 0), rawLineId('COM4', { t: 2 }, 0))
})