import type { VisualizationComponent } from './workspace'

export type { VisualizationComponent }

export type VisualizationDocument = {
  schemaVersion: number
  columns?: number
  components: VisualizationComponent[]
}
