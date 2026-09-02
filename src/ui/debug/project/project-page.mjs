// Task5/0.19.3: 工程结构 facade — 实现见 project-workspace.mjs。
import { createProjectWorkspace } from './project-workspace.mjs'

export const TAB_MAP = 'dsh-vision-bench:project'

export function createMapView(React, t, post) {
  return createProjectWorkspace(React, t, post)
}
