// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createPendingWrite,
  listPendingWrites,
  peekPendingWrite,
  restorePendingWrite,
} from '../../src/application/modbus/write-approval-service.mjs'

/** @param {string} tag */
const cwdOf = (tag) => `/tmp/dvb-approval-edges-${tag}-${process.pid}`

test('connId alias dedupes against connectionId for the same write', () => {
  const cwd = cwdOf('alias')
  const first = createPendingWrite(cwd, {
    sessionId: 's1',
    connectionId: 'c1',
    deviceId: 'd1',
    function: 6,
    address: 10,
    values: [5],
  })
  assert.ok('id' in first)
  const second = createPendingWrite(cwd, {
    sessionId: 's1',
    connId: 'c1',
    deviceId: 'd1',
    function: 6,
    address: 10,
    values: [5],
  })
  assert.ok('id' in second)
  assert.equal(second.id, first.id)
  assert.equal(second.deduped, true)
})

test('requests without a values array compare as empty and still dedupe', () => {
  const cwd = cwdOf('novalues')
  const params = { sessionId: 's1', connectionId: 'c1', deviceId: 'd1', function: 5, address: 1 }
  const first = createPendingWrite(cwd, params)
  const second = createPendingWrite(cwd, { ...params })
  assert.ok('id' in first && 'id' in second)
  assert.equal(second.id, first.id)
  assert.equal(listPendingWrites(cwd, 's1').length, 1)
})

test('restorePendingWrite ignores entries without an id or cwd', () => {
  const cwd = cwdOf('restore')
  restorePendingWrite(null)
  restorePendingWrite(undefined)
  restorePendingWrite(/** @type {any} */ ({ id: '', cwd, createdAt: Date.now(), params: { sessionId: 's1' } }))
  assert.deepEqual(listPendingWrites(cwd, 's1'), [])
})

test('peekPendingWrite with an empty id finds nothing', () => {
  assert.equal(peekPendingWrite(cwdOf('peek'), ''), null)
})
