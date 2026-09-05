// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { MIClient, encodeMiArg } from '../../src/infrastructure/debug/gdb-mi/mi-client.mjs'

test('F08: encodeMiArg escapes quotes, backslashes, and handles spaces and empty strings', () => {
  // Empty string
  assert.equal(encodeMiArg(''), '""')

  // Simple token without whitespace
  assert.equal(encodeMiArg('main'), 'main')
  assert.equal(encodeMiArg('-exec-continue'), '-exec-continue')
  assert.equal(encodeMiArg('--thread'), '--thread')

  // Token with spaces
  assert.equal(encodeMiArg('x + 1'), '"x + 1"')

  // Quotes and backslashes
  assert.equal(encodeMiArg('say "hello"'), '"say \\"hello\\""')
  assert.equal(encodeMiArg('C:\\Program Files\\arm-gdb'), '"C:\\\\Program Files\\\\arm-gdb"')

  // Unicode without whitespace
  assert.equal(encodeMiArg('测试变量'), '测试变量')
  // Unicode with whitespace
  assert.equal(encodeMiArg('测试 变量'), '"测试 变量"')
})

test('F08: encodeMiArg rejects raw CR, LF, and NUL characters to prevent command splitting', () => {
  assert.throws(() => encodeMiArg('1\n-exec-continue'), /GDB MI 参数包含非法换行符或控制字符/)
  assert.throws(() => encodeMiArg('1\r-exec-continue'), /GDB MI 参数包含非法换行符或控制字符/)
  assert.throws(() => encodeMiArg('1\r\n-exec-continue'), /GDB MI 参数包含非法换行符或控制字符/)
  assert.throws(() => encodeMiArg('hello\0world'), /GDB MI 参数包含非法换行符或控制字符/)
})

test('F08: MIClient sendCommand prevents command injection via expression evaluation', async () => {
  /** @type {string[]} */
  const sent = []
  const client = new MIClient({
    transport: {
      write: (data) => sent.push(data),
      stop: async () => {},
    },
  })

  // Safe expression command
  const p1 = client.command('-data-evaluate-expression', ['x + 1'])
  // Correlate response
  assert.equal(sent.length, 1)
  assert.equal(sent[0], '1-data-evaluate-expression "x + 1"\n')
  client.handleLine('1^done,value="2"')
  const res = await p1
  assert.equal(res.class, 'done')

  // Attempt command injection via newline
  await assert.rejects(async () => {
    await client.command('-data-evaluate-expression', ['1\n-exec-continue'])
  }, /GDB MI 参数包含非法换行符或控制字符/)

  // Verify only 1 command was sent to transport (the injection attempt never reached transport)
  assert.equal(sent.length, 1)
})
