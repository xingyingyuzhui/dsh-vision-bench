import { createHmiConnectionActions } from './hmi-connection-actions.mjs'
import { createHmiCoreActions } from './hmi-core-actions.mjs'
import { createHmiLiveActions } from './hmi-live-actions.mjs'
import { createHmiPointActions } from './hmi-point-actions.mjs'

/**
 * Page actions for HMI: compose core / connection / point / live factories.
 * Called each render with current hook state.
 */
export function createHmiActions(ctx) {
  const core = createHmiCoreActions(ctx)
  const connectionActions = createHmiConnectionActions(ctx, core)
  const pointActions = createHmiPointActions(ctx, core)
  const liveActions = createHmiLiveActions(ctx, core)
  return {
    ...core,
    ...connectionActions,
    ...pointActions,
    ...liveActions,
  }
}
