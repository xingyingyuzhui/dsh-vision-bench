// @ts-check
import assert from 'node:assert/strict'
import { unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createDebugRuntime } from '../../src/application/debug/debug-runtime.mjs'
import { createGdbBackend } from '../../src/infrastructure/debug/gdb-mi/gdb-backend.mjs'
import { MIRecord } from '../../src/infrastructure/debug/gdb-mi/mi-record.mjs'
import { DEBUG_EVENT_TYPES } from '../../src/shared/debug-events.mjs'

/**
 * Creates a mock MI Client that can play GDB transcript events.
 */
function createTranscriptMockMiClient() {
  /** @type {Set<(rec: MIRecord) => void>} */
  const recordListeners = new Set()
  /** @type {Set<(rec: MIRecord) => void>} */
  const streamListeners = new Set()
  let stopped = false

  return {
    async command(cmd, args = []) {
      if (cmd === '-target-select') {
        return new MIRecord({ token: 1, kind: 'result', class: 'done' })
      }
      if (cmd === '-interpreter-exec') {
        return new MIRecord({ token: 2, kind: 'result', class: 'done' })
      }
      if (cmd === '-exec-continue') {
        return new MIRecord({ token: 3, kind: 'result', class: 'running' })
      }
      if (cmd === '-exec-interrupt') {
        return new MIRecord({ token: 4, kind: 'result', class: 'done' })
      }
      if (cmd === '-exec-next') {
        return new MIRecord({ token: 5, kind: 'result', class: 'running' })
      }
      if (cmd === '-stack-list-frames') {
        return new MIRecord({
          token: 6,
          kind: 'result',
          class: 'done',
          results: {
            stack: [
              {
                level: '0',
                addr: '0x08000214',
                func: 'main',
                file: 'main.c',
                line: '42',
              },
            ],
          },
        })
      }
      if (cmd === '-stack-list-variables') {
        return new MIRecord({
          token: 7,
          kind: 'result',
          class: 'done',
          results: {
            variables: [{ name: 'val', value: '42', type: 'int' }],
          },
        })
      }
      return new MIRecord({ token: 99, kind: 'result', class: 'done' })
    },
    onRecord(listener) {
      recordListeners.add(listener)
      return () => recordListeners.delete(listener)
    },
    onStream(listener) {
      streamListeners.add(listener)
      return () => streamListeners.delete(listener)
    },
    onAsync(listener) {
      return this.onRecord((rec) => {
        if (rec.kind === 'exec-async' || rec.kind === 'notify-async') {
          listener(rec)
        }
      })
    },
    emitRecord(rec) {
      for (const l of recordListeners) l(rec)
    },
    emitStream(rec) {
      for (const l of streamListeners) l(rec)
    },
    async stop() {
      stopped = true
    },
    isStopped() {
      return stopped
    },
  }
}

test('GdbBackend transcript processing into DebugRuntime events', async () => {
  const dummyAxf = join(tmpdir(), `transcript_fw_${Date.now()}.axf`)
  await writeFile(dummyAxf, Buffer.from('FAKE ELF HEADER'))

  try {
    const mockMi = createTranscriptMockMiClient()
    let backendInstance = null

    const runtime = createDebugRuntime({
      backendFactory: async (_kind, ctx) => {
        backendInstance = createGdbBackend({
          ...ctx,
          openocdStarter: async (opts) => ({
            port: opts.gdbPort || 3333,
            stop: async () => {},
          }),
          miClientFactory: () => mockMi,
        })
        return backendInstance
      },
    })

    const view = await runtime.start({
      debugSessionId: 'sess_transcript_1',
      ownerSessionId: 'owner_1',
      workspaceCwd: '/work',
      backend: 'gdb-openocd',
      targetSpec: {
        artifactPath: dummyAxf,
        interfaceName: 'stlink',
        target: 'stm32f4x',
        gdbPort: 3333,
      },
    })

    assert.equal(view.state, 'ready')

    // Feed transcript: target starts running
    mockMi.emitRecord(
      new MIRecord({
        kind: 'exec-async',
        class: 'running',
        results: { 'thread-id': 'all' },
      }),
    )

    let state = runtime.state({ debugSessionId: 'sess_transcript_1', ownerSessionId: 'owner_1' })
    assert.equal(state.state, 'running')

    // Feed transcript: console output from GDB
    mockMi.emitStream(
      new MIRecord({
        kind: 'console-stream',
        text: 'Breakpoint 1 hit at main.c:42\n',
      }),
    )

    // Feed transcript: stopped on breakpoint
    mockMi.emitRecord(
      new MIRecord({
        kind: 'exec-async',
        class: 'stopped',
        results: {
          reason: 'breakpoint-hit',
          bkptno: '1',
          frame: {
            func: 'main',
            file: 'main.c',
            line: '42',
            addr: '0x08000214',
          },
        },
      }),
    )

    state = runtime.state({ debugSessionId: 'sess_transcript_1', ownerSessionId: 'owner_1' })
    assert.equal(state.state, 'paused')
    assert.equal(state.location?.function, 'main')
    assert.equal(state.location?.line, 42)

    // Verify all domain events arrived in order
    const evRes = await runtime.waitEvents({ debugSessionId: 'sess_transcript_1', ownerSessionId: 'owner_1' }, 0)
    const types = evRes.events.map((e) => e.type)

    assert.ok(types.includes(DEBUG_EVENT_TYPES.RUNNING))
    assert.ok(types.includes(DEBUG_EVENT_TYPES.CONSOLE))
    assert.ok(types.includes(DEBUG_EVENT_TYPES.BREAKPOINT_HIT))

    await runtime.shutdown()
  } finally {
    try {
      await unlink(dummyAxf)
    } catch {}
  }
})
