// Aggregates UI CSS fragments from src/ui/styles/*.
import { BASE_CSS } from './src/ui/styles/base.mjs'
import { FRAMES_CSS } from './src/ui/styles/frames.mjs'
import { HMI_CSS } from './src/ui/styles/hmi.mjs'
import { SIDEBAR_CSS } from './src/ui/styles/sidebar.mjs'
import { VISUALIZATION_CSS } from './src/ui/styles/visualization.mjs'

export { ATTR } from './src/ui/styles/base.mjs'

export const CSS = BASE_CSS.concat(HMI_CSS, SIDEBAR_CSS, VISUALIZATION_CSS, FRAMES_CSS).join('\n')
