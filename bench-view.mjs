// Compatibility facade: registers Vision view slots and delegates debug UI to submodules.
// Maintains 100% backward compatibility for existing callers and test suites.

import { NS } from './bench-i18n.mjs'

export { formatResult, agentNote } from './src/ui/debug/keil/format-result.mjs'
export { createDebugView } from './src/ui/debug/debug-view.mjs'

export function registerView(ctx, React, t, DebugPage, HmiPage, MonitorPage) {
  const slots = ctx.slots
  if (slots == null || React == null) return function () {}
  const stopDebug = slots.inject('conversation.view', function () {
    return slots.register(
      {
        name: 'conversation.view',
        id: 'vision-bench-debug',
        order: 20,
        locale: NS,
        label() {
          return t('tabDebug')
        },
      },
      DebugPage,
    )
  })
  const stopHmi = slots.inject('conversation.view', function () {
    return slots.register(
      {
        name: 'conversation.view',
        id: 'vision-bench-hmi',
        order: 21,
        locale: NS,
        label() {
          return t('tabHmi')
        },
      },
      HmiPage,
    )
  })
  const stopMonitor =
    MonitorPage &&
    slots.inject('conversation.view', function () {
      return slots.register(
        {
          name: 'conversation.view',
          id: 'vision-bench-monitor',
          order: 22,
          locale: NS,
          label() {
            return t('tabMonitor')
          },
        },
        MonitorPage,
      )
    })
  return function () {
    if (typeof stopDebug === 'function') stopDebug()
    if (typeof stopHmi === 'function') stopHmi()
    if (typeof stopMonitor === 'function') stopMonitor()
  }
}
