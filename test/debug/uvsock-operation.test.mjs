// @ts-check

import assert from 'node:assert/strict'
import test from 'node:test'
import { UV_OPERATION, UV_STATUS, statusToString } from '../../src/infrastructure/debug/keil/uvsock/index.mjs'

test('uvsock-operation: adheres strictly to official ARM Keil UVSOCK.h operation codes', () => {
  // General functions
  assert.equal(UV_OPERATION.UV_NULL_CMD, 0x0000)
  assert.equal(UV_OPERATION.UV_GEN_GET_VERSION, 0x0001)
  assert.equal(UV_OPERATION.UV_GEN_EXIT, 0x0009)

  // Project functions (0x1000 base)
  assert.equal(UV_OPERATION.UV_PRJ_LOAD, 0x1000)
  assert.equal(UV_OPERATION.UV_PRJ_CLOSE, 0x1001)
  assert.equal(UV_OPERATION.UV_PRJ_SET_TARGET, 0x1016)
  assert.equal(UV_OPERATION.UV_PRJ_GET_CUR_TARGET, 0x1017)

  // Debug functions (0x2000 base)
  assert.equal(UV_OPERATION.UV_DBG_ENTER, 0x2000)
  assert.equal(UV_OPERATION.UV_DBG_EXIT, 0x2001)
  assert.equal(UV_OPERATION.UV_DBG_START_EXECUTION, 0x2002)
  assert.equal(UV_OPERATION.UV_DBG_STOP_EXECUTION, 0x2003)
  assert.equal(UV_OPERATION.UV_DBG_STATUS, 0x2004)
  assert.equal(UV_OPERATION.UV_DBG_RESET, 0x2005)
  assert.equal(UV_OPERATION.UV_DBG_STEP_HLL, 0x2006)
  assert.equal(UV_OPERATION.UV_DBG_STEP_INTO, 0x2007)
  assert.equal(UV_OPERATION.UV_DBG_STEP_OUT, 0x2009)
  assert.equal(UV_OPERATION.UV_DBG_CALC_EXPRESSION, 0x200a)
  assert.equal(UV_OPERATION.UV_DBG_MEM_READ, 0x200b)
  assert.equal(UV_OPERATION.UV_DBG_CREATE_BP, 0x2014)
  assert.equal(UV_OPERATION.UV_DBG_CHANGE_BP, 0x2016)
  assert.equal(UV_OPERATION.UV_DBG_ENUM_STACK, 0x2019)
  assert.equal(UV_OPERATION.UV_DBG_ENUM_REGISTERS, 0x2027)
  assert.equal(UV_OPERATION.UV_DBG_READ_REGISTERS, 0x2028)
  assert.equal(UV_OPERATION.UV_DBG_ENUM_VARIABLES, 0x202e)

  // Response & Async codes
  assert.equal(UV_OPERATION.UV_CMD_RESPONSE, 0x3000)
  assert.equal(UV_OPERATION.UV_ASYNC_MSG, 0x4000)
  assert.equal(UV_OPERATION.UV_PRJ_BUILD_OUTPUT, 0x5001)
})

test('uvsock-status: verifies official status codes and string formatting', () => {
  assert.equal(UV_STATUS.UV_STATUS_SUCCESS, 0)
  assert.equal(UV_STATUS.UV_STATUS_FAILED, 1)
  assert.equal(UV_STATUS.UV_STATUS_TARGET_EXECUTING, 11)
  assert.equal(UV_STATUS.UV_STATUS_TARGET_STOPPED, 12)
  assert.equal(UV_STATUS.UV_STATUS_TIMEOUT, 29)

  assert.equal(statusToString(UV_STATUS.UV_STATUS_SUCCESS), 'UV_STATUS_SUCCESS')
  assert.equal(statusToString(UV_STATUS.UV_STATUS_TARGET_STOPPED), 'UV_STATUS_TARGET_STOPPED')
  assert.equal(statusToString(999), 'UV_STATUS_UNKNOWN_999')
})
