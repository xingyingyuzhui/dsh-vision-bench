import { createInterface } from 'node:readline'
import { appendFileSync } from 'node:fs'

const write = (obj) => process.stdout.write(JSON.stringify(obj) + '\n')
const logPath = process.env.VISION_IO_OPLOG || ''
const mode = process.env.VISION_IO_TIMEOUT_MODE === 'stuck' ? 'stuck' : 'reply'
const pending = new Map()

const log = (row) => {
  if (!logPath) return
  try {
    appendFileSync(logPath, JSON.stringify(row) + '\n')
  } catch {
    /* ignore */
  }
}

const sleep = (ms, signal) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          resolve()
        },
        { once: true },
      )
    }
  })

const handle = async (msg) => {
  const id = msg && msg.id
  if (!msg || msg.v !== 1) {
    write({ v: 1, id, ok: false, error: { code: 'PROTOCOL_VIOLATION', message: 'bad v' } })
    return
  }
  if (msg.op === 'health') {
    write({ v: 1, id, ok: true, data: { protocol: 1, tcp: true, rtu: true } })
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
  const timeoutMs = Math.max(50, Math.trunc(Number(msg.timeoutMs) || 80))
  // Reply just after the shared deadline. A broker timer with no grace wins
  // this race and cancels; the grace window lets the driver report first.
  const waitMs = mode === 'stuck' ? 20000 : timeoutMs + 200
  await sleep(waitMs, ac.signal)
  pending.delete(id)
  if (ac.signal.aborted) {
    write({ v: 1, id, ok: false, error: { code: 'CANCELLED', message: '已取消' } })
    return
  }
  write({
    v: 1,
    id,
    ok: false,
    error: { code: 'MODBUS_TIMEOUT', message: '驱动超时' },
    durationMs: timeoutMs,
  })
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', (line) => {
  try {
    void handle(JSON.parse(line))
  } catch {
    write({ v: 1, id: 'protocol', ok: false, error: { code: 'PROTOCOL_VIOLATION', message: 'bad json' } })
  }
})
