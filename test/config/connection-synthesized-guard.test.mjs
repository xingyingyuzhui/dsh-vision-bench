// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { applyConnection } from '../../src/application/config/config-connection-mutations.mjs'
import {
  SYNTHESIZED_CONNECTION_FLAG,
  isSynthesizedConnection,
  normalizeConnection,
  normalizeConnections,
} from '../../src/domain/modbus/connection-model.mjs'

const noStates = async () => ({ connectionStates: [] })
const emptyPack = () => ({ connections: [], devices: [], points: [] })

test('D1: normalizeConnections 只给合成的默认连接打标记', () => {
  const synthesized = normalizeConnections([])
  assert.equal(synthesized.length, 1)
  assert.equal(synthesized[0].id, 'c1')
  assert.equal(isSynthesizedConnection(synthesized[0]), true)

  const real = normalizeConnections([{ id: 'c1', name: '真实连接' }])
  assert.equal(real.length, 1)
  assert.equal(isSynthesizedConnection(real[0]), false)

  const nonArray = normalizeConnections(null)
  assert.equal(isSynthesizedConnection(nonArray[0]), true)
})

test('D1: 标记在重复归一化下幂等（topologyFingerprint 会再归一化一次）', () => {
  const once = normalizeConnections([])[0]
  const twice = normalizeConnection(once)
  assert.equal(isSynthesizedConnection(twice), true, '二次归一化不得丢失标记')
  assert.equal(once[SYNTHESIZED_CONNECTION_FLAG], true)
})

test('D1: remove 合成占位时给出可读错误，而非裸「连接不存在」', async () => {
  const res = await applyConnection('/home', '/ws', { modbus: emptyPack() }, 'remove', { connectionId: 'c1' }, {}, noStates)
  assert.equal(res.ok, false)
  assert.equal(res.errorCode, 'CONNECTION_NOT_FOUND')
  assert.match(res.error, /默认占位/)
  assert.ok(!/^连接不存在: c1$/.test(res.error), '不应是容易让人以为是 bug 的裸错误')
})

test('D1: update 合成占位时同样给出可读错误', async () => {
  const res = await applyConnection(
    '/home',
    '/ws',
    { modbus: emptyPack() },
    'update',
    { connectionId: 'c1' },
    { name: '改名' },
    noStates,
  )
  assert.equal(res.ok, false)
  assert.equal(res.errorCode, 'CONNECTION_NOT_FOUND')
  assert.match(res.error, /默认占位/)
})

test('D1: 真正不存在的 id 仍是原样的「连接不存在」', async () => {
  const pack = { connections: [{ id: 'c9', name: '真实' }], devices: [], points: [] }
  const res = await applyConnection('/home', '/ws', { modbus: pack }, 'remove', { connectionId: 'zzz' }, {}, noStates)
  assert.equal(res.ok, false)
  assert.equal(res.errorCode, 'CONNECTION_NOT_FOUND')
  assert.match(res.error, /^连接不存在: zzz$/)
})

test('D1: 已归一化的 pack 里带标记的占位同样被拦下', async () => {
  const pack = { connections: normalizeConnections([]), devices: [], points: [] }
  const res = await applyConnection('/home', '/ws', { modbus: pack }, 'remove', { connectionId: 'c1' }, {}, noStates)
  assert.equal(res.ok, false)
  assert.match(res.error, /默认占位/)
})

test('D1: 删除真实连接不受影响', async () => {
  const pack = { connections: [{ id: 'c2', name: '真实', role: 'client', enabled: true, conn: {} }], devices: [], points: [] }
  const res = await applyConnection('/home', '/ws', { modbus: pack }, 'remove', { connectionId: 'c2' }, {}, noStates)
  assert.equal(res.ok, true)
  assert.deepEqual(pack.connections, [])
})
