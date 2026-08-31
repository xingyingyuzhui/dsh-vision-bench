import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { ERROR_CODES } from '../src/domain/modbus/errors.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('tool schema and ERROR_CODES share critical write/target codes', async () => {
  // Agent tool surface re-exports from application; ensure codes exist for schema docs.
  const required = [
    'TARGET_REQUIRED',
    'TARGET_MISMATCH',
    'ENDPOINT_DRIFT',
    'CONFIG_DRIFT',
    'CONFIG_VERSION_REQUIRED',
    'TASK_CONFLICT',
    'FLASH_APPROVAL_REQUIRED',
    'OPENOCD_IDENTITY_INVALID',
    'WRITE_OUTCOME_UNKNOWN',
    'WRITE_READBACK_MISMATCH',
    'UNIT_ID_INVALID',
  ]
  for (const code of required) assert.equal(ERROR_CODES[code], code)
})

test('compatibility aliases are confined to boundary converters, not domain modules', async () => {
  const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const domain = stripComments(
    readFileSync(join(root, 'src/domain/modbus/validation.mjs'), 'utf8') +
      readFileSync(join(root, 'src/domain/modbus/endpoint.mjs'), 'utf8') +
      readFileSync(join(root, 'src/domain/modbus/errors.mjs'), 'utf8'),
  )
  // Domain may mention legacy only in comments; forbid dual-read patterns in domain.
  assert.doesNotMatch(domain, /trendEnabled\s*\|\|\s*monitorEnabled/)
  assert.doesNotMatch(domain, /connId\s*\|\|\s*connectionId/)
  assert.doesNotMatch(domain, /\.slave\b/)
})
