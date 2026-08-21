import { COPY, NS, interpolate, tWith } from './bench-i18n.mjs'
import { ATTR, CSS } from './bench-styles.mjs'
import { createSettingsPage, registerSettings } from './bench-settings.mjs'
import { createHmiView } from './bench-hmi.mjs'
import { closeBetterTab, createAlarmPage, createLiveView, createTrendPage, openModbusTab, registerLive } from './bench-live.mjs'
import { createMapView, openProjectTab, registerMap } from './bench-map.mjs'
import { createOverviewView, registerOverview } from './bench-overview.mjs'
import { createDebugView, registerView } from './bench-view.mjs'

export function apply(ctx) {
  const React = require('react')
  const slots = ctx.get('slots')
  if (slots == null || React == null) return

  const doc = typeof document === 'undefined' ? null : document
  let styleTag = null
  if (doc && doc.head) {
    styleTag = doc.createElement('style')
    styleTag.setAttribute(ATTR, '')
    styleTag.textContent = CSS
    doc.head.appendChild(styleTag)
    doc.body.setAttribute(ATTR, '')
  }

  let localeDispose = function () {}
  try {
    if (ctx.locale && typeof ctx.locale.register === 'function') {
      localeDispose = ctx.locale.register(NS, COPY) || function () {}
    }
  } catch { /* remount */ }

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
    }).then((res) => res.json().then((data) => {
      if (!res.ok) throw new Error((data && data.error) || ('http ' + res.status))
      return data
    }))
  }

  let openLiveImpl = function () {}
  let openProjectImpl = function () {}
  let closeTabImpl = function () {}
  function openLive() { openLiveImpl() }
  function openProject() { openProjectImpl() }
  const SettingsPage = createSettingsPage(React, t, post)
  const DebugView = createDebugView(React, t, post, openProject)
  const HmiView = createHmiView(React, t, post, openLive)
  const LivePage = createLiveView(React, t, post, {
    openLive,
    closeTab(id) { closeTabImpl(id) },
  })
  const MapPage = createMapView(React, t, post)
  const OverviewPage = createOverviewView(React, t, post, { openLive })
  const stopSettings = registerSettings(ctx, React, t, SettingsPage)
  const stopView = registerView(ctx, React, t, DebugView, HmiView)
  const stopOverview = registerOverview(ctx, React, t, OverviewPage)

  if (typeof ctx.inject === 'function') {
    ctx.inject(['betterSidebar'], (side) => {
      openLiveImpl = function () { openModbusTab(side) }
      openProjectImpl = function () { openProjectTab(side) }
      closeTabImpl = function (id) { closeBetterTab(side, id) }
      const stopLive = registerLive(side, React, t, LivePage, {
        trend: createTrendPage(React, t),
        alarm: createAlarmPage(React, t, post),
      })
      const stopMap = registerMap(side, React, t, MapPage)
      side.effect(() => () => {
        if (typeof stopLive === 'function') stopLive()
        if (typeof stopMap === 'function') stopMap()
      })
    })
  }

  ctx.effect(() => {
    return function () {
      localeDispose()
      if (typeof stopSettings === 'function') stopSettings()
      if (typeof stopView === 'function') stopView()
      if (typeof stopOverview === 'function') stopOverview()
      if (styleTag != null) styleTag.remove()
      if (doc) doc.body.removeAttribute(ATTR)
    }
  })
}
