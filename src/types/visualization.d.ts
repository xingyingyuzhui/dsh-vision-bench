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
  columns?: number
  components: VisualizationComponent[]
}

export type VisualizationLayoutItem = VisualizationLayoutBox & {
  id: string
}
