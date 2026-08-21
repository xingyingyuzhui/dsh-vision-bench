import { clampInt, normalizeSegments, normalizeValues, text } from './bench-points.mjs'

export const MAX_DEVICES = 8

export const newDeviceId = () =>
  'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

export const emptyPolling = () => ({
  enabled: false,
  intervalMs: 1000,
  lastAt: 0,
  lastOk: true,
  error: '',
})

export const emptyDevice = (input = {}) => {
  const role = input.role === 'slave' ? 'slave' : 'master'
  const pollingIn = input.polling && typeof input.polling === 'object' ? input.polling : {}
  return {
    id: text(input.id, newDeviceId()),
    name: text(input.name, role === 'slave' ? '从机' : '主机').slice(0, 40),
    role,
    mode: input.mode === 'tcp' || (role === 'slave' && input.mode !== 'rtu') ? 'tcp' : (input.mode === 'rtu' ? 'rtu' : 'rtu'),
    port: typeof input.port === 'string' ? input.port.trim() : '',
    baudrate: clampInt(input.baudrate, 9600, 1200, 921600),
    host: typeof input.host === 'string' ? input.host.trim() : (role === 'slave' ? '127.0.0.1' : ''),
    tcpPort: clampInt(input.tcpPort, role === 'slave' ? 1502 : 502, 1, 65535),
    slave: clampInt(input.slave, 1, 1, 247),
    timeoutSec: clampInt(input.timeoutSec, 1, 1, 30),
    function: [1, 2, 3, 4].indexOf(Number(input.function)) >= 0 ? Number(input.function) : 3,
    address: clampInt(input.address, 0, 0, 65535),
    count: clampInt(input.count, 1, 1, 125),
    sim: input.sim === true,
    listen: input.listen === true,
    segments: normalizeSegments(input.segments),
    values: normalizeValues(input.values),
    polling: {
      enabled: pollingIn.enabled === true,
      intervalMs: clampInt(pollingIn.intervalMs, 1000, 200, 10000),
      lastAt: clampInt(pollingIn.lastAt, 0, 0, Number.MAX_SAFE_INTEGER),
      lastOk: pollingIn.lastOk !== false,
      error: typeof pollingIn.error === 'string' ? pollingIn.error.slice(0, 180) : '',
    },
  }
}

export const flattenDevice = (device) => ({
  id: device.id,
  name: device.name,
  role: device.role,
  mode: device.mode,
  port: device.port,
  baudrate: device.baudrate,
  host: device.host,
  tcpPort: device.tcpPort,
  slave: device.slave,
  timeoutSec: device.timeoutSec,
  function: device.function,
  address: device.address,
  count: device.count,
  sim: device.sim,
  listen: device.listen,
  segments: device.segments,
  values: device.values,
  polling: device.polling,
})

const legacyUsed = (raw) => !!(
  raw.sim
  || raw.listen
  || (Array.isArray(raw.segments) && raw.segments.length)
  || raw.port
  || raw.host
  || (raw.polling && raw.polling.enabled)
)

export const normalizeModbus = (input) => {
  const raw = input && typeof input === 'object' ? input : {}
  let devices
  if (Array.isArray(raw.devices) && raw.devices.length > 0) {
    devices = raw.devices.map((item) => emptyDevice(item)).slice(0, MAX_DEVICES)
  } else if (legacyUsed(raw)) {
    devices = [emptyDevice({ ...raw, name: raw.name || '设备1', role: raw.role === 'slave' ? 'slave' : 'master' })]
  } else {
    devices = []
  }
  let activeId = text(raw.activeId, '')
  if (!devices.some((item) => item.id === activeId)) activeId = devices[0] ? devices[0].id : ''
  const active = devices.find((item) => item.id === activeId) || emptyDevice({ role: 'master', name: '主机' })
  return {
    activeId,
    devices,
    ...flattenDevice(active),
  }
}

export const activeDevice = (modbus) => {
  const pack = normalizeModbus(modbus)
  return pack.devices.find((item) => item.id === pack.activeId) || pack.devices[0] || emptyDevice({ role: 'master' })
}

export const patchActiveDevice = (modbus, patch) => {
  const pack = normalizeModbus(modbus)
  if (!pack.devices.length) {
    const created = emptyDevice({ ...patch, role: (patch && patch.role) || 'master' })
    return normalizeModbus({ devices: [created], activeId: created.id })
  }
  const devices = pack.devices.map((item) => (
    item.id === pack.activeId ? emptyDevice({ ...item, ...patch, id: item.id }) : item
  ))
  return normalizeModbus({ devices, activeId: pack.activeId })
}

export const addDevice = (modbus, spec) => {
  const pack = normalizeModbus(modbus)
  if (pack.devices.length >= MAX_DEVICES) {
    return { ok: false, error: '设备数量已达上限', modbus: pack }
  }
  const device = emptyDevice(spec)
  const devices = pack.devices.concat([device])
  return { ok: true, device, modbus: normalizeModbus({ devices, activeId: device.id }) }
}

export const removeDevice = (modbus, id) => {
  const pack = normalizeModbus(modbus)
  const devices = pack.devices.filter((item) => item.id !== id)
  const activeId = pack.activeId === id ? (devices[0] ? devices[0].id : '') : pack.activeId
  return normalizeModbus({ devices, activeId })
}

export const recipePair = () => {
  const master = emptyDevice({
    name: '控制板',
    role: 'master',
    mode: 'tcp',
    host: '127.0.0.1',
    tcpPort: 1503,
    slave: 1,
    sim: true,
    segments: [{ name: '控制', function: 3, address: 0, count: 10 }],
  })
  const slave = emptyDevice({
    name: '采集板',
    role: 'slave',
    mode: 'tcp',
    host: '127.0.0.1',
    tcpPort: 1502,
    slave: 1,
    sim: true,
    listen: true,
    segments: [{ name: '采集', function: 3, address: 0, count: 10 }],
  })
  return normalizeModbus({ devices: [master, slave], activeId: master.id })
}

export const compactDevices = (modbus) =>
  normalizeModbus(modbus).devices.map((item) => ({
    id: item.id,
    name: item.name,
    role: item.role,
    mode: item.mode,
    host: item.host,
    port: item.port,
    tcpPort: item.tcpPort,
    slave: item.slave,
    sim: item.sim,
    listen: item.listen,
    segments: item.segments.length,
  }))
