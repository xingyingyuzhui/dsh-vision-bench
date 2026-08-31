import { createHmiView } from './bench-hmi.mjs'
import { COPY, NS, interpolate, tWith } from './bench-i18n.mjs'
import { createSettingsPage, registerSettings } from './bench-settings.mjs'
import { getActiveScope, subscribeFocus } from './bench-shared.mjs'
import { ATTR, CSS } from './bench-styles.mjs'
import { registerView } from './bench-view.mjs'
import { wrapVisionPage } from './src/ui/workspace/vision-page-boundary.mjs'
import { navigate } from './src/ui/workspace/vision-navigation-store.mjs'
import { MONITOR_SECTIONS, VIEW_HMI, VIEW_MONITOR, shouldRouteFocus } from './src/ui/workspace/vision-route.mjs'
import { createDebugWorkspace } from './src/ui/workspace/debug-workspace.mjs'
import { createMonitorWorkspace } from './src/ui/workspace/monitor-workspace.mjs'

export function apply(ctx) {
  const React = require('react')
  const slots = ctx.get('slots')
  if (slots == null || React == null) return

  const doc = typeof document === 'undefined' ? null : document
  let styleTag = null
  if (doc && doc.head) {
    styleTag = doc.createElement('style')
    styleTag.setAttribute(ATTR, '')
    // Task1/0.18.1: append official uPlot CSS (injected by build as DvbVendorCss)
    styleTag.textContent = CSS + (typeof DvbVendorCss === 'string' ? '\n' + DvbVendorCss : '')
    doc.head.appendChild(styleTag)
    doc.body.setAttribute(ATTR, '')
  }

  let localeDispose = function () {}
  try {
    if (ctx.locale && typeof ctx.locale.register === 'function') {
      localeDispose = ctx.locale.register(NS, COPY) || function () {}
    }
  } catch {
    /* remount */
  }

  function t(key, params) {
    return interpolate(tWith(ctx, key, params), params)
  }

  function post(path, payload, timeoutMs) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-DSH-Vision-Bench': '1' },
      body: JSON.stringify(payload || {}),
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs || 15000),
    }).then((res) =>
      res.json().then((data) => {
        if (!res.ok) throw new Error((data && data.error) || 'http ' + res.status)
        return data
      }),
    )
  }

  function selectView(viewId) {
    try {
      const slotsApi = ctx.get ? ctx.get('slots') : null
      if (slotsApi && typeof slotsApi.select === 'function') slotsApi.select('conversation.view', viewId)
    } catch {}
  }

  function openHmi(target) {
    const cwd = getActiveScope().cwd
    navigate('', cwd, { viewId: VIEW_HMI, section: '', target: target || {} })
    selectView(VIEW_HMI)
  }

  function openFrames() {
    const cwd = getActiveScope().cwd
    navigate('', cwd, { viewId: VIEW_MONITOR, section: MONITOR_SECTIONS.FRAMES })
    selectView(VIEW_MONITOR)
  }

  const SettingsPage = createSettingsPage(React, t, post)
  const DebugWorkspace = wrapVisionPage(React, createDebugWorkspace(React, t, post), 'debug')
  const HmiView = wrapVisionPage(React, createHmiView(React, t, post), 'hmi')
  const MonitorWorkspace = wrapVisionPage(
    React,
    createMonitorWorkspace(React, t, post, { openHmi, openFrames }),
    'monitor',
  )
  const stopSettings = registerSettings(ctx, React, t, SettingsPage)
  const stopView = registerView(ctx, React, t, DebugWorkspace, HmiView, MonitorWorkspace)

  let lastRouteKey = ''
  const applyFocus = (fs, changedCwd) => {
    const active = getActiveScope()
    const decision = shouldRouteFocus({
      activeCwd: active.cwd,
      changedCwd,
      focus: fs,
      previousRouteKey: lastRouteKey,
    })
    if (!decision.route) return
    lastRouteKey = decision.routeKey
    const sessionId = (fs && (fs.sessionId || (fs.request && fs.request.sessionId))) || ''
    navigate(sessionId, active.cwd, decision)
    selectView(decision.viewId)
  }
  const focusUnsub = subscribeFocus('', (fs, cwd) => applyFocus(fs, cwd))

  ctx.effect(() => {
    return function () {
      try {
        focusUnsub()
      } catch {}
      localeDispose()
      if (typeof stopSettings === 'function') stopSettings()
      if (typeof stopView === 'function') stopView()
      if (styleTag != null) styleTag.remove()
      if (doc) doc.body.removeAttribute(ATTR)
    }
  })
}
