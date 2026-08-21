import { createHash } from 'node:crypto'
import { closeSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { pathInside, realPath, requireWorkspaceCwd } from './bench-paths.mjs'

const SKIP = new Set(['.git', '.svn', '.hg', 'node_modules', '.venv', 'venv', '__pycache__', '.dsh'])
const KEIL_EXT = new Set(['.uvprojx'])
export const ARTIFACTS = ['hex', 'bin', 'axf', 'elf']
const ARTIFACT_FILE = {
  hex: 'hex_file',
  bin: 'bin_file',
  axf: 'axf_file',
  elf: 'elf_file',
}

export const normalizeArtifact = (value) =>
  ARTIFACTS.indexOf(value) >= 0 ? value : 'hex'

export const pickArtifact = (details, wanted) => {
  const format = normalizeArtifact(wanted)
  const available = ARTIFACTS.filter((key) => details && details[ARTIFACT_FILE[key]])
  const path = details && details[ARTIFACT_FILE[format]] ? details[ARTIFACT_FILE[format]] : null
  return { wanted: format, path, available }
}

const extOf = (name) => {
  const i = String(name).lastIndexOf('.')
  return i >= 0 ? String(name).slice(i).toLowerCase() : ''
}

export const listWorkspaceDir = (cwd, requested) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const target = realPath(requested ? resolve(requested) : room.cwd)
  if (!pathInside(room.cwd, target)) {
    return { ok: false, error: '只能浏览当前工作区目录' }
  }
  let entries
  try {
    entries = readdirSync(target, { withFileTypes: true })
  } catch (error) {
    return { ok: false, error: '无法读取目录: ' + String((error && error.message) || error).slice(0, 200) }
  }
  const dirs = []
  const files = []
  for (const entry of entries) {
    const name = entry.name
    if (!name || name.startsWith('.')) continue
    const full = join(target, name)
    let real
    try {
      real = realpathSync(full)
    } catch {
      continue
    }
    if (!pathInside(room.cwd, real)) continue
    let isDir = false
    let isFile = false
    try {
      const st = statSync(real)
      isDir = st.isDirectory()
      isFile = st.isFile()
    } catch { continue }
    if (isDir) {
      if (SKIP.has(name)) continue
      dirs.push({ name, path: full })
    } else if (isFile && KEIL_EXT.has(extOf(name))) {
      files.push({ name, path: full, type: 'project' })
    }
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name))
  files.sort((a, b) => a.name.localeCompare(b.name))
  const parent = target === room.cwd ? null : dirname(target)
  return {
    ok: true,
    cwd: room.cwd,
    path: target,
    parent: parent && pathInside(room.cwd, parent) ? parent : null,
    dirs,
    files,
  }
}

export const LOG_TAIL_BYTES = 256 * 1024

export const readBuildLog = (home, logFile, tailBytes = LOG_TAIL_BYTES) => {
  const raw = String(logFile || '').trim()
  if (!raw) return { ok: false, error: '缺少日志路径' }
  const logsDir = realpathSync(join(home, 'vision-bench', 'logs'))
  let real
  try {
    real = realpathSync(raw)
  } catch {
    return { ok: false, error: '日志文件不存在' }
  }
  if (!pathInside(logsDir, real) || extOf(real) !== '.log') {
    return { ok: false, error: '只能读取台架编译日志' }
  }
  let stat
  try {
    stat = statSync(real)
  } catch {
    return { ok: false, error: '日志文件不可读' }
  }
  if (!stat.isFile()) return { ok: false, error: '不是日志文件' }
  const size = stat.size
  let content
  if (size <= tailBytes) {
    content = readFileSync(real, 'utf8')
  } else {
    const start = size - tailBytes
    const buf = Buffer.alloc(tailBytes)
    const fd = openSync(real, 'r')
    try {
      const read = readSync(fd, buf, 0, tailBytes, start)
      content = buf.toString('utf8', 0, read)
    } finally {
      closeSync(fd)
    }
  }
  return {
    ok: true,
    path: real,
    size,
    truncated: size > tailBytes,
    content: content.slice(-tailBytes),
  }
}

const HASH_FILE = 64 * 1024 * 1024

export const artifactInfo = (cwd, requested) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const raw = String(requested || '').trim()
  if (!raw) return { ok: false, error: '缺少产物路径' }
  let real
  try {
    real = realpathSync(raw)
  } catch {
    return { ok: false, error: '产物不存在' }
  }
  if (!pathInside(room.cwd, real)) {
    return { ok: false, error: '产物必须在工作区内' }
  }
  let stat
  try {
    stat = statSync(real)
  } catch {
    return { ok: false, error: '产物不可读' }
  }
  if (!stat.isFile()) return { ok: false, error: '不是固件文件' }
  if (stat.size > HASH_FILE) return { ok: true, path: real, name: basename(real), size: stat.size, mtime: stat.mtimeMs, sha256: '' }
  const hash = createHash('sha256')
  hash.update(readFileSync(real))
  return {
    ok: true,
    path: real,
    name: basename(real),
    size: stat.size,
    mtime: stat.mtimeMs,
    sha256: hash.digest('hex'),
  }
}
