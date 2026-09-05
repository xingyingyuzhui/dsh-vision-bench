import assert from 'node:assert/strict'
import { unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// @ts-check
import test from 'node:test'
import { createDebugRuntime } from '../../src/application/debug/debug-runtime.mjs'
import { createGdbBackend } from '../../src/infrastructure/debug/gdb-mi/gdb-backend.mjs'
import { MIRecord } from '../../src/infrastructure/debug/gdb-mi/mi-record.mjs'
import { DEBUG_EVENT_TYPES } from '../../src/shared/debug-events.mjs'

function createFakeMiClient() {
  /** @type {((rec: any) => void) | null} */
  let asyncCb = null
  let stopped = false
  /** @type {((val: any) => void) | null} */
  let exitResolve = null
  const exitPromise = new Promise((resolve) => {
    exitResolve = resolve
  })

  return {
    _transport: { exitPromise },
    onAsync: (cb) => {
      asyncCb = cb
      return () => {
        asyncCb = null
      }
    },
    onStream: () => () => {},
    emitAsync: (rec) => asyncCb && asyncCb(rec),
    emitExit: (code = 0, signal = null) => exitResolve && exitResolve({ code, signal }),
    command: async (cmd) => {
      if (cmd === '-target-select') return new MIRecord({ kind: 'result', class: 'connected' })
      if (cmd === '-interpreter-exec') return new MIRecord({ kind: 'result', class: 'done' })
      if (cmd === '-stack-list-frames') {
        return new MIRecord({
          kind: 'result',
          class: 'done',
          results: {
            stack: [
              {
                level: '0',
                addr: '0x08000100',
                func: 'main',
                file: 'main.c',
                fullname: '/src/main.c',
                line: '42',
              },
            ],
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

test('PR-1: Backend events follow single canonical path through DebugRuntime with no direct product event ring', async () => {
  const dummyAxf = join(tmpdir(), `test_single_path_${Date.now()}.axf`)
  await writeFile(dummyAxf, Buffer.from('FAKE ELF CONTENT'))

  try {
    const fakeMi = createFakeMiClient()
    const backend = createGdbBackend({
      debugSessionId: 'ds_sp_1',
      ownerSessionId: 'owner_1',
      workspaceCwd: '/workspace',
      openocdStarter: async (opts) => ({
        port: opts.gdbPort || 3333,
        stop: async () => {},
      }),
      miClientFactory: () => fakeMi,
    })

    // Backend must not have eventRing property
    assert.equal(/** @type {any} */ (backend).eventRing, undefined)

    const runtime = createDebugRuntime({
      backendFactory: () => backend,
    })

    const startRes = await runtime.start({
      ownerSessionId: 'owner_1',
      workspaceCwd: '/workspace',
      backend: 'gdb-openocd',
      targetSpec: {
        artifactPath: dummyAxf,
        interfaceName: 'stlink',
        target: 'stm32f4x',
        gdbPort: 3333,
      },
    })

    assert.equal(startRes.backend, 'gdb-openocd')
    const sessionId = startRes.debugSessionId

    // Drain startup events
    const initialEventsRes = runtime.getEvents({ debugSessionId: sessionId, ownerSessionId: 'owner_1' }, 0)
    assert.ok(initialEventsRes.events.length > 0)
    let lastCursor = initialEventsRes.nextCursor

    // 1. Trigger running via MI async record
    fakeMi.emitAsync(
      new MIRecord({
        kind: 'exec-async',
        class: 'running',
        results: { 'thread-id': '1' },
      }),
    )

    const runEventsRes = runtime.getEvents({ debugSessionId: sessionId, ownerSessionId: 'owner_1' }, lastCursor)
    assert.equal(runEventsRes.events.length, 1)
    assert.equal(runEventsRes.events[0].type, DEBUG_EVENT_TYPES.RUNNING)
    lastCursor = runEventsRes.nextCursor

    // 2. Trigger stopped due to breakpoint hit via MI async record
    fakeMi.emitAsync(
      new MIRecord({
        kind: 'exec-async',
        class: 'stopped',
        results: {
          reason: 'breakpoint-hit',
          bkptno: '2',
          frame: {
            func: 'process_data',
            file: 'data.c',
            line: '100',
            addr: '0x08000450',
          },
        },
      }),
    )

    const stopEventsRes = runtime.getEvents({ debugSessionId: sessionId, ownerSessionId: 'owner_1' }, lastCursor)
    // Exactly one event: BREAKPOINT_HIT (never both BREAKPOINT_HIT and debug.stopped)
    assert.equal(stopEventsRes.events.length, 1)
    assert.equal(stopEventsRes.events[0].type, DEBUG_EVENT_TYPES.BREAKPOINT_HIT)
    assert.equal(stopEventsRes.events[0].payload.breakpointId, '2')
    lastCursor = stopEventsRes.nextCursor

    // 3. Clean stop: waitEvents resolves with SESSION_STOPPED and SESSION_CLOSED
    const waitPromise = runtime.waitEvents({ debugSessionId: sessionId, ownerSessionId: 'owner_1' }, lastCursor)
    await runtime.stop({ debugSessionId: sessionId, ownerSessionId: 'owner_1' })

    const terminalRes = await waitPromise
    const stoppedEvents = terminalRes.events.filter((e) => e.type === DEBUG_EVENT_TYPES.SESSION_STOPPED)
    // Exactly one SESSION_STOPPED event
    assert.equal(stoppedEvents.length, 1)
  } finally {
    try {
      await unlink(dummyAxf)
    } catch {
      /* ignore */
    }
  }
})

test('PR-1: GdbBackend deduplicates exit emission', async () => {
  const dummyAxf = join(tmpdir(), `test_exit_dedup_${Date.now()}.axf`)
  await writeFile(dummyAxf, Buffer.from('FAKE ELF'))

  try {
    const fakeMi = createFakeMiClient()
    const backend = createGdbBackend({
      debugSessionId: 'ds_dedup_1',
      ownerSessionId: 'owner_1',
      workspaceCwd: '/workspace',
      openocdStarter: async () => ({ port: 3333, stop: async () => {} }),
      miClientFactory: () => fakeMi,
    })

    /** @type {any[]} */
    const emitted = []
    backend.subscribe((ev) => {
      if (ev.type === 'backend.exited') {
        emitted.push(ev)
      }
    })

    await backend.start({
      targetSpec: {
        artifactPath: dummyAxf,
        interfaceName: 'stlink',
        target: 'stm32f4x',
      },
    })

    // Trigger exit twice
    fakeMi.emitExit(0, null)
    backend._emitExitOnce({ type: 'backend.exited', code: 0, unexpected: false })

    // Only one exited event should have been emitted
    assert.equal(emitted.length, 1)

    await backend.stop()
  } finally {
    try {
      await unlink(dummyAxf)
    } catch {
      /* ignore */
    }
  }
})
