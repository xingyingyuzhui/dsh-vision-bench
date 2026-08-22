import { listWorkspaceDir } from './bench-fs.mjs'
import { requireWorkspaceCwd } from './bench-paths.mjs'

export const listDir = (cwd, path) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  return listWorkspaceDir(room.cwd, path || room.cwd)
}
