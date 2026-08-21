import { readdirSync } from 'node:fs'
import { runExecFile } from './bench-run.mjs'

const COM_ID = /^COM(\d+)$/i
const UNIX_KEEP = /^(cu\.usb|cu\.wchusb|cu\.SLAB_USBtoUART|cu\.usbserial|cu\.usbmodem|ttyUSB|ttyACM)/

const uniqSorted = (ids) => {
  const seen = new Set()
  const out = []
  for (const raw of ids) {
    const id = String(raw || '').trim().toUpperCase()
    if (!COM_ID.test(id) || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  out.sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)))
  return out
}

export const serialDevicePath = (port) => {
  const raw = String(port || '').trim()
  const prefixed = raw.match(/^\\\\\.\\COM(\d+)$/i)
  const plain = raw.match(COM_ID)
  const n = prefixed ? Number(prefixed[1]) : (plain ? Number(plain[1]) : 0)
  if (!n) return raw
  const id = 'COM' + n
  return n >= 10 ? '\\\\.\\' + id : id
}

export const parseRegSerialComm = (text) => {
  const ids = []
  for (const line of String(text || '').split(/\r?\n/)) {
    const hit = line.match(/REG_SZ\s+(COM\d+)\s*$/i)
    if (hit) ids.push(hit[1])
  }
  return uniqSorted(ids)
}

export const parseJsonStringList = (text) => {
  const raw = String(text || '').trim()
  if (!raw) return []
  try {
    const data = JSON.parse(raw)
    if (typeof data === 'string') return uniqSorted([data])
    if (Array.isArray(data)) return uniqSorted(data.map((item) => String(item)))
  } catch { /* line list */ }
  return uniqSorted(raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => COM_ID.test(line)))
}

export const parsePnpPortLabels = (text) => {
  const labels = {}
  const raw = String(text || '').trim()
  if (!raw) return labels
  let rows = []
  try {
    const data = JSON.parse(raw)
    rows = Array.isArray(data) ? data : (data && typeof data === 'object' ? [data] : [])
  } catch {
    return labels
  }
  for (const row of rows) {
    const name = String((row && (row.Name || row.FriendlyName || row.name)) || '').trim()
    const hit = name.match(/\((COM\d+)\)/i)
    if (!hit) continue
    labels[hit[1].toUpperCase()] = name
  }
  return labels
}

export const listUnixPortsFromNames = (names) => {
  const ports = []
  for (const name of names || []) {
    const base = String(name || '').replace(/^\/dev\//, '')
    if (!UNIX_KEEP.test(base)) continue
    ports.push({ path: '/dev/' + base, label: base })
  }
  ports.sort((a, b) => a.path.localeCompare(b.path))
  return ports
}

const labelOf = (id, pnp) => {
  const full = pnp[id]
  if (!full) return id
  const chip = full.replace(/\s*\(COM\d+\)\s*$/i, '').trim()
  return chip && chip !== id ? id + ' · ' + chip : id
}

const execOut = async (execFileFn, bin, args, timeoutMs) => {
  const ran = await execFileFn(bin, args, { timeoutMs })
  return String((ran && ran.stdout) || '')
}

const listWindowsPorts = async (execFileFn) => {
  let ids = []
  try {
    ids = parseRegSerialComm(await execOut(execFileFn, 'reg.exe', [
      'query', 'HKLM\\HARDWARE\\DEVICEMAP\\SERIALCOMM',
    ], 4000))
  } catch { ids = [] }
  if (!ids.length) {
    try {
      ids = parseJsonStringList(await execOut(execFileFn, 'powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-Command', '[System.IO.Ports.SerialPort]::GetPortNames() | ConvertTo-Json -Compress',
      ], 5000))
    } catch { ids = [] }
  }
  let pnp = {}
  try {
    pnp = parsePnpPortLabels(await execOut(execFileFn, 'powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-Command',
      "[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match '\\(COM\\d+\\)' } | Select-Object Name | ConvertTo-Json -Compress",
    ], 8000))
  } catch { pnp = {} }
  return ids.map((id) => ({ path: id, label: labelOf(id, pnp) }))
}

export const listSerialPorts = async (opts = {}) => {
  const plat = opts.platform || process.platform
  const execFileFn = opts.execFile || runExecFile
  try {
    if (plat === 'win32') return { ok: true, ports: await listWindowsPorts(execFileFn) }
    const names = opts.readdir
      ? opts.readdir('/dev')
      : readdirSync('/dev')
    return { ok: true, ports: listUnixPortsFromNames(names) }
  } catch (error) {
    return {
      ok: false,
      error: String((error && error.message) || error).slice(0, 200),
      ports: [],
    }
  }
}
