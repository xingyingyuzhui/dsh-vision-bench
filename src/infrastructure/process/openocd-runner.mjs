// @ts-check
import { runExecFile } from '../../../bench-run.mjs'
import { FLASH_ERROR_CODES } from '../../domain/flash/errors.mjs'
import { resolveOpenOcdProfile } from '../../domain/flash/openocd-profile.mjs'

const FLASH_TIMEOUT_MS = 150000
const PROBE_TIMEOUT_MS = 10000
const OUTPUT_TAIL = 4000
const OPENOCD_IDENTITY = /Open On-Chip Debugger/i
const OPENOCD_SHUTDOWN = /shutdown command invoked/i
const OPENOCD_VERIFIED = /\bverified\b/i
const OPENOCD_WROTE_BYTES = /wrote\s+\d+\s+bytes/i
const OPENOCD_PROGRAMMED = /\bprogrammed\b/i

/** @param {string} text */
const hasControlChars = (text) => {
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) < 32) return true
  }
  return false
}

/** @param {any} ran */
const combinedOutput = (ran) => String(`${ran?.stdout || ''}\n${ran?.stderr || ''}`)

/** @param {unknown} text */
const lastLine = (text) =>
  String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .pop() || ''

/** @param {unknown} text */
const firstLine = (text) =>
  String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)[0] || ''

/**
 * Encode a Tcl word with double quotes. `{` `}` `;` stay literal; `" $ [ ]` are escaped.
 * @param {unknown} value
 * @returns {{ ok: true, encoded: string } | { ok: false, error: string }}
 */
export function encodeOpenOcdTclWord(value) {
  const raw = String(value || '')
  if (!raw) return { ok: false, error: '缺少参数' }
  if (hasControlChars(raw)) return { ok: false, error: '路径含有非法控制字符' }
  const normalized = raw.replace(/\\/g, '/')
  const escaped = normalized.replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/\[/g, '\\[').replace(/\]/g, '\\]')
  return { ok: true, encoded: `"${escaped}"` }
}

/**
 * Encode a firmware path for `program <word> verify reset exit`.
 * @param {unknown} filePath
 * @returns {{ ok: true, encoded: string } | { ok: false, error: string }}
 */
export function encodeOpenOcdTclPath(filePath) {
  const raw = String(filePath || '')
  if (!raw) return { ok: false, error: '缺少固件路径' }
  return encodeOpenOcdTclWord(raw)
}

/**
 * @param {{
 *   interfaceName?: string,
 *   target?: string,
 *   firmware?: string,
 * }} spec
 * @returns {{ ok: true, args: string[] } | { ok: false, error: string, errorCode?: string }}
 */
export function buildOpenOcdArgs(spec) {
  const profile = resolveOpenOcdProfile({
    interfaceName: spec?.interfaceName,
    target: spec?.target,
  })
  if (!profile.ok) return profile
  const encoded = encodeOpenOcdTclPath(spec?.firmware)
  if (!encoded.ok) return encoded
  return {
    ok: true,
    args: [
      '-f',
      `interface/${profile.interfaceName}.cfg`,
      '-f',
      `target/${profile.target}.cfg`,
      '-c',
      `program ${encoded.encoded} verify reset exit`,
    ],
  }
}

/**
 * @param {unknown} openocd
 * @param {{ runExecFile?: typeof runExecFile, timeoutMs?: number, signal?: AbortSignal }} [deps]
 */
export async function probeOpenOcdExecutable(openocd, deps = {}) {
  const bin = String(openocd || '')
  if (!bin) {
    return { ok: false, errorCode: 'OPENOCD_NOT_FOUND', error: '缺少 OpenOCD 路径', versionLine: '', output: '' }
  }
  const exec = deps.runExecFile || runExecFile
  try {
    const ran = await exec(bin, ['--version'], {
      timeoutMs: deps.timeoutMs || PROBE_TIMEOUT_MS,
      signal: deps.signal,
      maxBuffer: 1024 * 1024,
    })
    const fullOutput = combinedOutput(ran)
    const output = fullOutput.slice(-OUTPUT_TAIL)
    if (ran.cancelled) {
      return {
        ok: false,
        cancelled: true,
        errorCode: FLASH_ERROR_CODES.OPENOCD_PROBE_CANCELLED,
        error: 'OpenOCD 探测已取消',
        versionLine: '',
        output,
      }
    }
    if (ran.timedOut) {
      return {
        ok: false,
        errorCode: FLASH_ERROR_CODES.OPENOCD_PROBE_TIMEOUT,
        error: 'OpenOCD 探测超时',
        versionLine: firstLine(fullOutput),
        output,
      }
    }
    if (Number(ran.exitCode) !== 0) {
      return {
        ok: false,
        errorCode: FLASH_ERROR_CODES.OPENOCD_PROBE_FAILED,
        error: 'OpenOCD --version 失败',
        exitCode: ran.exitCode,
        versionLine: firstLine(fullOutput),
        output,
      }
    }
    if (!OPENOCD_IDENTITY.test(fullOutput)) {
      return {
        ok: false,
        errorCode: FLASH_ERROR_CODES.OPENOCD_IDENTITY_INVALID,
        error: '绑定的程序不是 OpenOCD',
        versionLine: firstLine(fullOutput),
        output,
      }
    }
    return {
      ok: true,
      errorCode: undefined,
      error: '',
      versionLine: firstLine(fullOutput),
      output,
    }
  } catch (error) {
    const message = String((error && /** @type {any} */ (error).message) || error)
    const notFound = /无法启动|ENOENT|not found/i.test(message)
    return {
      ok: false,
      errorCode: notFound ? FLASH_ERROR_CODES.OPENOCD_NOT_FOUND : FLASH_ERROR_CODES.OPENOCD_PROBE_FAILED,
      error: message,
      versionLine: '',
      output: message.slice(-OUTPUT_TAIL),
    }
  }
}

