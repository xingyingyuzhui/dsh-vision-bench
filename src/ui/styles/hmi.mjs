import { ATTR } from './base.mjs'

export const HMI_CSS = [
  'body[' + ATTR + '] .dvb-dev-meta{font-size:11px;opacity:.55}',
  'body[' +
    ATTR +
    '] .dvb-table-wrap{overflow:auto;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.28));border-radius:4px}',
  'body[' + ATTR + '] .dvb-table{width:100%;border-collapse:collapse;font-size:12px}',
  'body[' +
    ATTR +
    '] .dvb-table th{text-align:left;font-weight:500;opacity:.62;padding:5px 8px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.28))}',
  'body[' +
    ATTR +
    '] .dvb-table td{padding:4px 8px;border-bottom:1px solid rgba(128,128,128,.1);vertical-align:middle}',
  'body[' + ATTR + '] .dvb-table tr[data-kind="seg"] td{background:transparent}',
  'body[' +
    ATTR +
    '] .dvb-table .dvb-val{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}',
  'body[' + ATTR + '] .dvb-table tr[data-ok="false"] .dvb-val{color:var(--dsw-alias-label-danger,#c62828)}',
  'body[' + ATTR + '] .dvb-table tr{display:table-row}',
  'body[' + ATTR + '] .dvb-table th,body[' + ATTR + '] .dvb-table td{display:table-cell;vertical-align:middle}',
  'body[' + ATTR + '] .dvb-map-meta{font-size:11px;opacity:.55}',
  'body[' +
    ATTR +
    '] .dvb-hmi-tabs{display:flex;gap:4px;align-items:center;flex-wrap:nowrap;overflow:auto;padding:4px 0 6px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.18));scrollbar-width:thin}',
  'body[' +
    ATTR +
    '] .dvb-tab{flex:none;display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.32));border-radius:999px;background:transparent;color:inherit;font:inherit;font-size:12px;white-space:nowrap;cursor:pointer;transition:all .15s ease}',
  'body[' +
    ATTR +
    '] .dvb-tab:hover{border-color:var(--dsw-alias-border-l1,rgba(128,128,128,.55));background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.08))}',
  'body[' +
    ATTR +
    '] .dvb-tab.is-on{font-weight:600;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.16));border-color:var(--dsw-alias-label-info,#4f8ef7);color:var(--dsw-alias-label-info,#4f8ef7)}',
  'body[' +
    ATTR +
    '] .dvb-tab.is-warn{border-color:var(--dsw-alias-label-danger,#c62828);color:var(--dsw-alias-label-danger,#c62828)}',
  'body[' +
    ATTR +
    '] .dvb-tab-dot{width:7px;height:7px;border-radius:999px;background:rgba(128,128,128,.4);flex:none;transition:background-color .2s,box-shadow .2s;display:inline-block}',
  'body[' + ATTR + '] .dvb-tab-dot[data-kind="live"]{background:var(--dsw-alias-label-success,#2e7d32);box-shadow:0 0 5px rgba(46,125,50,.6)}',
  'body[' + ATTR + '] .dvb-tab-dot[data-kind="warn"]{background:var(--dsw-alias-label-warning,#b45309);box-shadow:0 0 5px rgba(180,83,9,.5)}',
  'body[' + ATTR + '] .dvb-tab-dot[data-kind="err"]{background:var(--dsw-alias-label-danger,#c62828);box-shadow:0 0 5px rgba(198,40,40,.6)}',
  'body[' + ATTR + '] .dvb-tab-dot[data-kind="idle"]{background:rgba(128,128,128,.4)}',
  'body[' + ATTR + '] .dvb-tab-badges{display:inline-flex;gap:3px;align-items:center}',
  'body[' +
    ATTR +
    '] .dvb-tab-badges .dvb-badge{min-width:14px;padding:0 4px;border-radius:999px;text-align:center;font-size:10px;line-height:14px;border:1px solid currentColor}',
  'body[' + ATTR + '] .dvb-tab-badges .dvb-badge[data-kind="err"]{color:var(--dsw-alias-label-danger,#c62828)}',
  'body[' + ATTR + '] .dvb-tab-badges .dvb-badge[data-kind="live"]{color:var(--dsw-alias-label-success,#2e7d32)}',
  'body[' + ATTR + '] .dvb-tab-badges .dvb-badge[data-kind="warn"]{color:var(--dsw-alias-label-warning,#b45309)}',
  'body[' + ATTR + '] .dvb-tab-add{width:28px;justify-content:center;padding:0;font-weight:700}',
  'body[' + ATTR + '] .dvb-tab-more{position:relative;flex:none}',
  'body[' +
    ATTR +
    '] .dvb-tab-dropdown{position:absolute;top:32px;left:0;z-index:20;display:flex;flex-direction:column;gap:4px;padding:8px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:8px;background:var(--dsw-alias-bg-layer-1,#1e1e1e);box-shadow:0 4px 16px rgba(0,0,0,.18);min-width:180px}',
  'body[' +
    ATTR +
    '] .dvb-vision-bar{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;justify-content:space-between;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.22));border-radius:6px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.06))}',
  'body[' + ATTR + '] .dvb-vision-chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center}',
  'body[' + ATTR + '] .dvb-vision-meta{display:flex;gap:10px;align-items:center}',
  'body[' +
    ATTR +
    '] .dvb-focus-toast{position:fixed;right:14px;bottom:14px;z-index:60;display:flex;gap:8px;align-items:center;max-width:420px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));border-radius:8px;background:var(--dsw-alias-bg-layer-1,#1e1e1e);box-shadow:0 4px 16px rgba(0,0,0,.2);font-size:12px}',
  'body[' + ATTR + '] .dvb-point-table{table-layout:fixed;width:max-content}',
  'body[' + ATTR + '] .dvb-point-table th{position:relative;user-select:none;overflow:visible}',
  'body[' +
    ATTR +
    '] .dvb-point-table th .dvb-th-label{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  'body[' +
    ATTR +
    '] .dvb-col-resizer{position:absolute;top:0;right:0;width:9px;height:100%;cursor:col-resize;user-select:none;touch-action:none;z-index:10}',
  'body[' +
    ATTR +
    '] .dvb-col-resizer::after{content:"";position:absolute;top:20%;bottom:20%;right:0;width:1px;background:var(--dsw-alias-border-l2,rgba(128,128,128,.3));transition:all .15s ease}',
  'body[' +
    ATTR +
    '] .dvb-col-resizer:hover::after,body[' +
    ATTR +
    '] .dvb-col-resizer.is-resizing::after{top:0;bottom:0;width:2px;background:var(--dsw-alias-brand-primary,#3b82f6);box-shadow:0 0 4px rgba(59,130,246,.5)}',
  'body.dvb-resizing-col,body.dvb-resizing-col *{cursor:col-resize!important;user-select:none!important}',
  'body[' +
    ATTR +
    '] .dvb-point-table .dvb-col-name,.dvb-point-table .dvb-col-value,.dvb-point-table .dvb-col-fn,.dvb-point-table .dvb-col-addr,.dvb-point-table .dvb-col-monitor,.dvb-point-table .dvb-col-alarm,.dvb-point-table .dvb-col-min,.dvb-point-table .dvb-col-max{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  'body[' +
    ATTR +
    '] .dvb-point-table .dvb-col-scale,.dvb-point-table .dvb-col-offset,.dvb-point-table .dvb-col-unit{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  'body[' +
    ATTR +
    '] .dvb-dev-editing .dvb-point-table .dvb-col-scale,.dvb-dev-editing .dvb-point-table .dvb-col-offset,.dvb-dev-editing .dvb-point-table .dvb-col-unit{max-width:none;overflow:visible}',
  'body[' +
    ATTR +
    '] .dvb-points-editing .dvb-point-table .dvb-col-scale,.dvb-points-editing .dvb-point-table .dvb-col-offset,.dvb-points-editing .dvb-point-table .dvb-col-unit{max-width:none;overflow:visible}',
  'body[' + ATTR + '] .dvb-point-table .dvb-input{min-width:40px;max-width:100%;box-sizing:border-box;padding:1px 4px;font-size:11px}',
  'body[' + ATTR + '] .dvb-point-table .dvb-input-mono{width:72px;max-width:100%}',
  'body[' + ATTR + '] .dvb-point-table .dvb-col-name{min-width:100px}',
  'body[' +
    ATTR +
    '] .dvb-cell-name{display:flex;align-items:center;justify-content:space-between;width:100%;min-width:0;gap:8px;box-sizing:border-box}',
  'body[' +
    ATTR +
    '] .dvb-cell-name-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  'body[' +
    ATTR +
    '] .dvb-cell-name .dvb-ai-btn{flex:none;margin-left:auto;height:18px;padding:0 5px;font-size:10px;font-weight:600;line-height:16px;border-radius:4px;opacity:.75;background:transparent;color:var(--dsw-alias-label-secondary,#666);border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));transition:all .15s ease;cursor:pointer}',
  'body[' +
    ATTR +
    '] .dvb-cell-name .dvb-ai-btn:hover{opacity:1;color:var(--dsw-alias-brand-primary,#3b82f6);border-color:var(--dsw-alias-brand-primary,#3b82f6);background:rgba(59,130,246,.08)}',
  'body[' + ATTR + '] .dvb-cell-value{font-variant-numeric:tabular-nums}',
  'body[' + ATTR + '] .dvb-cell-writable{text-decoration:underline dotted rgba(128,128,128,.5)}',
  'body[' + ATTR + '] .dvb-cell-writable:hover{color:#4f8ef7}',
  'body[' + ATTR + '] .dvb-cell-readonly{opacity:.7;cursor:default}',
  'body[' + ATTR + '] .dvb-inline-write{display:inline-flex;gap:4px;align-items:center}',
  'body[' + ATTR + '] .dvb-inline-write .dvb-input{width:96px}',
  'body[' + ATTR + '] .dvb-dev-editing{outline:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4))}',
  'body[' + ATTR + '] .dvb-points-editing{outline:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4))}',
  'body[' + ATTR + '] .dvb-dev-edit-row{display:flex;flex-wrap:nowrap;gap:8px;align-items:center;width:100%}',
  'body[' + ATTR + '] .dvb-dev-edit-row .dvb-input{margin:0}',
  'body[' + ATTR + '] .dvb-newpoint-row td{background:rgba(79,142,247,.05)}',
  'body[' + ATTR + '] .dvb-btn-sm{height:24px;padding:0 8px;font-size:11px}',
  'body[' +
    ATTR +
    '] .dvb-switch{position:relative;display:inline-flex;align-items:center;justify-content:center;width:30px;height:22px;margin:0;padding:0;border:0;background:transparent;color:inherit;cursor:pointer;vertical-align:middle;flex:none;pointer-events:auto;touch-action:manipulation;-webkit-appearance:none;appearance:none}',
  'body[' +
    ATTR +
    '] .dvb-switch-track{position:relative;display:block;width:26px;height:14px;border-radius:999px;background:rgba(128,128,128,.35);transition:background .15s;pointer-events:none}',
  'body[' +
    ATTR +
    '] .dvb-switch-track::after{content:"";position:absolute;top:1px;left:1px;width:12px;height:12px;border-radius:50%;background:#fff;box-shadow:0 0 1px rgba(0,0,0,.35);transition:transform .15s}',
  'body[' + ATTR + '] .dvb-switch.is-on .dvb-switch-track{background:#4f8ef7}',
  'body[' + ATTR + '] .dvb-switch.is-on .dvb-switch-track::after{transform:translateX(12px)}',
  'body[' + ATTR + '] .dvb-switch:focus-visible .dvb-switch-track{outline:2px solid #4f8ef7;outline-offset:2px}',
  'body[' + ATTR + '] .dvb-switch:disabled{cursor:default;opacity:.7}',
  'body[' + ATTR + '] .dvb-switch:disabled .dvb-switch-track{opacity:.45}',
  'body[' + ATTR + '] .dvb-col-monitor,.dvb-col-alarm{position:relative;z-index:1;pointer-events:auto}',
  'body[' + ATTR + '] .dvb-btn-icon{padding:0 3px;min-width:18px;font-size:10px;opacity:.75}',
  'body[' + ATTR + '] .dvb-btn-danger{color:var(--dsw-alias-label-danger,#c62828)}',
  'body[' + ATTR + '] .dvb-dev-cards{display:flex;flex-direction:column;gap:8px}',
  'body[' +
    ATTR +
    '] .dvb-dev-card{border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.28));border-radius:6px;padding:8px 10px;display:flex;flex-direction:column;gap:6px}',
  'body[' + ATTR + '] .dvb-dev-card.dvb-has-focus{outline:2px solid #4f8ef7;outline-offset:-2px}',
  'body[' +
    ATTR +
    '] .dvb-dev-head{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;justify-content:space-between}',
  'body[' + ATTR + '] .dvb-dev-head-main{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;min-width:0}',
  'body[' + ATTR + '] .dvb-dev-title{font-weight:600;font-size:13px}',
  'body[' +
    ATTR +
    '] .dvb-dev-empty{padding:18px 12px;display:flex;flex-direction:column;gap:6px;align-items:flex-start}',
  'body[' + ATTR + '] .dvb-dev-empty-title{font-size:13px;font-weight:600}',
  'body[' + ATTR + '] .dvb-table-add-tr td{padding:6px 0;text-align:center}',
  'body[' +
    ATTR +
    '] .dvb-btn-dashed{display:flex;align-items:center;justify-content:center;width:100%;height:28px;border:1px dashed var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary,#666);font-size:12px;cursor:pointer;transition:all .15s ease}',
  'body[' +
    ATTR +
    '] .dvb-btn-dashed:hover{border-color:var(--dsw-alias-brand-primary,#3b82f6);color:var(--dsw-alias-brand-primary,#3b82f6);background:rgba(59,130,246,.04)}',
  'body[' + ATTR + '] .dvb-btn-dashed:disabled{opacity:.5;cursor:not-allowed}',
  'body[' + ATTR + '] .dvb-batch-panel{animation:dvbFadeDown .15s ease-out}',
  '@keyframes dvbFadeDown{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}',
]
