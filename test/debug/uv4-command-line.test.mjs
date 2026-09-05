// @ts-check

import assert from 'node:assert/strict'
import test from 'node:test'
import { buildUv4DebugArgs } from '../../src/infrastructure/debug/keil/uv4-command-line.mjs'

test('uv4-command-line: builds official UV4 arguments and rejects legacy -sock parameter', () => {
  // 1. Throws on missing projectPath
  // @ts-ignore
  assert.throws(() => buildUv4DebugArgs({}), /projectPath is required/)

  // 2. Default debug arguments
  const defaultArgs = buildUv4DebugArgs({ projectPath: 'C:\\Firmware\\app.uvprojx' })
  assert.deepEqual(defaultArgs, ['-j0', '-d', 'C:\\Firmware\\app.uvprojx'])

  // 3. With socket port and target
  const fullArgs = buildUv4DebugArgs({
    projectPath: 'C:\\Firmware\\app.uvprojx',
    targetName: 'STM32F407_Debug',
    socketPort: 5200,
    hidden: true,
    debug: true,
  })

  assert.deepEqual(fullArgs, ['-j0', '-d', '-s', '5200', 'C:\\Firmware\\app.uvprojx', '-t', 'STM32F407_Debug'])

  // 4. Assert legacy -sock argument is strictly prohibited
  assert.ok(!fullArgs.some((arg) => arg.includes('-sock:')))
})
