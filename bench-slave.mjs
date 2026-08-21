import { createServer } from 'node:net'
import { applyPointWrite, segmentCovering, simulateRaw } from './bench-points.mjs'

const servers = new Map()
const listenErrors = new Map()

const keyOf = (cwd, deviceId) => String(cwd) + ':' + String(deviceId)

const u16 = (buf, offset) => buf.readUInt16BE(offset)

const exception = (fc, code) => Buffer.from([fc | 0x80, code])

const bankOf = (device, fn, at) => {
  const values = new Map()
  const segments = Array.isArray(device.segments) ? device.segments : []
  for (const segment of segments) {
    if (Number(segment.function) !== fn) continue
    const recs = Array.isArray(device.values) ? device.values : []
    const raw = device.sim ? simulateRaw(segment, at) : null
    for (let i = 0; i < segment.count; i++) {
      const address = segment.address + i
      const rec = recs.find((item) => item.segmentId === segment.id && item.address === address)
      let value = 0
      if (raw) value = raw[i]
      else if (rec && rec.value !== null && rec.value !== undefined) value = rec.value
      values.set(address, value)
    }
  }
  return values
}

const readBits = (bank, addr, qty) => {
  const bytes = Math.ceil(qty / 8)
  const out = Buffer.alloc(2 + bytes)
  out[0] = 1
  out[1] = bytes
  for (let i = 0; i < qty; i++) {
    const on = bank.get(addr + i) ? 1 : 0
    if (on) out[2 + (i >> 3)] |= 1 << (i & 7)
  }
  return out
}

const readRegs = (bank, addr, qty, fc) => {
  const out = Buffer.alloc(2 + qty * 2)
  out[0] = fc
  out[1] = qty * 2
  for (let i = 0; i < qty; i++) {
    const n = Number(bank.get(addr + i) || 0) & 0xffff
    out.writeUInt16BE(n, 2 + i * 2)
  }
  return out
}

export const handlePdu = (device, pdu, at = Date.now(), onWrite = null) => {
  if (!pdu || pdu.length < 1) return exception(0, 1)
  const fc = pdu[0]
  if (fc === 5 || fc === 6) {
    if (pdu.length < 5) return exception(fc, 3)
    const addr = u16(pdu, 1)
    const raw = u16(pdu, 3)
    const value = fc === 5 ? (raw === 0xff00 ? 1 : raw === 0x0000 ? 0 : -1) : raw
    if (value < 0) return exception(fc, 3)
    return writePoints(device, fc, addr, [value], at, onWrite, raw)
  }
  if (fc === 15 || fc === 16) {
    if (pdu.length < 6) return exception(fc, 3)
    const addr = u16(pdu, 1)
    const qty = u16(pdu, 3)
    const byteCount = pdu[5]
    if (qty < 1) return exception(fc, 3)
    if (fc === 15 && qty > 1968) return exception(fc, 3)
    if (fc === 16 && qty > 123) return exception(fc, 3)
    if (byteCount !== (fc === 15 ? Math.ceil(qty / 8) : qty * 2)) return exception(fc, 3)
    if (pdu.length < 6 + byteCount) return exception(fc, 3)
    const values = []
    for (let i = 0; i < qty; i++) {
      if (fc === 15) values.push((pdu[6 + (i >> 3)] >> (i & 7)) & 1)
      else values.push(u16(pdu, 6 + i * 2))
    }
    return writePoints(device, fc, addr, values, at, onWrite, qty)
  }
  if (pdu.length < 5) return exception(fc, 3)
  const addr = u16(pdu, 1)
  const qty = u16(pdu, 3)
  if (qty < 1 || qty > 125) return exception(fc, 3)
  if (fc === 1 || fc === 2) return readBits(bankOf(device, fc, at), addr, qty)
  if (fc === 3 || fc === 4) return readRegs(bankOf(device, fc, at), addr, qty, fc)
  return exception(fc, 1)
}

const writePoints = (device, fc, address, values, at, onWrite, echoWord) => {
  const fn = fc === 5 || fc === 15 ? 1 : 3
  const segments = Array.isArray(device.segments) ? device.segments : []
  for (let i = 0; i < values.length; i++) {
    if (!segmentCovering(segments, fn, address + i)) return exception(fc, 2)
  }
  if (typeof onWrite === 'function') onWrite(fn, address, values, at)
  const out = Buffer.alloc(5)
  out[0] = fc
  out.writeUInt16BE(address, 1)
  out.writeUInt16BE(echoWord & 0xffff, 3)
  return out
}

