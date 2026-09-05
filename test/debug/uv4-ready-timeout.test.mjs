// @ts-check

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { UV4DebugProcess } from '../../src/infrastructure/debug/keil/uv4-debug-process.mjs'

test('uv4-debug-process: fail-fast on port readiness timeout', async () => {
  const mockChild = new EventEmitter()
  // @ts-ignore
  mockChild.kill = () => true

  const proc = new UV4DebugProcess({
    // @ts-ignore
    spawner: () => mockChild,
    portAllocator: async () => 5888,
    portChecker: async () => true, // Port remains available, never bound
  })

  await assert.rejects(
    () =>
      proc.launch({
        projectPath: 'C:\\test.uvprojx',
        timeoutMs: 150,
      }),
    /UV4 UVSOCK port not ready within 150ms/,
  )
})

test('uv4-debug-process: fail-fast on spawn error', async () => {
  const mockChild = new EventEmitter()
  // @ts-ignore
  mockChild.kill = () => true

  const proc = new UV4DebugProcess({
    // @ts-ignore
    spawner: () => {
      setImmediate(() => mockChild.emit('error', new Error('ENOENT UV4.exe not found')))
      return mockChild
    },
    portAllocator: async () => 5889,
    portChecker: async () => true,
  })

  await assert.rejects(
    () =>
      proc.launch({
        projectPath: 'C:\\test.uvprojx',
        timeoutMs: 500,
      }),
    /UV4 进程启动失败: ENOENT UV4.exe not found/,
  )
})
