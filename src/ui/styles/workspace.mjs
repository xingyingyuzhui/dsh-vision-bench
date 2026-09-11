import { ATTR } from './base.mjs'

export const WORKSPACE_CSS = [
  `body[${ATTR}] .dvb-workspace{display:flex;flex-direction:column;gap:8px;box-sizing:border-box;min-width:0;min-height:0;height:100%;padding:8px calc(var(--dsh-composer-side-clearance, 16px) + 16px) 8px;width:100%}`,
  `body[${ATTR}] .dvb-ws-tabs{display:flex;gap:4px;align-items:center;flex-wrap:nowrap;overflow:auto;padding:0 0 4px;width:100%;box-sizing:border-box;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.18));scrollbar-width:thin}`,
  `body[${ATTR}] .dvb-ws-tabs .dvb-tab{border-radius:999px}`,
  `body[${ATTR}] .dvb-ws-tabs .dvb-tab.is-on{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.16));border-color:var(--dsw-alias-label-info,#4f8ef7);color:var(--dsw-alias-label-info,#4f8ef7)}`,
  `body[${ATTR}] .dvb-ws-body{min-width:0;min-height:0;flex:1;display:flex;flex-direction:column;width:100%;overflow:visible}`,
  `body[${ATTR}] .dvb-ws-body>.dvb-page{padding:0;width:100%;box-sizing:border-box}`,
  `body[${ATTR}] .dvb-ws-body>.dvb-live,body[${ATTR}] .dvb-ws-body>.dvb-debug-runtime{padding-left:0;padding-right:0;width:100%;height:100%;min-height:0;box-sizing:border-box}`,
  `body[${ATTR}] .dvb-ws-body>.dvb-viz,body[${ATTR}] .dvb-ws-body>.dvb-frames-page{padding-top:0;padding-bottom:6px}`,
  `body[${ATTR}] .dvb-hmi-tabs{width:100%;box-sizing:border-box}`,
]
