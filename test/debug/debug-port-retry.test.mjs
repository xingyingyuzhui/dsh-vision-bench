// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { DEBUG_ERRORS, DebugError } from '../../src/domain/debug/errors.mjs'
import { startOpenOcdWithAllocatedPort } from '../../src/infrastructure/debug/openocd/openocd-debug-process.mjs'

test('PR-3: startOpenOcdWithAllocatedPort retries on port conflict and succeeds on available port', async () => {
  const triedPorts = []
  let attempts = 0

  // Mock port allocator returning a new port each time
  let currentPort = 3333
  const mockPortAllocator = async () => currentPort++

  // Mock starter that fails for ports 3333 and 3334, and succeeds on 3335
  const mockStarter = async (options) => {
    attempts++
    triedPorts.push(options.gdbPort)
    if (options.gdbPort === 3333) {
      throw new Error('bind failed: Address already in use')
    }
    if (options.gdbPort === 3334) {
      throw new Error('could not bind gdb socket: port 3334 in use')
    }
    return {
      proc: {},
      port: options.gdbPort,
      stop: async () => {},
      exitPromise: Promise.resolve(0),
    }
  }

  const result = await startOpenOcdWithAllocatedPort({
    openocdBin: 'openocd',
    interfaceName: 'cmsis-dap',
    target: 'stm32f4x',
    portAllocator: mockPortAllocator,
    starter: mockStarter,
    maxAttempts: 3,
  })

  assert.equal(result.port, 3335)
  assert.equal(attempts, 3)
  assert.deepEqual(triedPorts, [3333, 3334, 3335])
})

test('PR-3: startOpenOcdWithAllocatedPort fails with DEBUG_PORT_CONFLICT when maxAttempts exceeded', async () => {
  let attempts = 0
  const mockStarter = async () => {
    attempts++
    throw new Error('bind failed: Address already in use')
  }

  await assert.rejects(
    async () => {
      await startOpenOcdWithAllocatedPort({
        openocdBin: 'openocd',
        interfaceName: 'cmsis-dap',
        target: 'stm32f4x',
        portAllocator: async () => 3333,
        starter: mockStarter,
        maxAttempts: 3,
      })
    },
    (err) => {
      assert.ok(err instanceof DebugError)
      assert.equal(err.code, DEBUG_ERRORS.PORT_CONFLICT)
      assert.match(err.message, /已达到最大重试次数/)
      assert.equal(err.details.maxAttempts, 3)
      return true
    },
  )

  assert.equal(attempts, 3)
})
