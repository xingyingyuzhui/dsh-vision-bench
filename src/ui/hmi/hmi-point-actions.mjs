import { createHmiPointBatchActions } from './hmi-point-batch-actions.mjs'
import { createHmiPointCsvActions } from './hmi-point-csv-actions.mjs'
import { createHmiPointDraftActions } from './hmi-point-draft-actions.mjs'
import { createHmiPointFlagActions } from './hmi-point-flag-actions.mjs'

/** Point table, flags, drafts, and CSV actions. */
export function createHmiPointActions(ctx, core) {
  const draftActions = createHmiPointDraftActions(ctx, core)
  const batchActions = createHmiPointBatchActions(ctx, core, {
    pointsOfDevice: draftActions.pointsOfDevice,
  })
  const flagActions = createHmiPointFlagActions(ctx, core)
  const csvActions = createHmiPointCsvActions(ctx, core)

  return {
    ...draftActions,
    ...batchActions,
    ...flagActions,
    ...csvActions,
  }
}
