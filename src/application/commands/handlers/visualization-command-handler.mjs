// @ts-check
import { normalizeModbus } from '../../../../bench-devices.mjs'
import { loadWorkspace } from '../../../../bench-store.mjs'
import { mutateConfig } from '../../config/config-mutation-service.mjs'

/**
 * @param {any} home
 * @param {any} args
 * @param {any} room
 * @param {any} origin
 * @param {any} opts
 * @returns {Promise<object | null>}
 */
export async function handleVisualizationCommand(home, args, room, origin, opts) {
  if (args?.action !== 'visualization') return null
  const action = args.action
  const pack = normalizeModbus(loadWorkspace(home, room.cwd).modbus)
  const cv = pack.configVersion || 1
  const viz = pack.visualization || { schemaVersion: 2, components: [] }
  if (viz.unsupported) {
    return {
      ok: false,
      action,
      errorCode: viz.errorCode || 'VIZ_SCHEMA_UNSUPPORTED',
      error: viz.error || '可视化 schema 只读',
    }
  }
  const op = String(args.op || 'list')
  const id = String(args.visualizationId || args.id || '').trim()
  const byId = new Map(pack.points.map((/** @type {any} */ x) => [x.id, x]))
  /** @param {any} comp */
  const degradedFor = (comp) =>
    (comp.pointIds || []).filter((/** @type {any} */ pid) => {
      const pt = byId.get(pid)
      return !pt || pt.monitorEnabled !== true
    })
  if (op === 'proposeAdd' || op === 'proposeUpdate' || op === 'proposeRemove' || op === 'draft') {
    return {
      ok: false,
      action,
      errorCode: 'OP_REMOVED',
      error: '配置草稿已移除；请用 visualization op=add|update|remove|layout 直接修改',
    }
  }
  if (op === 'list') {
    return {
      ok: true,
      action,
      visualization: viz,
      components: (viz.components || []).map((/** @type {any} */ c) => ({ ...c, degraded: degradedFor(c) })),
      configVersion: cv,
    }
  }
  if (op === 'get') {
    const comp = (viz.components || []).find((/** @type {any} */ c) => c.id === id)
    if (!comp) return { ok: false, error: `组件不存在: ${id}`, errorCode: 'VIZ_NOT_FOUND' }
    const { componentLatestValues } = await import('../../../../bench-trend.mjs')
    return {
      ok: true,
      action,
      component: comp,
      values: componentLatestValues(pack.values, pack.points, comp.pointIds),
      degraded: degradedFor(comp),
      configVersion: cv,
    }
  }
  if (op === 'add' || op === 'update' || op === 'remove' || op === 'layout') {
    const ran = await mutateConfig({
      home,
      cwd: room.cwd,
      source: origin.source,
      sessionId: origin.sessionId,
      expectedConfigVersion: args.expectedConfigVersion ?? args.configVersion,
      commandId: opts?.commandId,
      operation: `visualization.${op}`,
      target: { visualizationId: id },
      value: args.component || args,
    })
    return { action, ...ran }
  }
  return { ok: false, error: 'op 必须是 list | get | add | update | remove | layout', errorCode: 'UNKNOWN_OP' }
}
