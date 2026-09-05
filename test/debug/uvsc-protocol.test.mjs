// @ts-check

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { UV4DebugProcess } from '../../src/infrastructure/debug/keil/uv4-debug-process.mjs'
import { KeilUvscClient } from '../../src/infrastructure/debug/keil/uvsc-client.mjs'
import {
  UVSC_HEADER_SIZE,
  UVSC_MAGIC,
  UVSC_OPCODES,
  UVSC_STATUS,
  decodeFrames,
  encodeFrame,
} from '../../src/infrastructure/debug/keil/uvsc-framing.mjs'

test('uvsc framing: encodes and decodes 16-byte binary header with payload', () => {
  const payload = { file: 'main.c', line: 42 }
  const encoded = encodeFrame({
    msgId: 105,
    opcode: UVSC_OPCODES.UV_DBG_ENTER,
    status: UVSC_STATUS.OK,
    payload,
  })

  assert.ok(encoded.length >= UVSC_HEADER_SIZE)
  assert.equal(encoded.readUInt32LE(0), UVSC_MAGIC)
  assert.equal(encoded.readUInt32LE(8), 105)
  assert.equal(encoded.readUInt16LE(12), UVSC_OPCODES.UV_DBG_ENTER)
  assert.equal(encoded.readUInt16LE(14), UVSC_STATUS.OK)

  const { frames, rest } = decodeFrames(encoded)
  assert.equal(frames.length, 1)
  assert.equal(rest.length, 0)

  const f = frames[0]
  assert.equal(f.msgId, 105)
  assert.equal(f.opcode, UVSC_OPCODES.UV_DBG_ENTER)
  assert.equal(f.status, UVSC_STATUS.OK)
  assert.deepEqual(JSON.parse(f.payload.toString('utf8')), payload)
})

test('uvsc framing: handles chunked streams and resynchronization', () => {
  const frame1 = encodeFrame({
    msgId: 1,
    opcode: UVSC_OPCODES.UV_DBG_STATUS,
    payload: 'status_ok',
  })
  const frame2 = encodeFrame({
    msgId: 2,
    opcode: UVSC_OPCODES.UV_DBG_STOP_EXECUTION,
    payload: 'stopped',
  })

  const full = Buffer.concat([frame1, frame2])
  // Split into 3 arbitrary chunks
  const c1 = full.subarray(0, 10)
  const c2 = full.subarray(10, 25)
  const c3 = full.subarray(25)

  const r1 = decodeFrames(c1)
  assert.equal(r1.frames.length, 0)

  const r2 = decodeFrames(Buffer.concat([r1.rest, c2]))
  assert.equal(r2.frames.length, 1)
  assert.equal(r2.frames[0].msgId, 1)

  const r3 = decodeFrames(Buffer.concat([r2.rest, c3]))
  assert.equal(r3.frames.length, 1)
  assert.equal(r3.frames[0].msgId, 2)
  assert.equal(r3.rest.length, 0)
})

test('uvsc client: sendRequest resolves with response and handles async events', async () => {
  const client = new KeilUvscClient({ timeoutMs: 1000 })
  const mockSocket = new EventEmitter()

  // @ts-ignore
  mockSocket.write = (chunk) => {
    const { frames } = decodeFrames(chunk)
    for (const f of frames) {
      // Echo response
      const resp = encodeFrame({
        msgId: f.msgId,
        opcode: f.opcode,
        status: UVSC_STATUS.OK,
        payload: { echoOpcode: f.opcode, received: true },
      })
      setImmediate(() => mockSocket.emit('data', resp))
    }
    return true
  }
  // @ts-ignore
  mockSocket.destroy = () => {}

  client.connected = true
  client.socket = /** @type {any} */ (mockSocket)
  mockSocket.on('data', (d) => client._onData(d))

  // 1. Request-response
  const res = await client.sendRequest(UVSC_OPCODES.UV_GEN_GET_VERSION, { client: 'bench' })
  assert.equal(res.status, UVSC_STATUS.OK)
  assert.equal(res.echoOpcode, UVSC_OPCODES.UV_GEN_GET_VERSION)
  assert.equal(res.received, true)

  // 2. Async unsolicited event (msgId = 0)
  /** @type {any[]} */
  const events = []
  client.on('event', (e) => events.push(e))

  const asyncFrame = encodeFrame({
    msgId: 0,
    opcode: UVSC_OPCODES.UV_DBG_CALLBACK,
    status: UVSC_STATUS.OK,
    payload: { event: 'stop', reason: 'breakpoint-hit', line: 42 },
  })
  mockSocket.emit('data', asyncFrame)

  assert.equal(events.length, 1)
  assert.equal(events[0].opcode, UVSC_OPCODES.UV_DBG_CALLBACK)
  assert.equal(events[0].payload.reason, 'breakpoint-hit')

  client.disconnect()
})

test('uv4 debug process: manages port allocation and process termination', async () => {
  const mockChild = new EventEmitter()
  // @ts-ignore
  mockChild.kill = () => {
    setImmediate(() => mockChild.emit('exit', 0))
  }

  const uv4 = new UV4DebugProcess({
    uv4Bin: 'UV4.exe',
    spawner: () => /** @type {any} */ (mockChild),
    portAllocator: async () => 7890,
    portChecker: async () => false, // port is immediately ready (server bound)
  })

  const launched = await uv4.launch({
    projectPath: 'C:projectapp.uvprojx',
    target: 'STM32',
  })

  assert.equal(launched.port, 7890)
  assert.equal(uv4.running, true)

  await uv4.stop()
  assert.equal(uv4.running, false)
})
