import { capabilitiesFromHealth } from './bench-io-capability.mjs'
import { IO_RUNTIME_PACKAGES } from './bench-io-contract.mjs'
import { createModbusTransport } from './bench-modbus-transport.mjs'
import { requireWorkspaceCwd } from './bench-paths.mjs'
import { runExecFile } from './bench-run.mjs'
import { listSerialPorts } from './bench-serial.mjs'
import { loadBindings, loadWorkspace, probeBindings } from './bench-store.mjs'
import { describeHostBridge, pingVisionHost } from './src/infrastructure/host/vision-host-client.mjs'

const firstLine = (text) =>
  String(text || '')
    .split('\n')
    .filter(Boolean)[0] || ''

export const runSelfCheck = async (home, cwd) => {
  const checks = []
  const push = (name, ok, detail = '') => {
    checks.push({ name, ok: !!ok, detail: String(detail || '').slice(0, 120) })
  }

  const bindings = loadBindings(home)
  const health = probeBindings(bindings)
  push('bind-python', health.python.bound && health.python.exists, bindings.python || 'Keil 工程脚本（可选）')
  push('bind-uv4', health.uv4.bound && health.uv4.exists, bindings.uv4 || '未绑定')
  push(
    'bind-openocd',
    health.openocd.bound && health.openocd.exists,
    bindings.openocd || '烧录兼容项，将在 0.20.0 移除',
  )

  if (health.python.bound && health.python.exists) {
    const ver = await runExecFile(bindings.python, ['--version'], { timeoutMs: 10000 })
    push('python-runs', ver.exitCode === 0, firstLine(ver.stdout || ver.stderr))
  }
  if (health.uv4.bound && health.uv4.exists) push('uv4-file', true, bindings.uv4)
  if (health.openocd.bound && health.openocd.exists) {
    const oc = await runExecFile(bindings.openocd, ['--version'], { timeoutMs: 10000 })
    const out = oc.stderr || oc.stdout
    push('openocd-runs', oc.exitCode === 0 || /open (on-chip )?debugger/i.test(out), firstLine(out))
  }

  let ioHealth = { tcp: false, rtu: false, modbusSerial: '', serialport: '', rtuError: '', tcpError: '' }
  try {
    const transport = createModbusTransport()
    const ran = await transport.health()
    const data = ran && ran.data ? ran.data : {}
    ioHealth = {
      tcp: !!data.tcp,
      rtu: !!data.rtu,
      modbusSerial: data.modbusSerial || '',
      serialport: data.serialport || '',
      rtuError: data.rtuError || '',
      tcpError: data.tcpError || '',
    }
    push(
      'io-runtime',
      !!(ran && ran.ok),
      (ioHealth.modbusSerial || IO_RUNTIME_PACKAGES.modbusSerial) +
        ' / ' +
        (ioHealth.serialport || IO_RUNTIME_PACKAGES.serialport),
    )
  } catch (error) {
    push('io-runtime', false, String((error && error.message) || error))
  }

  if (cwd) {
    const room = requireWorkspaceCwd(cwd)
    if (room.error) push('workspace', false, room.error)
    else {
      const ws = loadWorkspace(home, room.cwd)
      push('workspace', true, room.cwd + ' · 工程 ' + (ws.keil.project ? '已选' : '未选'))
    }
  } else {
    push('workspace', false, '无工作区会话')
  }

  try {
    const ports = await listSerialPorts()
    const count = Array.isArray(ports && ports.ports) ? ports.ports.length : 0
    push('serial-scan', true, count + ' 个串口')
  } catch (error) {
    push('serial-scan', false, String((error && error.message) || error))
  }

  const caps = capabilitiesFromHealth(ioHealth)
  const capabilities = {
    modbusTcp: {
      ready: caps.modbusTcp === 'ready',
      reason: caps.modbusTcp === 'ready' ? '' : ioHealth.tcpError || 'I/O 运行时不可用',
    },
    modbusRtu: {
      ready: caps.modbusRtu === 'ready',
      reason: caps.modbusRtu === 'ready' ? '' : ioHealth.rtuError || 'serialport native binding 不可用',
    },
    serialMonitor: {
      ready: caps.serialMonitor === 'ready',
      reason: caps.serialMonitor === 'ready' ? '' : ioHealth.rtuError || 'serialport native binding 不可用',
    },
    keilProject: {
      ready: !!(health.python.bound && health.python.exists),
      reason: health.python.bound ? '' : '未绑定 Python',
    },
    keilBuild: { ready: !!(health.uv4.bound && health.uv4.exists), reason: health.uv4.bound ? '' : '未绑定 UV4' },
    openocdFlash: {
      ready: !!(health.openocd.bound && health.openocd.exists),
      reason:
        health.openocd.bound && health.openocd.exists
          ? '0.20.0 将迁移为内置运行时'
          : '未绑定 OpenOCD（0.20.0 将改为内置运行时）',
    },
  }
  const bridge = describeHostBridge()
  const t0 = Date.now()
  const ping = await pingVisionHost({ cwd: cwd || '', timeoutMs: 3000 })
  const roundtripMs = Number.isFinite(ping.roundtripMs) ? ping.roundtripMs : Date.now() - t0
  const transport = ping.data?.transport || (bridge.inProcess ? '同进程' : 'HTTP')
  push(
    'host-bridge',
    ping.ok === true,
    ping.ok
      ? `${transport} · ${ping.origin || bridge.origin} · ${roundtripMs}ms`
      : `${ping.errorCode || 'HOST_UNAVAILABLE'} · ${ping.error || 'Host 探活失败'} · ${roundtripMs}ms`,
  )
  const ioReady = capabilities.modbusTcp.ready || capabilities.modbusRtu.ready
  const requiredOk = ioReady && ping.ok === true
  return {
    ok: requiredOk,
    requiredOk,
    checks,
    capabilities,
    hostBridge: {
      available: ping.ok === true,
      origin: ping.origin || bridge.origin,
      inProcess: bridge.inProcess,
      transport: ping.data?.transport || (bridge.inProcess ? 'in-process' : 'http'),
      roundtripMs,
      errorCode: ping.ok ? undefined : ping.errorCode,
      error: ping.ok ? undefined : ping.error,
      data: ping.data,
    },
    at: Date.now(),
  }
}
