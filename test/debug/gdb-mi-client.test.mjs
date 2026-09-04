import assert from 'node:assert/strict'
import test from 'node:test'
import { createMiClient } from '../../src/infrastructure/debug/gdb-mi/mi-client.mjs'

test('MIClient commands serialize and resolve correlated result records', async () => {
  /** @type {string[]} */
  const written = []
  const client = createMiClient({
    transport: {
      write: (line) => {
        written.push(line)
      },
    },
  })

  const cmdPromise = client.command('-break-insert', ['main.c:42'])
  assert.equal(written.length, 1)
  assert.match(written[0], /^1-break-insert main.c:42\n$/)

  // Simulate GDB replying with matching token
  client.handleLine('1^done,bkpt={number="1",addr="0x08000214"}')
  const result = await cmdPromise

  assert.equal(result.token, 1)
  assert.equal(result.class, 'done')
  assert.equal(result.results.bkpt.number, '1')
})

test('MIClient rejects on error result records', async () => {
  const client = createMiClient({
    transport: {
      write: () => {},
    },
  })

  const cmdPromise = client.command('-data-evaluate-expression', ['unknown_var'])
  client.handleLine('1^error,msg="No symbol in current context"')

  await assert.rejects(cmdPromise, (err) => {
    assert.match(err.message, /No symbol in current context/)
    return true
  })
})

test('MIClient times out when command has no reply', async () => {
  const client = createMiClient({
    transport: {
      write: () => {},
    },
  })

  const cmdPromise = client.command('-exec-continue', [], { timeoutMs: 50 })
  await assert.rejects(cmdPromise, (err) => {
    assert.match(err.message, /超时/)
    return true
  })
})

test('MIClient respects AbortSignal', async () => {
  const client = createMiClient({
    transport: {
      write: () => {},
    },
  })

  const ac = new AbortController()
  const cmdPromise = client.command('-exec-step', [], { signal: ac.signal, timeoutMs: 5000 })
  ac.abort()

  await assert.rejects(cmdPromise, (err) => {
    assert.match(err.message, /已取消/)
    return true
  })
})

test('MIClient dispatches stream and async records to listeners', async () => {
  const client = createMiClient({
    transport: {
      write: () => {},
    },
  })

  /** @type {string[]} */
  const consoleOutput = []
  /** @type {any[]} */
  const asyncStops = []

  const unstream = client.onStream((rec) => {
    if (rec.kind === 'console-stream') {
      consoleOutput.push(rec.text)
    }
  })

  const unasync = client.onAsync((rec) => {
    if (rec.class === 'stopped') {
      asyncStops.push(rec.results)
    }
  })

  client.handleLine('~"Loading section .text\\n"')
  client.handleLine('*stopped,reason="breakpoint-hit",bkptno="1"')

  assert.equal(consoleOutput.length, 1)
  assert.match(consoleOutput[0], /Loading section/)
  assert.equal(asyncStops.length, 1)
  assert.equal(asyncStops[0].reason, 'breakpoint-hit')

  unstream()
  unasync()

  // After unsubscribe
  client.handleLine('~"More output\\n"')
  assert.equal(consoleOutput.length, 1)
})

test('MIClient stop() rejects all pending commands', async () => {
  const client = createMiClient({
    transport: {
      write: () => {},
    },
  })

  const cmdPromise = client.command('-exec-continue', [], { timeoutMs: 10000 })
  await client.stop()

  await assert.rejects(cmdPromise, (err) => {
    assert.match(err.message, /已停止/)
    return true
  })
})
