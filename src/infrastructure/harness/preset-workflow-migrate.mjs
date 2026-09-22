/**
 * Rewrite obsolete DSH workflow-worker-thread rows to workflow-ptc.
 * Cordis `cordis:group` stores children under `config:` as a YAML sequence.
 */

/** @deprecated Removed in DSH 0.1.6-alpha; standard now ships `dsh-workflow-ptc`. */
export const OBSOLETE_WORKFLOW_WORKER = '@deepseek-ai/dsh-workflow-worker-thread'
export const CURRENT_WORKFLOW_PTC = '@deepseek-ai/dsh-workflow-ptc'

/**
 * @param {any} seq YAML sequence node with `.items`
 * @returns {boolean} whether any node was rewritten
 */
export function migrateObsoleteWorkflowWorkerRows(seq) {
  if (!seq || !Array.isArray(seq.items)) return false
  let changed = false
  const visit = (items) => {
    if (!Array.isArray(items)) return
    for (const item of items) {
      if (!item || typeof item.get !== 'function') continue
      const id = item.get('id')
      const name = item.get('name')
      if (
        id === 'workflow-worker-thread' ||
        name === OBSOLETE_WORKFLOW_WORKER ||
        (typeof name === 'string' && name.includes('dsh-workflow-worker-thread'))
      ) {
        if (typeof item.set === 'function') {
          item.set('id', 'workflow-ptc')
          item.set('name', CURRENT_WORKFLOW_PTC)
          changed = true
        }
      }
      if (name === 'cordis:group' || name === 'cordis:plugin-group') {
        const cfg = item.get('config')
        if (cfg && Array.isArray(cfg.items)) visit(cfg.items)
        else if (cfg && typeof cfg.get === 'function') {
          const plugins = cfg.get('plugins')
          if (plugins && Array.isArray(plugins.items)) visit(plugins.items)
        }
      }
    }
  }
  visit(seq.items)
  return changed
}
