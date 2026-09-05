// @ts-check

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import {
  PacketAccumulator,
  UVSOCK_HEADER_SIZE,
  UV_OPERATION,
  decodeAsyncMessage,
  decodeCommandResponse,
  decodePacketHeader,
  decodePackets,
  encodePacket,
} from '../../src/infrastructure/debug/keil/uvsock/index.mjs'

const FIXTURES_DIR = resolve('test/fixtures/uvsock')

test('uvsock-packet-codec: verifies against golden gen-get-version-request.bin', () => {
  const fixture = readFileSync(resolve(FIXTURES_DIR, 'gen-get-version-request.bin'))
  assert.equal(fixture.length, 32)

  const header = decodePacketHeader(fixture)
  assert.equal(header.totalLen, 32)
  assert.equal(header.cmd, UV_OPERATION.UV_GEN_GET_VERSION)
  assert.equal(header.bufLen, 0)
  assert.equal(header.cycles, 0n)
  assert.equal(header.tStamp, 0.0)

  // Encode matching packet and verify byte-for-byte identity
  const encoded = encodePacket({ cmd: UV_OPERATION.UV_GEN_GET_VERSION })
  assert.deepEqual(encoded, fixture)
})

test('uvsock-packet-codec: verifies against golden cmd-response-version.bin', () => {
  const fixture = readFileSync(resolve(FIXTURES_DIR, 'cmd-response-version.bin'))
  assert.equal(fixture.length, 44)

  const { packets, rest } = decodePackets(fixture)
  assert.equal(packets.length, 1)
  assert.equal(rest.length, 0)

  const p = packets[0]
  assert.equal(p.header.totalLen, 44)
  assert.equal(p.header.cmd, UV_OPERATION.UV_CMD_RESPONSE)
  assert.equal(p.header.bufLen, 12)

  const cmdResp = decodeCommandResponse(p.payload)
  assert.equal(cmdResp.cmd, UV_OPERATION.UV_GEN_GET_VERSION)
  assert.equal(cmdResp.status, 0)
  assert.equal(cmdResp.ok, true)
  assert.equal(cmdResp.value, 0x020c)
})

test('uvsock-packet-codec: verifies against golden dbg-status-response.bin', () => {
  const fixture = readFileSync(resolve(FIXTURES_DIR, 'dbg-status-response.bin'))
  assert.equal(fixture.length, 44)

  const { packets } = decodePackets(fixture)
  assert.equal(packets.length, 1)

  const cmdResp = decodeCommandResponse(packets[0].payload)
  assert.equal(cmdResp.cmd, UV_OPERATION.UV_DBG_STATUS)
  assert.equal(cmdResp.status, 0)
  assert.equal(cmdResp.ok, true)
  assert.equal(cmdResp.value, 1) // Executing
})

test('uvsock-packet-codec: verifies against golden async-message.bin', () => {
  const fixture = readFileSync(resolve(FIXTURES_DIR, 'async-message.bin'))
  const { packets } = decodePackets(fixture)
  assert.equal(packets.length, 1)

  const asyncMsg = decodeAsyncMessage(packets[0])
  assert.equal(asyncMsg.type, 'async_response')
  assert.equal(asyncMsg.cmd, UV_OPERATION.UV_DBG_STOP_EXECUTION)
  assert.equal(asyncMsg.status, 12) // UV_STATUS_TARGET_STOPPED
  assert.ok(asyncMsg.details?.error?.message.includes('breakpoint hit'))
})

test('uvsock-packet-codec: handles chunk splitting and streaming reassembly', () => {
  const fixture = readFileSync(resolve(FIXTURES_DIR, 'cmd-response-version.bin'))
  const acc = new PacketAccumulator()

  // Feed byte by byte
  const packets = []
  for (let i = 0; i < fixture.length; i++) {
    const chunk = fixture.subarray(i, i + 1)
    const res = acc.feed(chunk)
    if (res.length > 0) {
      packets.push(...res)
    }
  }

  assert.equal(packets.length, 1)
  assert.equal(packets[0].header.cmd, UV_OPERATION.UV_CMD_RESPONSE)
  assert.equal(decodeCommandResponse(packets[0].payload).value, 0x020c)
})
