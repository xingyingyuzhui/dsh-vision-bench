// @ts-check
import {
  migrateVisualizationToV2,
  normalizeComponentLayout,
  normalizeVisualizationComponent,
  parseVisualizationLayoutItems,
  validateVisualizationComponent,
  visualizationSchemaGuard,
} from '../../../bench-visualization-model.mjs'
import { explicitId } from '../../domain/config/config-operation.mjs'

/**
 * @param {any} workspace
 * @param {any} op
 * @param {any} target
 * @param {any} value
 * @returns {any}
 */
export function applyVisualization(workspace, op, target, value) {
  const pack = workspace.modbus
  const guard = visualizationSchemaGuard(pack.visualization)
  if (!guard.ok) return { ok: false, errorCode: guard.errorCode, error: guard.error }
  const migrated = migrateVisualizationToV2(pack.visualization, pack.points)
  if (migrated && migrated.ok === false) return migrated
  const viz = /** @type {any} */ (migrated)
  const id = explicitId(target.visualizationId || value.visualizationId || value.id || value.component?.id)
  if (op === 'add') {
    const cand = normalizeVisualizationComponent({ ...(value.component || value), id: '' })
    const v = validateVisualizationComponent(cand, pack.points)
    if (!v.ok) return { ok: false, error: v.error, errorCode: 'VIZ_INVALID' }
    viz.components = viz.components.concat([cand])
    pack.visualization = viz
    return {
      ok: true,
      workspace,
      summary: `添加可视化 ${cand.id}`,
      changedIds: [cand.id],
      changedVisualizationIds: [cand.id],
      visualization: viz,
      component: cand,
    }
  }
  if (op === 'update') {
    if (!id) return { ok: false, errorCode: 'TARGET_REQUIRED', error: 'update 必须携带 visualizationId' }
    const idx = viz.components.findIndex((/** @type {any} */ c) => c.id === id)
    if (idx < 0) return { ok: false, error: `组件不存在: ${id}`, errorCode: 'VIZ_NOT_FOUND' }
    const raw = value.component || value
    if (explicitId(raw.id) && explicitId(raw.id) !== id) {
      return {
        ok: false,
        errorCode: 'VIZ_TARGET_MISMATCH',
        error: `component.id 与 visualizationId 不一致: ${raw.id} vs ${id}`,
      }
    }
    const cand = normalizeVisualizationComponent({ ...viz.components[idx], ...raw, id: viz.components[idx].id })
    const v = validateVisualizationComponent(cand, pack.points)
    if (!v.ok) return { ok: false, error: v.error, errorCode: 'VIZ_INVALID' }
    viz.components = viz.components.map((/** @type {any} */ c, /** @type {number} */ i) => (i === idx ? cand : c))
    pack.visualization = viz
    return {
      ok: true,
      workspace,
      summary: `更新可视化 ${id}`,
      changedIds: [id],
      changedVisualizationIds: [id],
      visualization: viz,
      component: cand,
    }
  }
  if (op === 'remove') {
    if (!id) return { ok: false, errorCode: 'TARGET_REQUIRED', error: 'remove 必须携带 visualizationId' }
    const idx = viz.components.findIndex((/** @type {any} */ c) => c.id === id)
    if (idx < 0) return { ok: false, error: `组件不存在: ${id}`, errorCode: 'VIZ_NOT_FOUND' }
    viz.components = viz.components.filter((/** @type {any} */ c) => c.id !== id)
    pack.visualization = viz
    return {
      ok: true,
      workspace,
      summary: `删除可视化 ${id}`,
      changedIds: [id],
      changedVisualizationIds: [id],
      visualization: viz,
    }
  }
  if (op === 'layout') {
    const parsed = parseVisualizationLayoutItems(value.items, viz.components)
    if (!parsed.ok) return parsed
    const layoutItems = parsed.ok ? parsed.items : []
    const byId = new Map(layoutItems.map((/** @type {any} */ row) => [row.id, row.layout]))
    /** @type {string[]} */
    const changed = []
    viz.components = viz.components.map((/** @type {any} */ c, /** @type {number} */ i) => {
      const nextLayout = byId.get(c.id)
      if (!nextLayout) return c
      changed.push(c.id)
      return normalizeVisualizationComponent({ ...c, layout: normalizeComponentLayout(nextLayout, i, c.type) }, i)
    })
    pack.visualization = viz
    return {
      ok: true,
      workspace,
      summary: `更新可视化布局 ${changed.length} 项`,
      changedIds: changed,
      changedVisualizationIds: changed,
      visualization: viz,
      layout: viz.components.map((/** @type {any} */ c) => ({ id: c.id, ...(c.layout || {}) })),
    }
  }
  return { ok: false, errorCode: 'UNKNOWN_OP', error: 'visualization op 必须是 add|update|remove|layout' }
}
