import { ATTR } from './base.mjs'

export const RUNTIME_CSS = [
  'body[' +
    ATTR +
    '] .dvb-debug-runtime{display:flex;flex-direction:column;gap:8px;min-height:0;flex:1;overflow:hidden}',
  'body[' +
    ATTR +
    '] .dvb-debug-toolbar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:6px 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.06));border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.2))}',
  'body[' + ATTR + '] .dvb-debug-status-group{display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:12px}',
  'body[' + ATTR + '] .dvb-debug-btn-group{display:flex;align-items:center;flex-wrap:wrap;gap:4px}',
  'body[' +
    ATTR +
    '] .dvb-debug-approval-card{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:8px 12px;border-radius:6px;background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.35);font-size:12px}',
  'body[' + ATTR + '] .dvb-debug-grid{display:flex;flex:1;min-height:0;gap:10px;align-items:stretch}',
  'body[' +
    ATTR +
    '] .dvb-debug-col-left{flex:0 0 35%;min-width:260px;max-width:420px;display:flex;flex-direction:column;gap:8px;min-height:0}',
  'body[' +
    ATTR +
    '] .dvb-debug-col-right{flex:1 1 0;min-width:0;min-height:0;display:flex;flex-direction:column;gap:8px}',
  'body[' +
    ATTR +
    '] .dvb-debug-panel{flex:1;min-height:0;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.2));border-radius:8px;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.02));overflow:hidden}',
  'body[' +
    ATTR +
    '] .dvb-debug-panel-head{display:flex;align-items:center;justify-content:space-between;padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.14));font-size:12px;font-weight:600;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.04))}',
  'body[' +
    ATTR +
    '] .dvb-debug-panel-body{flex:1;min-height:0;overflow:auto;padding:6px 8px;display:flex;flex-direction:column;gap:4px}',
  'body[' +
    ATTR +
    '] .dvb-debug-item{padding:4px 8px;border-radius:4px;cursor:pointer;font-size:11px;display:flex;align-items:center;justify-content:space-between;gap:6px}',
  'body[' + ATTR + '] .dvb-debug-item:hover{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.08))}',
  'body[' + ATTR + '] .dvb-debug-item.is-active{background:rgba(79,142,247,.15);font-weight:600}',
  'body[' +
    ATTR +
    '] .dvb-debug-var-row{display:flex;align-items:center;justify-content:space-between;padding:3px 6px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.08))}',
  'body[' + ATTR + '] .dvb-debug-var-name{color:var(--dsw-alias-label-info,#4f8ef7);font-weight:500}',
  'body[' + ATTR + '] .dvb-debug-var-val{color:var(--dsw-alias-text-primary,inherit);word-break:break-all}',
  'body[' +
    ATTR +
    '] .dvb-debug-timeline{max-height:130px;min-height:80px;flex:0 0 auto;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.2));border-radius:8px;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.02));overflow:hidden}',
  'body[' +
    ATTR +
    '] .dvb-debug-timeline-list{flex:1;overflow:auto;font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;padding:4px 8px;display:flex;flex-direction:column;gap:2px}',
  'body[' + ATTR + '] .dvb-debug-timeline-entry{display:flex;gap:8px;padding:2px 4px;border-radius:3px;opacity:.88}',
  'body[' + ATTR + '] .dvb-debug-timeline-time{opacity:.6;flex:none}',
  'body[' + ATTR + '] .dvb-debug-timeline-type{font-weight:600;flex:none}',
  'body[' +
    ATTR +
    '] .dvb-debug-tabs{display:flex;gap:4px;margin-bottom:4px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.14));padding-bottom:4px}',
  'body[' +
    ATTR +
    '] .dvb-debug-subtab{padding:2px 8px;border-radius:4px;font-size:11px;cursor:pointer;background:none;border:none;color:inherit;opacity:.7}',
  'body[' +
    ATTR +
    '] .dvb-debug-subtab.is-active{opacity:1;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.15));font-weight:600}',
  'body[' + ATTR + '] .dvb-debug-form{display:flex;gap:4px;margin-bottom:6px;align-items:center}',
  'body[' +
    ATTR +
    '] .dvb-debug-form input{flex:1;font-size:11px;padding:3px 6px;border-radius:4px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.25));background:transparent;color:inherit}',
]
