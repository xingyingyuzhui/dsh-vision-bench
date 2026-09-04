// @ts-check
import { existsSync, readFileSync, statSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, resolve } from 'node:path'
import { XMLParser } from 'fast-xml-parser'
import { runExecFile } from '../../../bench-run.mjs'
import { ERRORLEVEL_MAP, MAX_ERROR_LINES, MAX_EXCERPT_CHARS, UV4_TIMEOUT_SEC } from '../../domain/keil/build-result.mjs'
import { buildEnv, toolchainBins } from './uv4-env.mjs'
import { pickTarget, readOutputOptions } from './uvprojx-parser.mjs'

export const ERROR_LINE =
  /(error:|\berror\s+#|\*\*\*\s*error|createprocess failed|undefined symbol|target not created)/i
export const AFTER_BUILD = /user command|after[-\s]?build|running user program/i
export const COUNT_LINE = /(\d+)\s+Error\(s\)\s*,\s*(\d+)\s+Warning\(s\)/
export const SIZE_LINE = /Program Size:\s+Code=(\d+)\s+RO-data=(\d+)\s+RW-data=(\d+)\s+ZI-data=(\d+)/

/**
 * Decodes a log buffer supporting UTF-8 (with optional BOM) and GBK.
 *
 * @param {Uint8Array} raw
 * @returns {string}
 */
export function decodeLogBuffer(raw) {
  if (!raw || raw.length === 0) return ''
  let buf = raw
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    buf = buf.subarray(3)
  }
  for (const enc of ['utf-8', 'gbk']) {
    try {
      const decoder = new TextDecoder(enc, { fatal: true })
      return decoder.decode(buf)
    } catch {
      /* try next encoding */
    }
  }
  const fallback = new TextDecoder('utf-8', { fatal: false })
  return fallback.decode(buf)
}

/**
 * Reads log file text with multi-encoding support.
 *
 * @param {string} logPath
 * @returns {Promise<string>}
 */
export async function readLogText(logPath) {
  try {
    const raw = await readFile(logPath)
    return decodeLogBuffer(raw)
  } catch {
    return ''
  }
}

/**
 * Classifies log output into errors, warnings, phase and metrics.
 * Parity with runtime/keil_build.py classify_log.
 *
 * @param {string} content
 * @returns {{
 *   metrics: {
 *     errors: number,
 *     warnings: number,
 *     compile_errors: number,
 *     after_build_errors: number,
 *     flash_bytes: number,
 *     ram_bytes: number,
 *   },
 *   errors: string[],
 *   compile_errors: string[],
 *   after_build_errors: string[],
 *   phase: 'ok' | 'compile' | 'after_build',
 *   excerpt: string,
 * }}
 */
export function classifyLog(content) {
  const lines = String(content || '').split(/\r?\n/)
  const afterAt = lines.findIndex((line) => AFTER_BUILD.test(line))
  /** @type {string[]} */
  const compileErrs = []
  /** @type {string[]} */
  const afterErrs = []

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].trim()
    if (!text || !ERROR_LINE.test(text)) continue
    const item = text.slice(0, 240)
    if (afterAt !== -1 && i >= afterAt) {
      afterErrs.push(item)
    } else {
      compileErrs.push(item)
    }
  }

  const metrics = {
    errors: 0,
    warnings: 0,
    compile_errors: compileErrs.length,
    after_build_errors: afterErrs.length,
    flash_bytes: 0,
    ram_bytes: 0,
  }

  /** @type {RegExpExecArray | null} */
  let countMatch = null
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = COUNT_LINE.exec(lines[i])
    if (m) {
      countMatch = m
      break
    }
  }

  if (countMatch) {
    metrics.errors = Number.parseInt(countMatch[1], 10)
    metrics.warnings = Number.parseInt(countMatch[2], 10)
  } else {
    metrics.errors = compileErrs.length + afterErrs.length
  }

  const sizeMatch = SIZE_LINE.exec(content)
  if (sizeMatch) {
    const codeSize = Number.parseInt(sizeMatch[1], 10)
    const roData = Number.parseInt(sizeMatch[2], 10)
    const rwData = Number.parseInt(sizeMatch[3], 10)
    const ziData = Number.parseInt(sizeMatch[4], 10)
    metrics.flash_bytes = codeSize + roData + rwData
    metrics.ram_bytes = rwData + ziData
  }

  const errors = compileErrs.concat(afterErrs).slice(0, MAX_ERROR_LINES)
  const excerpt = lines.slice(-60).join('\n').slice(0, MAX_EXCERPT_CHARS)

  /** @type {'ok' | 'compile' | 'after_build'} */
  let phase = 'ok'
  if (afterErrs.length > 0 && compileErrs.length === 0) {
    phase = 'after_build'
  } else if (compileErrs.length > 0) {
    phase = 'compile'
  }

  return {
    metrics,
    errors,
    compile_errors: compileErrs.slice(0, MAX_ERROR_LINES),
    after_build_errors: afterErrs.slice(0, MAX_ERROR_LINES),
    phase,
    excerpt,
  }
}

