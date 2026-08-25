import { createInterface } from 'node:readline'

const write = (obj) => process.stdout.write(JSON.stringify(obj) + '\n')
let seq = 0
const owners = new Map()

const handle = async (msg) => {
  const id = msg && msg.id
  if (!msg || msg.v !== 1) {
    write({ v: 1, id, ok: false, error: { code: 'PROTOCOL_VIOLATION', message: 'bad v' } })
    return
  }
  if (msg.op === 'health') {
    write({ v: 1, id, ok: true, data: { protocol: 1, node: process.version, platform: process.platform, arch: process.arch, tcp: true, rtu: true, modbusSerial: 'fake', serialport: 'fake' } })
    return
  }
  if (msg.op === 'shutdown') {
    write({ v: 1, id, ok: true, data: { stopped: true } })
    process.exit(0)
  }
  if (msg.op === 'cancel') {
    write({ v: 1, id, ok: true, data: { cancelled: true } })
    return
  }
  if (msg.op === 'modbus.read' || msg.op === 'modbus.write') {
    if (Number(msg.unitId) === 0) {
      write({ v: 1, id, ok: false, error: { code: 'UNIT_ID_INVALID', message: 'Unit ID 必须是 1..247' } })
      return
    }
    const count = Number(msg.count || (msg.values && msg.values.length) || 1)
    const data = msg.op === 'modbus.read'
      ? Array.from({ length: count }, (_, i) => ((Number(msg.address) + i) + Number(msg.unitId) * 100) & 0xffff)
      : msg.values
    write({
      v: 1,
      id,
      ok: true,
      data,
      durationMs: 1,
      transactionId: 'fake:' + (++seq),
      frames: { requestHex: '010300000001', responseHex: '0103020001', frameFormat: msg.endpoint && msg.endpoint.mode === 'tcp' ? 'tcp-normalized' : 'rtu-adu' },
    })
    return
  }
  if (msg.op === 'connection.open') {
    const port = String((msg.endpoint && msg.endpoint.port) || msg.port || '').toUpperCase()
    const owner = owners.get(port)
    if (port && owner && owner !== msg.connectionId) {
      write({ v: 1, id, ok: false, error: { code: 'PORT_IN_USE', message: '串口被占用: ' + port } })
      return
    }
    if (port) owners.set(port, msg.connectionId)
    write({ v: 1, id, ok: true, data: { connectionId: msg.connectionId, port, state: 'connected', connectedAt: Date.now() } })
    return
  }
  if (msg.op === 'connection.status') {
    const connections = [...owners.entries()].map(([port, connectionId]) => ({ connectionId, port, state: 'connected' }))
    write({ v: 1, id, ok: true, data: msg.connectionId ? (connections.find((c) => c.connectionId === msg.connectionId) || { state: 'disconnected' }) : { connections } })
    return
  }
  if (msg.op === 'serial.capture.feed') {
    write({ v: 1, id, ok: true, data: { open: true, lines: [], lastId: 0, total: 0, port: '', state: 'connected' } })
    return
  }
  if (msg.op === 'connection.close' || msg.op === 'release') {
    for (const [port, cid] of owners) if (cid === msg.connectionId) owners.delete(port)
    write({ v: 1, id, ok: true, data: { state: 'disconnected', connectionId: msg.connectionId } })
    return
  }
  write({ v: 1, id, ok: false, error: { code: 'PROTOCOL_VIOLATION', message: 'unknown op' } })
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', (line) => {
  try { void handle(JSON.parse(line)) } catch {
    write({ v: 1, id: 'protocol', ok: false, error: { code: 'PROTOCOL_VIOLATION', message: 'bad json' } })
  }
})
