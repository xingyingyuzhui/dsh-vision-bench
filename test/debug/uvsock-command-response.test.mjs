// @ts-check

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  UV_OPERATION,
  UV_STATUS,
  decodeCommandResponse,
  encodeAmem,
  encodeBkRsp,
  encodeCommandResponse,
  encodeSstr,
  encodeVset,
} from '../../src/infrastructure/debug/keil/uvsock/index.mjs'

test('uvsock-command-response: decodes error response', () => {
  const buf = encodeCommandResponse({
    cmd: UV_OPERATION.UV_DBG_ENTER,
    status: UV_STATUS.UV_STATUS_DEBUGGING,
    errorMessage: 'Already in debug mode',
  })

  const res = decodeCommandResponse(buf)
  assert.equal(res.ok, false)
  assert.equal(res.cmd, UV_OPERATION.UV_DBG_ENTER)
  assert.equal(res.status, UV_STATUS.UV_STATUS_DEBUGGING)
  assert.equal(res.error?.message, 'Already in debug mode')
})

test('uvsock-command-response: decodes SSTR response (target name)', () => {
  const sstr = encodeSstr('STM32F407_Flash')
  const buf = encodeCommandResponse({
    cmd: UV_OPERATION.UV_PRJ_GET_CUR_TARGET,
    status: UV_STATUS.UV_STATUS_SUCCESS,
    payloadBuffer: sstr,
  })

  const res = decodeCommandResponse(buf)
  assert.equal(res.ok, true)
  assert.equal(res.cmd, UV_OPERATION.UV_PRJ_GET_CUR_TARGET)
  assert.equal(res.string, 'STM32F407_Flash')
})

test('uvsock-command-response: decodes AMEM response (memory read)', () => {
  const memBuf = encodeAmem({
    address: 0x08000000n,
    bytes: Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]),
  })

  const buf = encodeCommandResponse({
    cmd: UV_OPERATION.UV_DBG_MEM_READ,
    status: UV_STATUS.UV_STATUS_SUCCESS,
    payloadBuffer: memBuf,
  })

  const res = decodeCommandResponse(buf)
  assert.equal(res.ok, true)
  assert.equal(res.cmd, UV_OPERATION.UV_DBG_MEM_READ)
  assert.equal(res.memory?.hex, 'aabbccdd')
  assert.equal(res.memory?.nAddr, 0x08000000n)
})

test('uvsock-command-response: decodes VSET response (expression)', () => {
  const vset = encodeVset({
    str: 'SystemCoreClock',
    value: 168000000,
  })

  const buf = encodeCommandResponse({
    cmd: UV_OPERATION.UV_DBG_CALC_EXPRESSION,
    status: UV_STATUS.UV_STATUS_SUCCESS,
    payloadBuffer: vset,
  })

  const res = decodeCommandResponse(buf)
  assert.equal(res.ok, true)
  assert.equal(res.cmd, UV_OPERATION.UV_DBG_CALC_EXPRESSION)
  assert.equal(res.expression?.val.asString, '168000000')
  assert.equal(res.expression?.str, 'SystemCoreClock')
})

test('uvsock-command-response: decodes BKRSP response (breakpoint creation)', () => {
  const bkrsp = encodeBkRsp({
    nTickMark: 5544,
    enabled: true,
    expression: 'main\\42',
  })

  const buf = encodeCommandResponse({
    cmd: UV_OPERATION.UV_DBG_CREATE_BP,
    status: UV_STATUS.UV_STATUS_SUCCESS,
    payloadBuffer: bkrsp,
  })

  const res = decodeCommandResponse(buf)
  assert.equal(res.ok, true)
  assert.equal(res.cmd, UV_OPERATION.UV_DBG_CREATE_BP)
  assert.equal(res.breakpoint?.nTickMark, 5544)
  assert.equal(res.breakpoint?.enabled, true)
  assert.equal(res.breakpoint?.expression, 'main\\42')
})
