// @ts-check
// Emit journal + host notifications only from committed alarm transitions.
import { decodeValue } from '../../domain/modbus/point-math.mjs'
import { pointLabel } from '../../domain/modbus/point-model.mjs'
import { notifyBenchEvent } from '../../infrastructure/host/notify.mjs'
import { recordBenchEvent } from '../../infrastructure/store/journal-store.mjs'

/**
 * @param {any} home
 * @param {string} cwd
 * @param {{ fired?: any[], recovered?: any[] } | null | undefined} alarms
 * @returns {Promise<void>}
 */
export async function emitCommittedAlarmTransitions(home, cwd, alarms) {
  if (!alarms) return
  const fired = Array.isArray(alarms.fired) ? alarms.fired : []
  const recovered = Array.isArray(alarms.recovered) ? alarms.recovered : []
  if (fired.length) {
    const procFired = fired.filter((/** @type {any} */ f) => f.point)
    const commFired = fired.filter((/** @type {any} */ f) => f.connectionId && !f.point)
    if (procFired.length) {
      await recordBenchEvent(
        home,
        cwd,
        {
          action: 'alarm',
          ok: false,
          summary: `越限告警：${procFired
            .slice(0, 5)
            .map((/** @type {any} */ item) => {
              const limit = item.kind === 'max' ? item.point.alarmMax : item.point.alarmMin
              return `${pointLabel(item.point)}=${decodeValue(item.point, item.raw ?? item.alarm?.value)}${item.kind === 'max' ? `>${limit}` : `<${limit}`}`
            })
            .join('；')}`,
        },
        { source: 'system' },
      )
      void notifyBenchEvent(
        home,
        cwd,
        `Vision 告警：${procFired
          .slice(0, 3)
          .map((/** @type {any} */ item) => {
            const limit = item.kind === 'max' ? item.point.alarmMax : item.point.alarmMin
            return `${pointLabel(item.point)}=${decodeValue(item.point, item.raw ?? item.alarm?.value)}${item.kind === 'max' ? `>${limit}` : `<${limit}`}`
          })
          .join('；')}`,
      ).catch(() => {})
    }
    if (commFired.length) {
      await recordBenchEvent(
        home,
        cwd,
        {
          action: 'alarm',
          ok: false,
          summary: `通信告警：${commFired
            .slice(0, 3)
            .map((/** @type {any} */ c) => c.label || c.connectionId)
            .join('；')}`,
        },
        { source: 'system' },
      )
    }
  }
  if (recovered.length) {
    const procRec = recovered.filter((/** @type {any} */ r) => r.point)
    const commRec = recovered.filter((/** @type {any} */ r) => r.connectionId && !r.point)
    if (procRec.length) {
      await recordBenchEvent(
        home,
        cwd,
        {
          action: 'alarm-clear',
          ok: true,
          summary: `告警恢复：${procRec
            .slice(0, 5)
            .map((/** @type {any} */ item) => `${pointLabel(item.point)}=${decodeValue(item.point, item.raw ?? item.alarm?.value)}`)
            .join('；')}`,
        },
        { source: 'system' },
      )
    }
    if (commRec.length) {
      await recordBenchEvent(
        home,
        cwd,
        {
          action: 'alarm-clear',
          ok: true,
          summary: `通信恢复：${commRec
            .slice(0, 3)
            .map((/** @type {any} */ c) => c.connectionId)
            .join('；')}`,
        },
        { source: 'system' },
      )
    }
  }
}
