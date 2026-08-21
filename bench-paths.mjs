import { homedir } from 'node:os'
import { isAbsolute, parse, relative, resolve } from 'node:path'

export const pathInside = (root, file) => {
  if (!root || !file || !isAbsolute(root) || !isAbsolute(file)) return false
  const rel = relative(resolve(root), resolve(file))
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + '/') && !rel.startsWith('..\\') && !isAbsolute(rel))
}

export const isBroadCwd = (cwd, home = homedir()) => {
  if (!cwd || !isAbsolute(cwd)) return true
  const resolved = resolve(cwd)
  if (resolved === resolve(home)) return true
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
