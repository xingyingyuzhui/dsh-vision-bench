const PACKAGES = { modbusSerial: '8.0.25', serialport: '13.0.0' }

export const idleIoSnapshot = () => ({
  state: 'idle',
  pid: 0,
  protocol: 1,
  packages: { ...PACKAGES },
  capabilities: {
    modbusTcp: 'unknown',
    modbusRtu: 'unknown',
    serialMonitor: 'unknown',
  },
  lastError: null,
})

export const capabilitiesFromHealth = (data) => {
  const tcp = data && data.tcp === true
    ? 'ready'
    : (data && (data.tcp === false || data.tcpError) ? 'unavailable' : 'unknown')
  const rtu = data && data.rtu === true
    ? 'ready'
    : (data && (data.rtu === false || data.rtuError) ? 'unavailable' : 'unknown')
  return {
    modbusTcp: tcp,
    modbusRtu: rtu,
    serialMonitor: rtu,
  }
}

const capOf = (ioRuntime, key) => {
  const caps = ioRuntime && ioRuntime.capabilities ? ioRuntime.capabilities : {}
  const value = caps[key]
  return value === 'ready' || value === 'unavailable' || value === 'unknown' ? value : 'unknown'
}

export const canUseModbus = (ioRuntime, connectionMode, opts = {}) => {
  if (opts.simulated) return true
  const key = connectionMode === 'tcp' ? 'modbusTcp' : 'modbusRtu'
  return capOf(ioRuntime, key) !== 'unavailable'
}

export const canUseSerialMonitor = (ioRuntime) => capOf(ioRuntime, 'serialMonitor') !== 'unavailable'

export const ioRuntimeStatus = (ioRuntime, connectionMode) => {
  const state = ioRuntime && ioRuntime.state ? ioRuntime.state : 'idle'
  const key = connectionMode === 'tcp' ? 'modbusTcp' : (connectionMode === 'raw' ? 'serialMonitor' : 'modbusRtu')
  const value = capOf(ioRuntime, key)
  if (value === 'unavailable' || state === 'unhealthy') {
    return { kind: 'missing', labelKey: 'ioUnavailable', value: 'unavailable' }
  }
  if (value === 'ready' && state === 'ready') {
    return { kind: 'ready', labelKey: 'ioReady', value: 'ready' }
  }
  return { kind: 'unbound', labelKey: 'ioPending', value: 'unknown' }
}
