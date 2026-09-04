// @ts-check

import { open, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, isAbsolute, parse, relative, resolve } from 'node:path'
import { keilErrorResult } from '../../domain/keil/errors.mjs'
import { DEFAULT_MAX_DEPTH, DEFAULT_MAX_RESULTS, MAX_SOURCE_BYTES } from '../../domain/keil/project-model.mjs'

const SKIP_DIRS = new Set(['.git', '.svn', '.hg', 'node_modules', '.venv', 'venv', '__pycache__'])

/**
 * Check if the path is a system-level or user-home root that is too broad to scan.
 * @param {string} rootPath
 * @returns {boolean}
 */
export function isBroadRoot(rootPath) {
  const resolved = resolve(rootPath)
  const home = resolve(homedir())
  if (resolved === home) return true

  const parsed = parse(resolved)
  if (resolved === parsed.root) return true

  const anchor = parsed.root
  const broadRoots = [
    resolve(anchor, 'Users'),
    resolve(anchor, 'home'),
    resolve(anchor, 'root'),
    resolve(anchor, 'Windows'),
    resolve(anchor, 'Program Files'),
    resolve(anchor, 'Program Files (x86)'),
  ]

  return broadRoots.some((b) => resolved.toLowerCase() === b.toLowerCase())
}

/**
 * Calculate directory depth relative to base.
 * @param {string} basePath
 * @param {string} currentPath
 * @returns {number}
 */
export function calculateDepth(basePath, currentPath) {
  const rel = relative(resolve(basePath), resolve(currentPath))
  if (!rel || rel === '.') return 0
  return rel.split(/[\\/]/).filter(Boolean).length
}

/**
 * Check whether targetPath is strictly inside or equal to rootPath (no directory traversal).
 * @param {string} rootPath
 * @param {string} targetPath
 * @returns {boolean}
 */
export function isInside(rootPath, targetPath) {
  try {
    const rel = relative(resolve(rootPath), resolve(targetPath))
    return !rel.startsWith('..') && !isAbsolute(rel)
  } catch {
    return false
  }
}

/**
 * Check if buffer content appears binary.
 * @param {Uint8Array} buffer
 * @returns {boolean}
 */
export function looksBinary(buffer) {
  if (!buffer || buffer.length === 0) return false
  if (buffer.includes(0)) return true
  let textish = 0
  for (let i = 0; i < buffer.length; i++) {
    const b = buffer[i]
    if ((b >= 32 && b < 127) || b === 9 || b === 10 || b === 13) {
      textish++
    }
  }
  return textish / buffer.length < 0.75
}

/**
 * Check if a file exists, is readable, and is plain text.
 * @param {string} filePath
 * @returns {Promise<[boolean, 'ok' | 'missing' | 'unreadable' | 'binary' | 'outside']>}
 */
export async function checkFileReadable(filePath) {
  let fileHandle
  try {
    const st = await stat(filePath)
    if (!st.isFile()) {
      return [false, 'missing']
    }
    fileHandle = await open(filePath, 'r')
    const buffer = Buffer.alloc(2048)
    const { bytesRead } = await fileHandle.read(buffer, 0, 2048, 0)
    const slice = buffer.subarray(0, bytesRead)
    if (looksBinary(slice)) {
      return [false, 'binary']
    }

    // Try decoding as UTF-8 or GBK
    for (const encoding of ['utf-8', 'gbk']) {
      try {
        const decoder = new TextDecoder(encoding, { fatal: true })
        decoder.decode(slice)
        return [true, 'ok']
      } catch {}
    }
    return [false, 'binary']
  } catch (err) {
    if (err && /** @type {any} */ (err).code === 'ENOENT') {
      return [false, 'missing']
    }
    return [false, 'unreadable']
  } finally {
    if (fileHandle) {
      await fileHandle.close().catch(() => {})
    }
  }
}

/**
 * Read source file up to MAX_SOURCE_BYTES with UTF-8 / GBK decoding fallback.
 * @param {string} filePath
 * @param {number} [maxBytes]
 * @returns {Promise<string>}
 */
export async function readSource(filePath, maxBytes = MAX_SOURCE_BYTES) {
  let fileHandle
  try {
    fileHandle = await open(filePath, 'r')
    const buffer = Buffer.alloc(maxBytes)
    const { bytesRead } = await fileHandle.read(buffer, 0, maxBytes, 0)
    const slice = buffer.subarray(0, bytesRead)

    for (const encoding of ['utf-8', 'gbk']) {
      try {
        const decoder = new TextDecoder(encoding, { fatal: true })
        return decoder.decode(slice)
      } catch {}
    }
    return ''
  } catch {
    return ''
  } finally {
    if (fileHandle) {
      await fileHandle.close().catch(() => {})
    }
  }
}

/**
 * Recursively search for .uvprojx files in root directory.
 * @param {string} root
 * @param {number} [maxResults]
 * @param {number} [maxDepth]
 * @returns {Promise<{ projects: Array<{ path: string, name: string, type: 'project' }>, error: any | null }>}
 */
export async function scanProjects(root, maxResults = DEFAULT_MAX_RESULTS, maxDepth = DEFAULT_MAX_DEPTH) {
  const rootPath = resolve(root)
  try {
    const st = await stat(rootPath)
    if (!st.isDirectory()) {
      return {
        projects: [],
        error: keilErrorResult('scan', 'root_not_found', `扫描根目录不存在或不是目录: ${rootPath}`),
      }
    }
  } catch {
    return {
      projects: [],
      error: keilErrorResult('scan', 'root_not_found', `扫描根目录不存在或不是目录: ${rootPath}`),
    }
  }

  if (isBroadRoot(rootPath)) {
    return {
      projects: [],
      error: keilErrorResult('scan', 'scan_scope_too_broad', `拒绝扫描过大目录: ${rootPath}`, {
        root: rootPath,
        next_actions: ['请把 --root 指向具体项目目录或 workspace，不要扫描盘根、用户主目录或系统目录。'],
      }),
    }
  }

  /** @type {Array<{ path: string, name: string, type: 'project' }>} */
  const projects = []
  /** @type {string[]} */
  const queue = [rootPath]

  while (queue.length > 0) {
    const currentDir = queue.shift()
    if (!currentDir) continue

    const currentDepth = calculateDepth(rootPath, currentDir)
    let entries = []
    try {
      entries = await readdir(currentDir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      const fullPath = resolve(currentDir, entry.name)
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && currentDepth < maxDepth) {
          queue.push(fullPath)
        }
      } else if (entry.isFile()) {
        if (extname(entry.name).toLowerCase() === '.uvprojx') {
          const stem = parse(entry.name).name
          projects.push({
            path: fullPath,
            name: stem,
            type: 'project',
          })
          if (projects.length > maxResults) {
            projects.sort((a, b) => a.path.localeCompare(b.path))
            const capped = projects.slice(0, maxResults)
            return {
              projects: capped,
              error: keilErrorResult(
                'scan',
                'too_many_projects',
                `发现超过 ${maxResults} 个 Keil 工程，请缩小扫描目录。`,
                {
                  root: rootPath,
                  count_at_least: projects.length,
                  max_results: maxResults,
                  projects: capped,
                },
              ),
            }
          }
        }
      }
    }
  }

  projects.sort((a, b) => a.path.localeCompare(b.path))
  return { projects, error: null }
}
