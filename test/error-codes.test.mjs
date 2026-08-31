import assert from 'node:assert/strict'
import test from 'node:test'
import { ERROR_CODES as appCodes } from '../bench-modbus.mjs'
import { FLASH_ERROR_CODES } from '../src/domain/flash/errors.mjs'
import { ERROR_CODES, fail } from '../src/domain/modbus/errors.mjs'

test('ERROR_CODES covers the Stage 4 unified set and is shared via facade', async () => {
  const required = [
    'UNIT_ID_INVALID',
    'CONNECTION_NOT_FOUND',
    'DEVICE_NOT_FOUND',
    'POINT_NOT_FOUND',
    'TARGET_MISMATCH',
    'CONFIG_DRIFT',
    'CONFIG_VERSION_REQUIRED',
    'TASK_CONFLICT',
    'FLASH_APPROVAL_REQUIRED',
    'FLASH_APPROVAL_NOT_FOUND',
    'FLASH_APPROVAL_EXPIRED',
    'FLASH_APPROVAL_SCOPE_MISMATCH',
    'FIRMWARE_SNAPSHOT_FAILED',
    'FIRMWARE_SNAPSHOT_MISMATCH',
    'OPENOCD_NOT_FOUND',
    'OPENOCD_IDENTITY_INVALID',
    'OPENOCD_PROBE_FAILED',
    'OPENOCD_PROBE_TIMEOUT',
    'OPENOCD_PROBE_CANCELLED',
    'FLASH_INTERFACE_INVALID',
    'FLASH_TARGET_INVALID',
    'FLASH_RESULT_UNVERIFIED',
    'FLASH_TIMEOUT',
    'FLASH_CANCELLED',
    'FLASH_FAILED',
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

test('FLASH_ERROR_CODES is the single flash catalog', () => {
  for (const code of Object.keys(FLASH_ERROR_CODES)) {
    assert.equal(ERROR_CODES[code], code)
  }
})

test('fail() returns the shared error envelope', async () => {
  const err = fail(ERROR_CODES.UNIT_ID_INVALID, 'Unit ID 必须为 1..247', { unitId: 0 }, false)
  assert.deepEqual(err, {
    ok: false,
    errorCode: 'UNIT_ID_INVALID',
    error: 'Unit ID 必须为 1..247',
    retryable: false,
    details: { unitId: 0 },
  })
})
