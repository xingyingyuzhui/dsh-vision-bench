import assert from 'node:assert/strict'
import { unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createGdbBackend } from '../../src/infrastructure/debug/gdb-mi/gdb-backend.mjs'
import { MIRecord } from '../../src/infrastructure/debug/gdb-mi/mi-record.mjs'

/**
 * Creates a mock MI client for testing GdbBackend.
 */
function createMockMiClient() {
  /** @type {Array<{ cmd: string, args: any[] }>} */
  const executedCommands = []
  /** @type {Set<(rec: MIRecord) => void>} */
  const asyncListeners = new Set()
  let stopped = false

  return {
    executedCommands,
    onAsync: (listener) => {
      asyncListeners.add(listener)
      return () => asyncListeners.delete(listener)
    },
    emitAsync: (rec) => {
      for (const listener of asyncListeners) listener(rec)
    },
    command: async (cmd, args = []) => {
      executedCommands.push({ cmd, args })

      if (cmd === '-break-insert') {
        return new MIRecord({
          kind: 'result',
          class: 'done',
          results: {
            bkpt: {
              number: '1',
              addr: '0x08000214',
              file: 'main.c',
              line: '42',
            },
          },
        })
      }

      if (cmd === '-break-watch') {
        return new MIRecord({
          kind: 'result',
          class: 'done',
          results: {
            wpt: {
              number: '2',
              exp: args[args.length - 1],
            },
          },
        })
      }

      if (cmd === '-stack-list-frames') {
        return new MIRecord({
          kind: 'result',
          class: 'done',
          results: {
            stack: [
              {
                frame: {
                  level: '0',
                  addr: '0x08000214',
                  func: 'main',
                  file: 'main.c',
                  line: '42',
                },
              },
            ],
          },
        })
      }

      if (cmd === '-stack-list-variables') {
        return new MIRecord({
          kind: 'result',
          class: 'done',
          results: {
            variables: [
              { name: 'val', value: '42', type: 'int' },
              { name: 'flag', value: '1', type: 'bool' },
            ],
          },
        })
      }

      if (cmd === '-data-evaluate-expression') {
        return new MIRecord({
          kind: 'result',
          class: 'done',
          results: { value: '42' },
        })
      }

      if (cmd === '-data-list-register-names') {
        return new MIRecord({
          kind: 'result',
          class: 'done',
          results: { 'register-names': ['r0', 'r1', 'sp', 'lr', 'pc'] },
        })
      }

      if (cmd === '-data-list-register-values') {
        return new MIRecord({
          kind: 'result',
          class: 'done',
          results: {
            'register-values': [
              { number: '0', value: '0x00000000' },
              { number: '4', value: '0x08000214' },
            ],
          },
        })
      }

      if (cmd === '-data-read-memory-bytes') {
        return new MIRecord({
          kind: 'result',
          class: 'done',
          results: {
            memory: [{ begin: '0x20000000', contents: 'deadbeef' }],
          },
        })
      }

      return new MIRecord({ kind: 'result', class: 'done' })
    },
    stop: async () => {
      stopped = true
    },
    isStopped: () => stopped,
  }
}

test('GdbBackend lifecycle, commands, and stop reason mapping', async () => {
  const dummyAxf = join(tmpdir(), `test_firmware_${Date.now()}.axf`)
  await writeFile(dummyAxf, Buffer.from('FAKE ELF HEADER'))

  try {
    const mockMi = createMockMiClient()
    let openocdStopped = false

    /** @type {any[]} */
    const backendEvents = []

    const backend = createGdbBackend({
      debugSessionId: 'ds_test_1',
      ownerSessionId: 'owner_1',
      workspaceCwd: '/workspace',
      openocdStarter: async (opts) => ({
        port: opts.gdbPort || 3333,
        stop: async () => {
          openocdStopped = true
        },
      }),
      miClientFactory: () => mockMi,
    })

    backend.subscribe((e) => backendEvents.push(e))

    // 1. Start session
    await backend.start({
      targetSpec: {
        artifactPath: dummyAxf,
        interfaceName: 'stlink',
        target: 'stm32f4x',
        gdbPort: 3333,
      },
    })

    assert.equal(backend.nativeState, 'paused')
    assert.ok(backend.firmwareHash.length > 0)
    assert.equal(backend.lastNativeLocation?.function, 'main')
    assert.equal(backend.lastNativeLocation?.line, 42)

    // 2. Breakpoints & Watchpoints
    const bp = await backend.addBreakpoint({
      id: 'bp_1',
      file: 'main.c',
      line: 42,
      condition: 'val > 10',
      verified: false,
    })
    assert.equal(bp.verified, true)
    assert.equal(bp.address, '0x08000214')

    const wp = await backend.addWatchpoint({
      id: 'wp_1',
      expression: 'counter',
      accessType: 'write',
      verified: false,
    })
    assert.equal(wp.verified, true)

    // 3. Execution control commands
    const contRes = await backend.continue()
    assert.equal(contRes.class, 'done')
    assert.equal(backend.nativeState, 'running')

    const pauseRes = await backend.pause()
    assert.equal(pauseRes.class, 'done')
    assert.equal(backend.nativeState, 'paused')

    const stepRes = await backend.stepOver()
    assert.equal(stepRes.class, 'done')

    const resetRes = await backend.resetHalt()
    assert.equal(resetRes.class, 'done')
    assert.equal(backend.nativeState, 'paused')

    // 4. Context queries
    const frames = await backend.stack()
    assert.equal(frames.length, 1)
    assert.equal(frames[0].function, 'main')

    const vars = await backend.locals()
    assert.equal(vars.length, 2)
    assert.equal(vars[0].name, 'val')

    const regs = await backend.registers()
    assert.equal(regs.length, 2)
    assert.equal(regs[0].name, 'r0')

    const mem = await backend.readMemory('0x20000000', 4)
    assert.equal(mem, 'deadbeef')

    // 5. Test async stop event handling
    mockMi.emitAsync(
      new MIRecord({
        kind: 'exec-async',
        class: 'stopped',
        results: {
          reason: 'breakpoint-hit',
          bkptno: '1',
          frame: {
            func: 'sub_routine',
            file: 'sub.c',
            line: '10',
            addr: '0x08000300',
          },
        },
      }),
    )

    const stopEvent = backendEvents.find((e) => e.type === 'backend.stopped')
    assert.ok(stopEvent)
    assert.equal(stopEvent.reason, 'breakpoint')
    assert.equal(stopEvent.location.function, 'sub_routine')
    assert.equal(backend.nativeState, 'paused')

    // 6. Clean remove breakpoint & watchpoint
    const bpRem = await backend.removeBreakpoint(bp)
    assert.equal(bpRem.ok, true)

    const wpRem = await backend.removeWatchpoint(wp)
    assert.equal(wpRem.ok, true)

    // 7. Stop backend
    await backend.stop()
    assert.equal(backend.nativeState, 'idle')
    assert.equal(openocdStopped, true)
    assert.equal(mockMi.isStopped(), true)
  } finally {
    try {
      await unlink(dummyAxf)
    } catch {
      /* ignore */
    }
  }
})
