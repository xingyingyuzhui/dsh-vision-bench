// @ts-check
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { GdbBackend } from '../../src/infrastructure/debug/gdb-mi/gdb-backend.mjs'
import { encodeMiArg } from '../../src/infrastructure/debug/gdb-mi/mi-client.mjs'
import { MIRecord } from '../../src/infrastructure/debug/gdb-mi/mi-record.mjs'

const AXF = join(tmpdir(), `dvb-gdb-wire-${Date.now()}.axf`)
writeFileSync(AXF, 'ELF payload')

const done = (token = 1) => new MIRecord({ token, kind: 'result', class: 'done' })

/**
 * Mock MI client that records the exact wire form of every command and mirrors
 * GDB's own parsing of `-interpreter-exec CONSOLE-COMMAND`: the console command
 * is split on whitespace and its first word must be a known CLI command.
 */
function createWireMock({ failMonitor = false } = {}) {
  /** @type {string[]} */
  const wire = []
  const client = {
    wire,
    async command(cmd, args = []) {
      const formatted = (args || []).map(encodeMiArg).join(' ')
      wire.push(formatted ? `${cmd} ${formatted}` : cmd)

      if (cmd === '-target-select') return done(1)
      if (cmd === '-interpreter-exec') {
        const consoleCmd = String(args[1] ?? '')
        const firstWord = consoleCmd.trim().split(/\s+/)[0] || ''
        if (firstWord !== 'monitor') {
          // Mirrors mi-client's `^error` path: the pending promise rejects.
          throw new Error(`Undefined command: "${firstWord}".  Try "help".`)
        }
        if (failMonitor) throw new Error('monitor is not supported by this probe')
        return done(2)
      }
      if (cmd === '-exec-interrupt') return done(3)
      if (cmd === '-stack-list-frames') {
        return new MIRecord({ token: 4, kind: 'result', class: 'done', results: { stack: [] } })
      }
      return done(99)
    },
    onRecord: () => () => {},
    onStream: () => () => {},
    onAsync: () => () => {},
    async stop() {},
  }
  return client
}

function makeBackend(mock) {
  const backend = new GdbBackend({
    debugSessionId: 'ds_test',
    ownerSessionId: 'sess_test',
    workspaceCwd: tmpdir(),
    miClientFactory: () => mock,
  })
  backend.miClient = mock
  backend.openocdStarter = async () => ({
    gdbPort: 3333,
    process: { on() {}, kill() {}, killed: false },
    exitPromise: new Promise(() => {}),
  })
  return backend
}

test('B1: -interpreter-exec 发出裸 CLI 文本，不预加引号', async () => {
  const mock = createWireMock()
  const backend = makeBackend(mock)
  await backend.start({ targetSpec: { artifactPath: AXF, gdbPort: 3333 } })

  const line = mock.wire.find((l) => l.startsWith('-interpreter-exec'))
  assert.equal(line, '-interpreter-exec console "monitor reset halt"')
  // 反向断言：预引号会被二次转义成 "\"monitor reset halt\""
  assert.ok(!line?.includes('\\"'), '不得出现二次转义')
})

test('B1: 预加引号的参数被自检拒绝', async () => {
  const backend = makeBackend(createWireMock())
  await assert.rejects(() => backend.interpreterExec('"monitor reset halt"'), /预加引号/)
  await assert.rejects(() => backend.interpreterExec("'monitor reset halt'"), /预加引号/)
  await assert.rejects(() => backend.interpreterExec('   '), /非空/)
})

test('B1: resetHalt 也走裸文本', async () => {
  const mock = createWireMock()
  const backend = makeBackend(mock)
  backend.miClient = mock
  await backend.resetHalt()
  const line = mock.wire.find((l) => l.startsWith('-interpreter-exec'))
  assert.equal(line, '-interpreter-exec console "monitor reset halt"')
})

test('B2: 探针不支持 monitor 时会话存活并降级为 -exec-interrupt', async () => {
  const mock = createWireMock({ failMonitor: true })
  const backend = makeBackend(mock)

  await assert.doesNotReject(() => backend.start({ targetSpec: { artifactPath: AXF, gdbPort: 3333 } }))

  assert.ok(backend.lastNonFatalError.includes('monitor'), '应记录非致命错误')
  assert.ok(
    mock.wire.some((l) => l.startsWith('-exec-interrupt')),
    '应回退到 MI 原生中断',
  )
  assert.ok(!mock.wire.some((l) => l.startsWith('-gdb-exit')), '不得因非致命错误拆掉 GDB 进程')
})

test('B2: 正常探针不产生非致命错误', async () => {
  const mock = createWireMock()
  const backend = makeBackend(mock)
  await backend.start({ targetSpec: { artifactPath: AXF, gdbPort: 3333 } })
  assert.equal(backend.lastNonFatalError, '')
  assert.ok(!mock.wire.some((l) => l.startsWith('-exec-interrupt')))
})
