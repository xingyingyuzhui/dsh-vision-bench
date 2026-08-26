import assert from 'node:assert/strict'
import test from 'node:test'
import { ERROR_CODES, fail } from '../src/domain/modbus/errors.mjs'
import { ERROR_CODES as appCodes } from '../bench-modbus.mjs'

test('ERROR_CODES covers the Stage 4 unified set and is shared via facade', () => {
  const required = [
    'UNIT_ID_INVALID',
    'CONNECTION_NOT_FOUND',
    'DEVICE_NOT_FOUND',
    'POINT_NOT_FOUND',
    'TARGET_MISMATCH',
    'CONFIG_DRIFT',
    'ENDPOINT_DRIFT',
    'PORT_IN_USE',
    'WRITE_OUTCOME_UNKNOWN',
    'WRITE_READBACK_MISMATCH',
    'IO_RUNTIME_UNAVAILABLE',
  ]
  for (const code of required) {
    assert.equal(ERROR_CODES[code], code)
    assert.equal(appCodes[code], code)
  }
})

test('fail() returns the shared error envelope', () => {
  const err = fail(ERROR_CODES.UNIT_ID_INVALID, 'Unit ID 必须为 1..247', { unitId: 0 }, false)
  assert.deepEqual(err, {
    ok: false,
    errorCode: 'UNIT_ID_INVALID',
    error: 'Unit ID 必须为 1..247',
    retryable: false,
    details: { unitId: 0 },
  })
})
