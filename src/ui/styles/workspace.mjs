import { ATTR } from './base.mjs'

export const WORKSPACE_CSS = [
  'body[' +
    ATTR +
    '] .dvb-workspace{display:flex;flex-direction:column;gap:8px;box-sizing:border-box;min-width:0;min-height:0;height:100%;padding:12px calc(var(--dsh-composer-side-clearance, 16px) + 12px) 8px}',
  'body[' + ATTR + '] .dvb-ws-tabs{display:flex;flex-wrap:wrap;gap:6px;align-items:center}',
  'body[' + ATTR + '] .dvb-ws-body{min-width:0;min-height:0;flex:1;display:flex;flex-direction:column}',
]
