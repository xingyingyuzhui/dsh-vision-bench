// Single CSS registration entry — fragments live beside this module.
import { BASE_CSS, ATTR } from './base.mjs'
import { TYPOGRAPHY_CSS } from './typography.mjs'
import { FRAMES_CSS } from './frames.mjs'
import { HMI_CSS } from './hmi.mjs'
import { SIDEBAR_CSS } from './sidebar.mjs'
import { TABLE_CSS } from './table.mjs'
import { VISUALIZATION_CSS } from './visualization.mjs'
import { PROJECT_CSS } from './project.mjs'
import { RUNTIME_CSS } from './runtime.mjs'
import { WORKSPACE_CSS } from './workspace.mjs'

export { ATTR }

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