/**
 * Discovers built build artifacts (.axf, .elf, .hex, .bin) from Keil project.
 * Parity with runtime/keil_build.py collect_artifacts.
 *
 * @param {string} projectPath
 * @param {string} [target]
 * @returns {Record<string, string>}
 */
export function collectArtifacts(projectPath, target = '') {
  if (!projectPath || extname(projectPath).toLowerCase() !== '.uvprojx') {
    return {}
  }
  let xmlData
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      trimValues: true,
      parseTagValue: false,
    })
    const raw = readFileSync(projectPath, 'utf8')
    xmlData = parser.parse(raw)
  } catch {
    return {}
  }

  const targetMatch = pickTarget(xmlData, target)
  if (!targetMatch) return {}
  const targetNode = targetMatch.targetNode

  const { outputDirectory: rawDir = '', outputName: rawName = '' } = readOutputOptions(targetNode)
  const normalizedRawDir = String(rawDir || '').replace(/\\/g, '/')
  const projectDir = dirname(resolve(projectPath))
  const outputDir = normalizedRawDir
    ? isAbsolute(normalizedRawDir)
      ? normalizedRawDir
      : resolve(projectDir, normalizedRawDir)
    : projectDir

  const outputName = rawName || basename(projectPath, extname(projectPath))

  /** @type {Record<string, string>} */
  const details = {}
  /** @type {Array<[string, string]>} */
  const candidates = [
    ['.axf', 'axf_file'],
    ['.elf', 'elf_file'],
    ['.hex', 'hex_file'],
    ['.bin', 'bin_file'],
  ]

  for (const [suffix, key] of candidates) {
    const candidatePath = resolve(outputDir, `${outputName}${suffix}`)
    try {
      if (existsSync(candidatePath) && statSync(candidatePath).isFile()) {
        details[key] = candidatePath
      }
    } catch {
      /* ignore */
    }
  }

  const debugFile = details.elf_file || details.axf_file || ''
  if (debugFile) details.debug_file = debugFile

  const flashFile = details.hex_file || details.bin_file || debugFile || ''
  if (flashFile) details.flash_file = flashFile

  try {
    if (existsSync(outputDir)) {
      details.output_dir = resolve(outputDir)
    }
  } catch {
    /* ignore */
  }

  return details
}

/**
 * Executes Keil UV4 build directly from Node.
 * Parity with runtime/keil_build.py run_build.
 *
 * @param {{
 *   uv4: string,
 *   project: string,
 *   target?: string,
 *   logDir: string,
 *   taskId?: string,
 *   signal?: AbortSignal,
 *   runExec?: typeof runExecFile,
 * }} options
 * @returns {Promise<{
 *   ok: boolean,
 *   cancelled?: boolean,
 *   timedOut?: boolean,
 *   error?: string,
 *   result: any,
 *   exitCode?: number,
 * }>}
 */
