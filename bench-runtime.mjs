import { COPY, NS, interpolate, tWith } from './bench-i18n.mjs'
import { ATTR, CSS } from './bench-styles.mjs'
import { createSettingsPage, registerSettings } from './bench-settings.mjs'
import { createHmiView } from './bench-hmi.mjs'
import { closeBetterTab, createAlarmPage, createLiveView, createTrendPage, openModbusTab, registerLive } from './bench-live.mjs'
import { createMapView, openProjectTab, registerMap } from './bench-map.mjs'
import { createDebugView, registerView } from './bench-view.mjs'
import { createFramesPage } from './bench-frames-view.mjs'
import { getFocusState, shouldHighlightFocus, subscribeFocus } from './bench-shared.mjs'

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
  let openHmiImpl = function () {}
  let closeTabImpl = function () {}
  function openLive() { openLiveImpl() }
  function openProject() { openProjectImpl() }
  function openHmi(target) { try { openHmiImpl(target) } catch {} }
  const SettingsPage = createSettingsPage(React, t, post)
  const DebugView = createDebugView(React, t, post, openProject)
  const HmiView = createHmiView(React, t, post, openLive)
  const LivePage = createLiveView(React, t, post, {
    openLive,
    openHmi,
    closeTab(id) { closeTabImpl(id) },
  })
  const MapPage = createMapView(React, t, post)
  const stopSettings = registerSettings(ctx, React, t, SettingsPage)
  const stopView = registerView(ctx, React, t, DebugView, HmiView)

  if (typeof ctx.inject === 'function') {
    ctx.inject(['betterSidebar'], (side) => {
      openLiveImpl = function () { openModbusTab(side) }
      openProjectImpl = function () { openProjectTab(side) }
      closeTabImpl = function (id) { closeBetterTab(side, id) }
      const FramesPage = createFramesPage(React, t, post, { openLive, openHmi })
      const stopLive = registerLive(side, React, t, LivePage, {
        trend: createTrendPage(React, t, post, { openLive, openHmi }),
        alarm: createAlarmPage(React, t, post, { openLive, openHmi }),
        frames: FramesPage,
      })
      const stopMap = registerMap(side, React, t, MapPage)
      // Task14: 仅当显式 foreground 才自动切页；badgeOnly 仅角标
      let lastFocusKey = ''
      const applyFocus = (fs) => {
        if (!fs || !fs.request || fs.badgeOnly || !shouldHighlightFocus(fs)) return
        const key = fs.request.connectionId + '|' + fs.request.deviceId + '|' + fs.request.pointId + '|' + fs.request.frameId + '|' + fs.request.trendKey + '|' + fs.request.alarmId
        if (key === lastFocusKey) return
        lastFocusKey = key
        const kind = fs.request.kind || (fs.request.pointId ? 'point' : fs.request.frameId ? 'frame' : fs.request.trendKey ? 'trend' : fs.request.alarmId ? 'alarm' : 'connection')
        if (kind === 'trend') { try { side.openTab({ type: 'dsh-vision-bench:charts' }) } catch {} }
        else if (kind === 'alarm') { try { side.openTab({ type: 'dsh-vision-bench:alarms' }) } catch {} }
        else if (kind === 'frame') { try { side.openTab({ type: 'dsh-vision-bench:frames' }) } catch {} }
        else { try { openModbusTab(side) } catch { try { openLiveImpl() } catch {} } }
      }
      const focusUnsub = subscribeFocus('', (fs) => applyFocus(fs))
      side.effect(() => () => { try { focusUnsub() } catch {} })
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
      if (styleTag != null) styleTag.remove()
      if (doc) doc.body.removeAttribute(ATTR)
    }
  })
}
