import { createInterface } from 'node:readline'
import { appendFileSync } from 'node:fs'

const write = (obj) => process.stdout.write(JSON.stringify(obj) + '\n')
const delayMs = Number(process.env.VISION_IO_DELAY_MS || 0)
const logPath = process.env.VISION_IO_OPLOG || ''
const pending = new Map()

const log = (row) => {
  if (!logPath) return
  try { appendFileSync(logPath, JSON.stringify(row) + '\n') } catch { /* ignore */ }
}

const sleep = (ms, signal) => new Promise((resolve) => {
  if (!ms) {
    resolve()
    return
  }
  const timer = setTimeout(resolve, ms)
  if (signal) {
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
  }
})

const handle = async (msg) => {
  const id = msg && msg.id
  if (!msg || msg.v !== 1) {
    write({ v: 1, id, ok: false, error: { code: 'PROTOCOL_VIOLATION', message: 'bad v' } })
    return
  }
  if (msg.op === 'health') {
    write({ v: 1, id, ok: true, data: { protocol: Number(process.env.VISION_IO_PROTOCOL || 1), tcp: true, rtu: true } })
    return
  }
  if (msg.op === 'shutdown') {
    write({ v: 1, id, ok: true, data: { stopped: true } })
    process.exit(0)
  }
  if (msg.op === 'cancel') {
    const ac = pending.get(String(msg.targetId || ''))
    if (ac) ac.abort()
    log({ op: 'cancel', targetId: msg.targetId })
    write({ v: 1, id, ok: true, data: { cancelled: true } })
    return
  }
  const ac = new AbortController()
  pending.set(id, ac)
  log({ op: msg.op, id, phase: 'accept' })
  await sleep(delayMs, ac.signal)
  if (ac.signal.aborted) {
    log({ op: msg.op, id, phase: 'cancelled' })
    write({ v: 1, id, ok: false, error: { code: 'CANCELLED', message: '已取消' }, transactionId: 'tx-' + id })
    pending.delete(id)
    return
  }
  if (msg.op === 'modbus.write') log({ op: 'write', id, values: msg.values, phase: 'exec' })
  write({
    v: 1,
    id,
    ok: true,
    data: msg.op === 'modbus.write' ? msg.values : [1],
    durationMs: delayMs,
    transactionId: 'tx-' + id,
    frames: { requestHex: '0103', responseHex: '0103', frameFormat: 'tcp-normalized' },
  })
  pending.delete(id)
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', (line) => {
  try { void handle(JSON.parse(line)) } catch {
    write({ v: 1, id: 'protocol', ok: false, error: { code: 'PROTOCOL_VIOLATION', message: 'bad json' } })
  }
})
