import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createVisionIoBroker } from '../../bench-io-broker.mjs'
import { IO_PROTOCOL_V } from '../../src/domain/modbus/io-contract.mjs'

const workerPath = fileURLToPath(new URL('../../runtime/vision-io-worker.mjs', import.meta.url))
const fakeWorker = fileURLToPath(new URL('../fixtures/fake-io-worker.mjs', import.meta.url))

function holdServer() {
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => {
      socket.resume()
    })
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({ server, port: address && typeof address === 'object' ? address.port : 0 })
    })
  })
}

function readLine(stream) {
  return new Promise((resolve, reject) => {
    let buf = ''
    const onData = (chunk) => {
      buf += chunk
      const nl = buf.indexOf('\n')
      if (nl < 0) return
      stream.off('data', onData)
      resolve(buf.slice(0, nl))
    }
    stream.on('data', onData)
    stream.once('error', reject)
  })
}

test('worker exits 0 within 2s after stdin closes while a port is held', async (t) => {
  const { server, port } = await holdServer()
  t.after(() => server.close())
  const proc = spawn(process.execPath, [workerPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  proc.stderr.resume()
  t.after(() => proc.kill('SIGKILL'))
  proc.stdin.write(
    JSON.stringify({
      v: IO_PROTOCOL_V,
      id: 'open-1',
      op: 'connection.open',
      cwd: '/tmp/a',
      connectionId: 'c1',
      endpoint: { mode: 'tcp', host: '127.0.0.1', tcpPort: port },
    }) + '\n',
  )
  const line = await readLine(proc.stdout)
  const opened = JSON.parse(line)
  assert.equal(opened.ok, true, opened.error && opened.error.message)
  const exit = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('worker still running 2s after stdin closed')), 2000)
    proc.once('exit', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })
  proc.stdin.end()
  assert.equal(await exit, 0)
})

test('broker stdin error does not escape as an unhandled exception', async () => {
  /** @type {import('node:stream').Writable | null} */
  let stdin = null
  const broker = createVisionIoBroker({
    workerPath: fakeWorker,
    onWorker(proc) {
      stdin = proc.stdin
    },
  })
  try {
    const health = await broker.health()
    assert.equal(health.ok, true, health.error && health.error.message)
    assert.ok(stdin)
    assert.doesNotThrow(() => {
      stdin.emit('error', Object.assign(new Error('EPIPE'), { code: 'EPIPE' }))
    })
  } finally {
    await broker.stop()
  }
})
