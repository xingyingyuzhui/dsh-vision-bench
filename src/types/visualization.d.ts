import type { VisualizationComponent } from './workspace'

export type { VisualizationComponent }

export type VisualizationLayoutBox = {
  x: number
  y: number
  w: number
  h: number
}

export type VisualizationDocument = {
  schemaVersion: number
  minimumPluginVersion?: string
  columns?: number
  components: VisualizationComponent[]
  unsupported?: boolean
  errorCode?: string
  error?: string
}

export type VisualizationLayoutItem = VisualizationLayoutBox & {
  id: string
}
