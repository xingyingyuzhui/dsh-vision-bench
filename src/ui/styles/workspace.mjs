import { ATTR } from './base.mjs'

export const WORKSPACE_CSS = [
  `body[${ATTR}] .dvb-workspace{display:flex;flex-direction:column;gap:10px;box-sizing:border-box;min-width:0;min-height:0;height:100%;padding:16px calc(var(--dsh-composer-side-clearance, 16px) + 16px) 8px;width:100%}.dvb-ws-tabs{display:flex;gap:4px;align-items:center;flex-wrap:nowrap;overflow:auto;padding:4px 0 6px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.18));scrollbar-width:thin}.dvb-ws-tabs .dvb-tab{border-radius:999px}.dvb-ws-tabs .dvb-tab.is-on{font-weight:600;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.16));border-color:var(--dsw-alias-label-info,#4f8ef7);color:var(--dsw-alias-label-info,#4f8ef7)}.dvb-ws-body{min-width:0;min-height:0;flex:1;display:flex;flex-direction:column}.dvb-ws-body>.dvb-page{padding:0}`,
]
