import { createVisionRpcPost } from '../../infrastructure/host/vision-rpc-client.mjs'
import { subscribeFocus } from '../common/focus-store.mjs'
import { getActiveScope } from '../common/session-scope.mjs'
import { createHmiView } from '../hmi/hmi-page.mjs'
import { COPY, NS } from '../i18n/copy.mjs'
import { interpolate, tWith } from '../i18n/translate.mjs'
import { createSettingsPage } from '../settings/settings-page.mjs'
import { registerSettings } from '../settings/register-settings.mjs'
import { ATTR, CSS } from '../styles/index.mjs'
import { wrapVisionPage } from '../workspace/vision-page-boundary.mjs'
import { MONITOR_SECTIONS, VIEW_HMI, VIEW_MONITOR } from '../workspace/vision-route.mjs'
import { requestOpenView, requestOpenViewFromScope, routeAgentFocus } from '../workspace/vision-view-request.mjs'
import { createDebugWorkspace } from '../workspace/debug-workspace.mjs'
import { createMonitorWorkspace } from '../workspace/monitor-workspace.mjs'
import { registerView } from './register-view.mjs'

export function apply(ctx) {
  if (!ctx.connection?.rpc?.call || typeof ctx.connection.rpc.call !== 'function') {
    throw new Error('dsh-vision-bench: Client requires ctx.connection.rpc.call')
  }

  const React = require('react')
  const slots = ctx.slots
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
  if (ctx.locale) {
    if (typeof ctx.locale.register !== 'function') {
      throw new Error('dsh-vision-bench: injected locale is missing register()')
    }
    localeDispose = ctx.locale.register(NS, COPY) || function () {}
  }

  function t(key, params) {
    return interpolate(tWith(ctx, key, params), params)
  }

  function post(path, payload, timeoutMs) {
    return createVisionRpcPost(ctx.connection)(path, payload, timeoutMs)
  }

  function openHmi(target) {
    requestOpenViewFromScope(VIEW_HMI, { section: '', target: target || {}, source: 'manual' })
  }

  function openFrames() {
    requestOpenViewFromScope(VIEW_MONITOR, {
      section: MONITOR_SECTIONS.FRAMES,
      source: 'manual',
    })
  }

  const SettingsPage = createSettingsPage(React, t, post, { getScope: getActiveScope })
  const DebugWorkspace = wrapVisionPage(React, createDebugWorkspace(React, t, post), 'debug', t)
  const HmiView = wrapVisionPage(React, createHmiView(React, t, post), 'hmi', t)
  const MonitorWorkspace = wrapVisionPage(
    React,
    createMonitorWorkspace(React, t, post, { openHmi, openFrames }),
    'monitor',
    t,
  )
  const stopSettings = registerSettings(ctx, React, t, SettingsPage)
  const stopView = registerView(ctx, React, t, DebugWorkspace, HmiView, MonitorWorkspace)

  const lastRouteKeyBySession = new Map()
  const applyFocus = (fs, changedCwd) => {
    const routed = routeAgentFocus(fs, changedCwd, lastRouteKeyBySession)
    if (routed.action === 'open') {
      requestOpenView(routed.props, routed.request.viewId, routed.request)
    }
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

apply.inject = ['slots', 'locale', 'connection']