const frameResponse = (trans, unit, pdu) => {
  const out = Buffer.alloc(7 + pdu.length)
  out.writeUInt16BE(trans, 0)
  out.writeUInt16BE(0, 2)
  out.writeUInt16BE(1 + pdu.length, 4)
  out[6] = unit
  pdu.copy(out, 7)
  return out
}

export const startDeviceSlave = (cwd, device, getDevice, onWrite = null) => {
  const id = keyOf(cwd, device.id)
  const host = device.host || '127.0.0.1'
  const port = Number(device.tcpPort) || 1502
  const prev = servers.get(id)
  if (prev && prev.dshHost === host && prev.dshPort === port && prev.listening) {
    prev.dshGet = getDevice
    prev.dshOnWrite = onWrite
    listenErrors.delete(id)
    return Promise.resolve({ ok: true, host, port, deviceId: device.id, reused: true })
  }
  if (prev) {
    try { prev.close() } catch { /* already closed */ }
    servers.delete(id)
  }
  const server = createServer((socket) => {
    let buf = Buffer.alloc(0)
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk])
      while (buf.length >= 8) {
        const len = buf.readUInt16BE(4)
        if (len < 2 || buf.length < 6 + len) break
        const trans = buf.readUInt16BE(0)
        const unit = buf[6]
        const pdu = buf.subarray(7, 6 + len)
        buf = buf.subarray(6 + len)
        const getter = server.dshGet || getDevice
        const current = (typeof getter === 'function' && getter()) || device
        const resp = handlePdu(current, pdu, Date.now(), server.dshOnWrite)
        socket.write(frameResponse(trans, unit, resp))
      }
    })
    socket.on('error', () => { /* drop */ })
  })
  server.dshHost = host
  server.dshPort = port
  server.dshGet = getDevice
  server.dshOnWrite = onWrite
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      listenErrors.delete(id)
      servers.set(id, server)
      resolve({ ok: true, host, port, deviceId: device.id })
    })
  })
}

export const stopDeviceSlave = (cwd, deviceId) => {
  const id = keyOf(cwd, deviceId)
  const server = servers.get(id)
  if (!server) return
  try { server.close() } catch { /* ignore */ }
  servers.delete(id)
  listenErrors.delete(id)
}

export const stopAllSlaves = () => {
  for (const server of servers.values()) {
    try { server.close() } catch { /* ignore */ }
  }
  servers.clear()
  listenErrors.clear()
}

export const withListenRuntime = (cwd, workspace) => {
  const modbus = workspace && workspace.modbus && typeof workspace.modbus === 'object' ? workspace.modbus : {}
  const devices = Array.isArray(modbus.devices) ? modbus.devices.map((item) => {
    if (item.role !== 'slave' || !item.listen) return { ...item, listening: false, listenError: '' }
    const id = keyOf(cwd, item.id)
    const server = servers.get(id)
    const listening = !!(server && server.listening)
    const err = listenErrors.get(id) || ''
    return { ...item, listening, listenError: listening ? '' : (err || '未监听') }
  }) : []
  const active = devices.find((item) => item.id === modbus.activeId) || devices[0]
  return {
    ...workspace,
    modbus: {
      ...modbus,
      devices,
      listening: !!(active && active.listening),
      listenError: active && active.listenError ? active.listenError : '',
    },
  }
}

export const syncDeviceSlaves = async (cwd, modbus, getModbus, onWrite = null) => {
  const devices = (modbus && Array.isArray(modbus.devices)) ? modbus.devices : []
  const want = new Set()
  const errors = []
  for (const device of devices) {
    if (device.role !== 'slave' || !device.listen || device.mode !== 'tcp') continue
    want.add(device.id)
    try {
      await startDeviceSlave(cwd, device, () => {
        const live = getModbus ? getModbus() : modbus
        const list = live && Array.isArray(live.devices) ? live.devices : []
        return list.find((item) => item.id === device.id) || device
      }, onWrite ? (fn, address, values, at) => onWrite(device.id, fn, address, values, at) : null)
      listenErrors.delete(keyOf(cwd, device.id))
    } catch (error) {
      const message = String((error && error.message) || error).slice(0, 180)
      listenErrors.set(keyOf(cwd, device.id), message)
      errors.push(message)
    }
  }
  for (const [id, server] of servers) {
    if (!String(id).startsWith(String(cwd) + ':')) continue
    const deviceId = id.slice(String(cwd).length + 1)
    if (want.has(deviceId)) continue
    try { server.close() } catch { /* ignore */ }
    servers.delete(id)
    listenErrors.delete(id)
  }
  return { ok: errors.length === 0, error: errors[0] || '', errors }
}

export const _internal = { handlePdu, servers, listenErrors, keyOf }
