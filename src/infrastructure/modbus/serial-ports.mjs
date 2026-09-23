// @ts-check
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { runExecFile } from '../process/run-command.mjs'

const winRegExe = () => join(process.env.SystemRoot || process.env.windir || 'C:\\Windows', 'System32', 'reg.exe')

const COM_ID = /^COM(\d+)$/i
const UNIX_KEEP = /^(cu\.usb|cu\.wchusb|cu\.SLAB_USBtoUART|cu\.usbserial|cu\.usbmodem|ttyUSB|ttyACM)/

/**
 * @typedef {(bin: string, args: string[], opts: { timeoutMs?: number }) => Promise<{ stdout?: string }>} PortExec
 * @typedef {{ platform?: string, execFile?: PortExec, readdir?: (dir: string) => string[] }} SerialListOptions
 */

/**
 * @param {unknown} error
 * @returns {string}
 */
function thrownText(error) {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = /** @type {{ message?: unknown }} */ (error).message
    return String(message || error)
  }
  return String(error)
}

/** @param {Iterable<unknown>} ids */
const uniqSorted = (ids) => {
  const seen = new Set()
  const out = []
  for (const raw of ids) {
    const id = String(raw || '')
      .trim()
      .toUpperCase()
    if (!COM_ID.test(id) || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  out.sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)))
  return out
}

/** @param {unknown} port */
export const serialDevicePath = (port) => {
  const raw = String(port || '').trim()
  const prefixed = raw.match(/^\\\\\.\\COM(\d+)$/i)
  const plain = raw.match(COM_ID)
  const n = prefixed ? Number(prefixed[1]) : plain ? Number(plain[1]) : 0
  if (!n) return raw
  const id = 'COM' + n
  return n >= 10 ? '\\\\.\\' + id : id
}

/** @param {unknown} text */
export const parseRegSerialComm = (text) => {
  const ids = []
  for (const line of String(text || '').split(/\r?\n/)) {
    const hit = line.match(/REG_SZ\s+(COM\d+)\s*$/i)
    if (hit) ids.push(hit[1])
  }
  return uniqSorted(ids)
}

/** @param {unknown} text */
export const parseJsonStringList = (text) => {
  const raw = String(text || '').trim()
  if (!raw) return []
  try {
    const data = JSON.parse(raw)
    if (typeof data === 'string') return uniqSorted([data])
    if (Array.isArray(data)) return uniqSorted(data.map((item) => String(item)))
  } catch {
    /* line list */
  }
  return uniqSorted(
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => COM_ID.test(line)),
  )
}

/** @param {unknown} text @returns {Record<string, string>} */
export const parsePnpPortLabels = (text) => {
  /** @type {Record<string, string>} */
  const labels = {}
  const raw = String(text || '').trim()
  if (!raw) return labels
  let rows = []
  try {
    const data = JSON.parse(raw)
    rows = Array.isArray(data) ? data : data && typeof data === 'object' ? [data] : []
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

/** @param {Iterable<unknown> | null | undefined} names */
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

/**
 * @param {PortExec} execFileFn
 * @param {string} bin
 * @param {string[]} args
 * @param {number} timeoutMs
 */
const execOut = async (execFileFn, bin, args, timeoutMs) => {
  const ran = await execFileFn(bin, args, { timeoutMs })
  return String((ran && ran.stdout) || '')
}

/** @param {PortExec} execFileFn */
const listWindowsPorts = async (execFileFn) => {
  /** @type {string[]} */
  let ids = []
  try {
    ids = parseRegSerialComm(
      await execOut(execFileFn, winRegExe(), ['query', 'HKLM\\HARDWARE\\DEVICEMAP\\SERIALCOMM'], 4000),
    )
  } catch {
    ids = []
  }
  if (!ids.length) {
    try {
      ids = parseJsonStringList(
        await execOut(
          execFileFn,
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            '[System.IO.Ports.SerialPort]::GetPortNames() | ConvertTo-Json -Compress',
          ],
          5000,
        ),
      )
    } catch {
      ids = []
    }
  }
  return ids.map((id) => ({ path: id, label: id }))
}

/** @param {SerialListOptions} [opts] */
export const listSerialPorts = async (opts = {}) => {
  const plat = opts.platform || process.platform
  const execFileFn = opts.execFile || runExecFile
  try {
    if (plat === 'win32') return { ok: true, ports: await listWindowsPorts(execFileFn) }
    const names = opts.readdir ? opts.readdir('/dev') : readdirSync('/dev')
    return { ok: true, ports: listUnixPortsFromNames(names) }
  } catch (error) {
    return {
      ok: false,
      error: thrownText(error).slice(0, 200),
      ports: [],
    }
  }
}
