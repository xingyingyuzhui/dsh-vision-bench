import type { VisualizationComponent } from './workspace'

export type { VisualizationComponent }

export type VisualizationDocument = {
  schemaVersion: number
  components: VisualizationComponent[]
}