/** @param {string} output */
const hasProgramEvidence = (output) =>
  OPENOCD_VERIFIED.test(output) || OPENOCD_WROTE_BYTES.test(output) || OPENOCD_PROGRAMMED.test(output)

/**
 * @param {any} ran
 * @param {{ timeoutMs?: number }} [opts]
 */
export function parseOpenOcdResult(ran, opts = {}) {
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : FLASH_TIMEOUT_MS
  const timeoutSec = Math.round(timeoutMs / 1000)
  if (!ran) {
    return {
      ok: false,
      errorCode: FLASH_ERROR_CODES.FLASH_FAILED,
      error: 'OpenOCD 无结果',
      exitCode: 1,
      summary: '烧录失败',
      details: { output: '' },
    }
  }
  const fullOutput = combinedOutput(ran)
  const outputTail = fullOutput.slice(-OUTPUT_TAIL)
  if (ran.cancelled) {
    return {
      ok: false,
      cancelled: true,
      timedOut: false,
      errorCode: FLASH_ERROR_CODES.FLASH_CANCELLED,
      exitCode: ran.exitCode,
      summary: '烧录已取消',
      details: { output: outputTail },
      error: '已取消',
    }
  }
  if (ran.timedOut) {
    return {
      ok: false,
      cancelled: false,
      timedOut: true,
      errorCode: FLASH_ERROR_CODES.FLASH_TIMEOUT,
      exitCode: ran.exitCode,
      summary: '烧录超时',
      details: { output: outputTail },
      error: `烧录超时（${timeoutSec}s）`,
    }
  }
  if (Number(ran.exitCode) !== 0) {
    return {
      ok: false,
      cancelled: false,
      timedOut: false,
      errorCode: FLASH_ERROR_CODES.FLASH_FAILED,
      exitCode: ran.exitCode,
      summary: '烧录失败',
      details: { output: outputTail },
      error: lastLine(fullOutput) || 'OpenOCD 失败',
    }
  }
  const identified = OPENOCD_IDENTITY.test(fullOutput)
  const shutdown = OPENOCD_SHUTDOWN.test(fullOutput)
  const programmed = hasProgramEvidence(fullOutput)
  if (!identified || !shutdown || !programmed) {
    return {
      ok: false,
      cancelled: false,
      timedOut: false,
      errorCode: FLASH_ERROR_CODES.FLASH_RESULT_UNVERIFIED,
      exitCode: 0,
      summary: '烧录结果无法确认',
      details: { output: outputTail },
      error: 'OpenOCD 输出缺少烧录成功证据',
    }
  }
  return {
    ok: true,
    cancelled: false,
    timedOut: false,
    exitCode: 0,
    summary: '烧录完成',
    details: { output: outputTail },
  }
}

/**
 * @param {{
 *   openocd: string,
 *   interfaceName: string,
 *   target: string,
 *   firmware: string,
 *   cwd?: string,
 *   timeoutMs?: number,
 *   signal?: AbortSignal,
 * }} spec
 * @param {{ runExecFile?: typeof runExecFile }} [deps]
 */
export async function runOpenOcdFlash(spec, deps = {}) {
  const built = buildOpenOcdArgs(spec)
  if (!built.ok) {
    return {
      ...built,
      cancelled: false,
      timedOut: false,
      exitCode: 1,
      details: { output: '' },
      summary: built.error,
    }
  }
  const timeoutMs = spec.timeoutMs || FLASH_TIMEOUT_MS
  const probe = await probeOpenOcdExecutable(spec.openocd, {
    runExecFile: deps.runExecFile,
    signal: spec.signal,
  })
  if (!probe.ok) {
    if (probe.cancelled) {
      return {
        ok: false,
        cancelled: true,
        timedOut: false,
        exitCode: probe.exitCode,
        errorCode: FLASH_ERROR_CODES.FLASH_CANCELLED,
        error: '已取消',
        summary: '烧录已取消',
        details: { output: probe.output || '' },
      }
    }
    return {
      ok: false,
      cancelled: false,
      timedOut: probe.errorCode === FLASH_ERROR_CODES.OPENOCD_PROBE_TIMEOUT,
      exitCode: probe.exitCode || 1,
      errorCode: probe.errorCode,
      error: probe.error,
      summary: probe.error,
      details: { output: probe.output || '' },
    }
  }
  const exec = deps.runExecFile || runExecFile
  try {
    const ran = await exec(spec.openocd, built.args, {
      cwd: spec.cwd,
      timeoutMs,
      signal: spec.signal,
      maxBuffer: 1024 * 1024,
    })
    return parseOpenOcdResult(ran, { timeoutMs })
  } catch (error) {
    const message = String((error && /** @type {any} */ (error).message) || error)
    return {
      ok: false,
      cancelled: false,
      timedOut: false,
      exitCode: 1,
      errorCode: /无法启动|ENOENT/i.test(message)
        ? FLASH_ERROR_CODES.OPENOCD_NOT_FOUND
        : FLASH_ERROR_CODES.FLASH_FAILED,
      summary: '无法启动 OpenOCD',
      details: { output: message.slice(-OUTPUT_TAIL) },
      error: message,
    }
  }
}
