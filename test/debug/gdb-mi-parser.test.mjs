import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseCString, parseList, parseMILine, parseTuple } from '../../src/infrastructure/debug/gdb-mi/mi-parser.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixtureDir = join(__dirname, '../fixtures/gdb-mi')

test('parseCString handles standard and octal escape sequences', () => {
  const normal = parseCString('"hello \\"world\\"\\n\\t\\\\"', 0)
  assert.equal(normal.value, 'hello "world"\n\t\\')

  const octal = parseCString('"\\101\\102\\103"', 0) // ASCII 'ABC'
  assert.equal(octal.value, 'ABC')
})

test('parseTuple parses nested key-value objects', () => {
  const parsed = parseTuple('{a="1",b="2",nested={c="3"}}', 0)
  assert.deepEqual(parsed.value, {
    a: '1',
    b: '2',
    nested: { c: '3' },
  })
})

test('parseList parses lists of values and result pairs', () => {
  const valueList = parseList('["foo","bar","baz"]', 0)
  assert.deepEqual(valueList.value, ['foo', 'bar', 'baz'])

  const objList = parseList('[{name="x",val="1"},{name="y",val="2"}]', 0)
  assert.deepEqual(objList.value, [
    { name: 'x', val: '1' },
    { name: 'y', val: '2' },
  ])
})

test('parseMILine parses (gdb) prompt', () => {
  const rec = parseMILine('(gdb) ')
  assert.ok(rec)
  assert.equal(rec.kind, 'prompt')
})

test('parseMILine parses stream records', () => {
  const consoleRec = parseMILine('~"Loading section .text, size 0x1000 lma 0x8000000\\n"')
  assert.ok(consoleRec)
  assert.equal(consoleRec.kind, 'console-stream')
  assert.match(consoleRec.text, /Loading section/)

  const targetRec = parseMILine('@"Target output\\n"')
  assert.ok(targetRec)
  assert.equal(targetRec.kind, 'target-stream')

  const logRec = parseMILine('&"Log output\\n"')
  assert.ok(logRec)
  assert.equal(logRec.kind, 'log-stream')
})

test('parseMILine parses result records with token', () => {
  const rec = parseMILine(
    '42^done,bkpt={number="1",type="breakpoint",disp="keep",enabled="y",addr="0x08000214",func="main",file="main.c",line="42"}',
  )
  assert.ok(rec)
  assert.equal(rec.token, 42)
  assert.equal(rec.kind, 'result')
  assert.equal(rec.class, 'done')
  assert.equal(rec.results.bkpt.number, '1')
  assert.equal(rec.results.bkpt.addr, '0x08000214')
  assert.equal(rec.results.bkpt.func, 'main')
})

test('parseMILine correctly parses fixture breakpoint-hit.txt', () => {
  const content = readFileSync(join(fixtureDir, 'breakpoint-hit.txt'), 'utf8')
  const lines = content.split(/\r?\n/).filter(Boolean)
  const stoppedRec = parseMILine(lines[0])
  assert.ok(stoppedRec)
  assert.equal(stoppedRec.kind, 'exec-async')
  assert.equal(stoppedRec.class, 'stopped')
  assert.equal(stoppedRec.results.reason, 'breakpoint-hit')
  assert.equal(stoppedRec.results.bkptno, '1')
  assert.equal(stoppedRec.results.frame.func, 'main')
  assert.equal(stoppedRec.results.frame.line, '42')
})

test('parseMILine correctly parses fixture watchpoint-hit.txt', () => {
  const content = readFileSync(join(fixtureDir, 'watchpoint-hit.txt'), 'utf8')
  const lines = content.split(/\r?\n/).filter(Boolean)
  const stoppedRec = parseMILine(lines[0])
  assert.ok(stoppedRec)
  assert.equal(stoppedRec.kind, 'exec-async')
  assert.equal(stoppedRec.class, 'stopped')
  assert.equal(stoppedRec.results.reason, 'watchpoint-trigger')
  assert.equal(stoppedRec.results.wpt.exp, 'eev_target')
  assert.equal(stoppedRec.results.value.old, '100')
  assert.equal(stoppedRec.results.value.new, '0')
})

test('parseMILine correctly parses fixture step-complete.txt', () => {
  const content = readFileSync(join(fixtureDir, 'step-complete.txt'), 'utf8')
  const lines = content.split(/\r?\n/).filter(Boolean)
  const stoppedRec = parseMILine(lines[0])
  assert.ok(stoppedRec)
  assert.equal(stoppedRec.kind, 'exec-async')
  assert.equal(stoppedRec.class, 'stopped')
  assert.equal(stoppedRec.results.reason, 'end-stepping-range')
  assert.equal(stoppedRec.results.frame.line, '43')
})

test('parseMILine correctly parses fixture error.txt', () => {
  const content = readFileSync(join(fixtureDir, 'error.txt'), 'utf8')
  const lines = content.split(/\r?\n/).filter(Boolean)
  const errRec = parseMILine(lines[0])
  assert.ok(errRec)
  assert.equal(errRec.token, 101)
  assert.equal(errRec.kind, 'result')
  assert.equal(errRec.class, 'error')
  assert.match(errRec.results.msg, /No symbol "unknown_var"/)
})