export async function runUv4Build(options) {
  const { uv4, project, target = '', logDir, taskId = '', signal, runExec = runExecFile } = options

  const projectPath = resolve(project)
  if (!existsSync(projectPath)) {
    return {
      ok: false,
      error: `工程文件不存在: ${projectPath}`,
      result: {
        status: 'error',
        action: 'build',
        error: { code: 'project_not_found', message: `工程文件不存在: ${projectPath}` },
      },
    }
  }

  if (!existsSync(uv4)) {
    return {
      ok: false,
      error: `UV4.exe 不存在: ${uv4}`,
      result: {
        status: 'error',
        action: 'build',
        error: { code: 'uv4_not_found', message: `UV4.exe 不存在: ${uv4}` },
      },
    }
  }

  await mkdir(logDir, { recursive: true })
  const logName = taskId
    ? `${taskId}.log`
    : `${basename(projectPath, extname(projectPath))}-${(target || 'default').replace(/\s+/g, '_')}-build.log`
  const logFile = resolve(logDir, logName)

  /** @type {string[]} */
  const cmd = ['-b', projectPath, '-j0', '-o', logFile]
  if (target) {
    cmd.push('-t', target)
  }

  let ran
  try {
    ran = await runExec(uv4, cmd, {
      cwd: dirname(projectPath),
      env: buildEnv(uv4),
      timeoutMs: UV4_TIMEOUT_SEC * 1000,
      signal,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      error: msg,
      result: {
        status: 'error',
        action: 'build',
        error: { code: 'exec_error', message: msg },
      },
    }
  }

  if (ran.cancelled) {
    return {
      ok: false,
      cancelled: true,
      error: '已取消',
      exitCode: ran.exitCode,
      result: {
        status: 'error',
        action: 'build',
        error: { code: 'cancelled', message: '已取消' },
      },
    }
  }

  if (ran.timedOut) {
    return {
      ok: false,
      timedOut: true,
      error: `UV4.exe 执行超时(${UV4_TIMEOUT_SEC}s)`,
      exitCode: ran.exitCode,
      result: {
        status: 'error',
        action: 'build',
        error: { code: 'timeout', message: `UV4.exe 执行超时(${UV4_TIMEOUT_SEC}s)` },
      },
    }
  }

  const logContent = await readLogText(logFile)
  const parsed = classifyLog(logContent)
  const metrics = parsed.metrics

  const exitCode = typeof ran.exitCode === 'number' ? ran.exitCode : 0
  const failed = exitCode >= 2 || metrics.compile_errors > 0 || metrics.after_build_errors > 0 || metrics.errors > 0
  const status = failed ? 'error' : 'ok'

  const levelInfo = ERRORLEVEL_MAP[exitCode]
  let desc = levelInfo ? levelInfo.desc : `未知返回码: ${exitCode}`
  let code = 'build_failed'
  let summary = ''

  if (parsed.phase === 'after_build') {
    desc = '后处理失败（编译/链接已通过）'
    code = 'after_build_failed'
    summary = `后处理失败，after_build=${metrics.after_build_errors} warnings=${metrics.warnings}`
  } else if (parsed.phase === 'compile') {
    desc = '编译/链接失败'
    code = 'compile_failed'
    summary = `编译/链接失败，errors=${metrics.errors} warnings=${metrics.warnings}`
  } else {
    code = 'build_failed'
    summary = `build ${status === 'ok' ? '成功' : '失败'}，errors=${metrics.errors} warnings=${metrics.warnings}`
  }

  if (parsed.errors.length > 0) {
    summary += `；${parsed.errors[0]}`
  }

  const artifacts = collectArtifacts(projectPath, target)

  /** @type {Record<string, any>} */
  const details = {
    project: projectPath,
    target,
    task_id: taskId,
    log_file: logFile,
    errorlevel: exitCode,
    errorlevel_desc: desc,
    phase: parsed.phase,
    errors: parsed.errors,
    compile_errors: parsed.compile_errors,
    after_build_errors: parsed.after_build_errors,
    excerpt: parsed.excerpt,
    path_extra: toolchainBins(uv4),
    ...artifacts,
  }

  /** @type {Record<string, any>} */
  const resultData = {
    status,
    action: 'build',
    summary,
    metrics,
    details,
  }

  if (status === 'error') {
    resultData.error = { code, message: desc }
  }

  return {
    ok: status === 'ok',
    exitCode,
    result: resultData,
    error: status === 'error' ? desc : undefined,
  }
}
