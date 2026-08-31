import { TREND_WINDOW_MS, UPLOT_PROTO, toUplotData } from './bench-trend.mjs'
import { vendorUPlot } from './bench-vendor.mjs'
import { createAlarmPage } from './src/ui/monitor/alarms/alarm-page.mjs'
import { createLogPage } from './src/ui/monitor/journal/journal-page.mjs'
import { createVisualizationPage } from './src/ui/monitor/visualization/visualization-page.mjs'
import { sessionCwd } from './src/ui/common/session-scope.mjs'

const TAB_TABLE = 'dsh-vision-bench:modbus'
const TAB_CHART = 'dsh-vision-bench:charts'
const TAB_ALARM = 'dsh-vision-bench:alarms'
const TAB_FRAMES = 'dsh-vision-bench:frames'
export const TAB_LOG = 'dsh-vision-bench:log'
export { createVisualizationPage, createAlarmPage, createLogPage }
export { sessionCwd }
/** @deprecated Use createVisualizationPage. Removed after 0.22.0. */
export const createTrendPage = createVisualizationPage

const TREND_COLORS = ['#4f8ef7', '#2eaf64', '#e0912f', '#c85454', '#8f63d2', '#2fa8a8', '#d27ab0', '#7a8494']

export function getBetterSidebar(ctx) {
  try {
    return (ctx && ctx.betterSidebar) || (ctx && ctx.get && ctx.get('betterSidebar')) || null
  } catch {
    return null
  }
}

export const drawTrend = (container, cwd = '', now = Date.now(), payload) => {
  if (!container) return null
  const UPlot = vendorUPlot()
  if (!UPlot) return null
  // Task3/0.19.3: 优先使用调用方传入的存储载荷；旧签名回退客户端缓存
  const usePayload =
    payload && Array.isArray(payload.data) ? payload : toUplotData(cwd, { now, windowMs: TREND_WINDOW_MS })
  const { data, keys, meta } = usePayload
  const isDark =
    typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1
  const ks = keys.slice(0, 8),
    ms = meta.slice(0, 8)
  const opts = {
    ...UPLOT_PROTO,
    width: container.clientWidth || 560,
    height: 190,
    pxRatio: dpr,
    spanGaps: false,
    cursor: { drag: { x: true, y: false, uni: 10 } },
    select: { show: true },
    scales: { x: { time: true }, y: { auto: true } },
    axes: [
      {
        stroke: isDark ? 'rgba(255,255,255,.72)' : 'rgba(0,0,0,.72)',
        grid: { stroke: isDark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.08)' },
      },
      {
        stroke: isDark ? 'rgba(255,255,255,.72)' : 'rgba(0,0,0,.72)',
        grid: { stroke: isDark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.08)' },
      },
    ],
    series: [{ label: 'time' }].concat(
      ks.map((k, i) => ({
        label: (ms[i] && ms[i].label) || k,
        stroke: TREND_COLORS[i % 8],
        width: 1.5,
        spanGaps: false,
        points: { show: false },
      })),
    ),
    hooks: {
      setSelect: [
        (u) => {
          try {
            const s = u.select
            container._uplotSel =
              !s || !s.width
                ? null
                : {
                    start: Math.round(u.posToVal(s.left, 'x') * 1000),
                    end: Math.round(u.posToVal(s.left + s.width, 'x') * 1000),
                  }
          } catch {
            container._uplotSel = null
          }
        },
      ],
    },
  }
  try {
    return new UPlot(opts, data, container)
  } catch {
    return null
  }
}

function createSoonPage(React, t, titleKey, hintKey) {
  return function SoonPage() {
    return React.createElement('div', { className: 'dvb-hint' }, t(hintKey) || t(titleKey) || '')
  }
}

export function registerLive(ctx, React, t, LivePage, pages = {}) {
  // Task2/0.19.3: 监视 Tab 已删除 — 采集由 Host 后台服务（/polling/*）运行；
  // 侧边栏只保留 曲线/告警/串口报文/操作记录。
  void LivePage
  const bs = ctx.betterSidebar
  const TrendPage = pages.trend || createSoonPage(React, t, 'liveChart', 'chartSoon')
  const AlarmPage = pages.alarm || createSoonPage(React, t, 'liveAlarm', 'alarmSoon')
  const FramesPage = pages.frames || createSoonPage(React, t, 'framesTab', 'framesEmpty')
  const LogPage = pages.log || createLogPage(React, t)
  const stops = [
    bs.registerTab({
      id: TAB_CHART,
      title() {
        return t('liveChart')
      },
      single: true,
      order: 71,
      component: TrendPage,
    }),
    bs.registerTab({
      id: TAB_ALARM,
      title() {
        return t('liveAlarm')
      },
      single: true,
      order: 72,
      component: AlarmPage,
    }),
    bs.registerTab({
      id: TAB_FRAMES,
      title() {
        return t('framesTab')
      },
      single: true,
      order: 73,
      component: FramesPage,
    }),
    bs.registerTab({
      id: TAB_LOG,
      title() {
        return t('liveLog')
      },
      single: true,
      order: 74,
      component: LogPage,
    }),
  ]
  return function () {
    for (const stop of stops) {
      if (typeof stop === 'function') stop()
    }
  }
}

export function closeBetterTab(ctx, tabId) {
  const bs = getBetterSidebar(ctx)
  if (bs && typeof bs.closeTab === 'function') bs.closeTab(tabId)
}

export const _internal = { TAB_TABLE, TAB_CHART, TAB_ALARM, TAB_FRAMES, getBetterSidebar }
