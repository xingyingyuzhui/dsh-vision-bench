// Aggregates UI CSS fragments from src/ui/styles/*.
import { BASE_CSS } from './src/ui/styles/base.mjs'
import { TYPOGRAPHY_CSS } from './src/ui/styles/typography.mjs'
import { FRAMES_CSS } from './src/ui/styles/frames.mjs'
import { HMI_CSS } from './src/ui/styles/hmi.mjs'
import { SIDEBAR_CSS } from './src/ui/styles/sidebar.mjs'
import { TABLE_CSS } from './src/ui/styles/table.mjs'
import { VISUALIZATION_CSS } from './src/ui/styles/visualization.mjs'
import { PROJECT_CSS } from './src/ui/styles/project.mjs'
import { RUNTIME_CSS } from './src/ui/styles/runtime.mjs'
import { WORKSPACE_CSS } from './src/ui/styles/workspace.mjs'

export { ATTR } from './src/ui/styles/base.mjs'

export const CSS = TYPOGRAPHY_CSS.concat(
  BASE_CSS,
  HMI_CSS,
  PROJECT_CSS,
  RUNTIME_CSS,
  SIDEBAR_CSS,
  VISUALIZATION_CSS,
  FRAMES_CSS,
  TABLE_CSS,
  WORKSPACE_CSS,
).join('\n')

