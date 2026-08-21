import { existsSync, lstatSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { extname, isAbsolute, parse, relative, resolve } from 'node:path'

const KEIL_EXT = new Set(['.uvprojx', '.uvmpw'])

export const realPath = (file) => {
  try {
    return realpathSync(file)
  } catch {
    return resolve(file)
  }
}

export const pathInside = (root, file) => {
  if (!root || !file || !isAbsolute(root) || !isAbsolute(file)) return false
  const rel = relative(realPath(root), realPath(file))
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + '/') && !rel.startsWith('..\\') && !isAbsolute(rel))
}

export const isBroadCwd = (cwd, home = homedir()) => {
  if (!cwd || !isAbsolute(cwd)) return true
  const resolved = realPath(cwd)
  if (resolved === realPath(home)) return true
  const parsed = parse(resolved)
  if (resolved === parsed.root) return true
  const base = parsed.base.toLowerCase()
  if (base === 'users' || base === 'windows' || base === 'program files' || base === 'program files (x86)') return true
  return false
}

export const requireWorkspaceCwd = (cwd, home = homedir()) => {
  if (!cwd || typeof cwd !== 'string' || !isAbsolute(cwd.trim())) {
    return { error: '需要工作区目录（打开一个 Workspace 会话）' }
  }
  const resolved = resolve(cwd.trim())
  if (isBroadCwd(resolved, home)) {
    return { error: '拒绝在用户主目录或盘根上扫描/编译，请打开具体项目工作区' }
  }
  return { cwd: resolved }
}

export const requireKeilProject = (cwd, project) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return room
  if (!project || typeof project !== 'string' || !isAbsolute(project.trim())) {
    return { error: '工程必须是绝对路径' }
  }
  const raw = project.trim()
  if (!pathInside(room.cwd, raw)) return { error: '工程必须在当前工作区内' }
  if (!existsSync(raw)) return { error: '工程文件不存在' }
  let st
  try {
    st = lstatSync(raw)
  } catch {
    return { error: '工程文件不存在' }
  }
  if (st.isSymbolicLink() && !pathInside(room.cwd, realPath(raw))) {
    return { error: '工程必须在当前工作区内' }
  }
  let file
  try {
    file = statSync(raw)
  } catch {
    return { error: '工程文件不存在' }
  }
  if (!file.isFile()) return { error: '不是工程文件' }
  const real = realPath(raw)
  if (!pathInside(room.cwd, real)) return { error: '工程必须在当前工作区内' }
  if (!KEIL_EXT.has(extname(real).toLowerCase())) return { error: '需要 .uvprojx 或 .uvmpw' }
  return { cwd: room.cwd, project: raw }
}
