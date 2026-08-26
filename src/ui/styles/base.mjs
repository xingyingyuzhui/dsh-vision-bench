export const ATTR = 'data-dsh-vision-bench'

export const BASE_CSS = [
  'body[' +
    ATTR +
    '] .dvb-page{display:flex;flex-direction:column;gap:10px;box-sizing:border-box;padding:16px calc(var(--dsh-composer-side-clearance, 16px) + 16px) 8px;width:100%;min-width:0}',
  'body[' + ATTR + '] .dvb-title{font-weight:600;font-size:13px}',
  'body[' + ATTR + '] .dvb-hint{opacity:.58;font-size:12px;line-height:1.45}',
  'body[' +
    ATTR +
    '] .dvb-bar{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;justify-content:space-between}',
  'body[' + ATTR + '] .dvb-health{display:flex;flex-wrap:wrap;gap:6px}',
  'body[' +
    ATTR +
    '] .dvb-chip{font-size:11px;line-height:18px;padding:0 7px;border-radius:4px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35))}',
  'body[' +
    ATTR +
    '] .dvb-chip[data-kind="ready"]{color:var(--dsw-alias-label-success,#2e7d32);border-color:currentColor}',
  'body[' +
    ATTR +
    '] .dvb-chip[data-kind="missing"]{color:var(--dsw-alias-label-danger,#c62828);border-color:currentColor}',
  'body[' + ATTR + '] .dvb-chip[data-kind="unbound"]{opacity:.7}',
  'body[' +
    ATTR +
    '] .dvb-cwd{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;opacity:.5;word-break:break-all}',
  'body[' + ATTR + '] .dvb-row{display:flex;flex-direction:column;gap:3px;min-width:0}',
  'body[' + ATTR + '] .dvb-label{display:flex;gap:8px;align-items:baseline;font-size:11px;opacity:.7}',
  'body[' + ATTR + '] .dvb-status{opacity:.7;font-size:12px}',
  'body[' + ATTR + '] .dvb-status[data-kind="ready"]{color:var(--dsw-alias-label-success,#2e7d32)}',
  'body[' + ATTR + '] .dvb-status[data-kind="missing"]{color:var(--dsw-alias-label-danger,#c62828)}',
  'body[' +
    ATTR +
    '] .dvb-input{height:28px;width:100%;box-sizing:border-box;padding:0 8px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:12px;transition:border-color .15s ease}',
  'body[' + ATTR + '] .dvb-input:focus-visible{outline:none;border-color:var(--dsw-alias-label-info,#4f8ef7)}',
  'body[' + ATTR + '] .dvb-input::placeholder{opacity:.28;font-style:normal;color:inherit}',
  'body[' +
    ATTR +
    '] .dvb-input-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}',
  'body[' + ATTR + '] .dvb-combo{display:flex;gap:6px;min-width:0;align-items:center}',
  'body[' + ATTR + '] .dvb-combo .dvb-input{flex:1;min-width:0}',
  'body[' + ATTR + '] .dvb-combo .dvb-btn{flex:none}',
  'body[' +
    ATTR +
    '] .dvb-file{display:flex;gap:8px;align-items:center;min-height:28px;padding:0 4px 0 8px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));border-radius:6px}',
  'body[' + ATTR + '] .dvb-file .dvb-btn{height:24px;padding:0 8px;border-color:transparent}',
  'body[' + ATTR + '] .dvb-actions{display:flex;flex-wrap:wrap;gap:6px;align-items:center}',
  'body[' +
    ATTR +
    '] .dvb-btn{height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));border-radius:6px;background:transparent;color:inherit;cursor:pointer;font:inherit;font-size:12px;transition:background-color .15s ease,border-color .15s ease,opacity .15s ease}',
  'body[' +
    ATTR +
    '] .dvb-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.1));border-color:var(--dsw-alias-border-l1,rgba(128,128,128,.55))}',
  'body[' + ATTR + '] .dvb-btn:focus-visible{outline:2px solid var(--dsw-alias-label-info,#4f8ef7);outline-offset:1px}',
  'body[' +
    ATTR +
    '] .dvb-btn-primary,.dvb-btn.is-on{font-weight:600;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.14));border-color:var(--dsw-alias-border-l1,rgba(128,128,128,.55))}',
  'body[' + ATTR + '] .dvb-btn:disabled{opacity:.4;cursor:default}',
  'body[' + ATTR + '] .dvb-need{font-size:12px;opacity:.62}',
  'body[' + ATTR + '] .dvb-msg{font-size:12px}',
  'body[' + ATTR + '] .dvb-msg[data-kind="ok"]{color:var(--dsw-alias-label-success,#2e7d32)}',
  'body[' + ATTR + '] .dvb-msg[data-kind="err"]{color:var(--dsw-alias-label-danger,#c62828)}',
  'body[' +
    ATTR +
    '] .dvb-log{margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.45;white-space:pre-wrap;word-break:break-all;min-height:88px;max-height:220px;overflow:auto;padding:8px 10px;scrollbar-width:thin;overscroll-behavior:contain}',
  'body[' +
    ATTR +
    '] .dvb-path{flex:1;min-width:0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;word-break:break-all}',
  'body[' + ATTR + '] .dvb-path[data-empty="1"]{opacity:.4}',
  'body[' +
    ATTR +
    '] .dvb-mask{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45)}',
  'body[' +
    ATTR +
    '] .dvb-picker{width:min(560px,92vw);max-height:70vh;overflow:auto;display:flex;flex-direction:column;gap:4px;padding:12px;border-radius:10px;background:var(--dsw-alias-bg-layer-1,#1c1c1c);color:inherit;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4))}',
  'body[' + ATTR + '] .dvb-picker-head{display:flex;gap:8px;align-items:center;margin-bottom:6px}',
  'body[' + ATTR + '] .dvb-picker-head .dvb-hint{flex:1;min-width:0;word-break:break-all}',
  'body[' +
    ATTR +
    '] .dvb-picker-row{text-align:left;padding:6px 8px;border:0;border-radius:4px;background:transparent;color:inherit;font:inherit;cursor:pointer}',
  'body[' + ATTR + '] .dvb-picker-row:hover{background:rgba(128,128,128,.18)}',
  'body[' + ATTR + '] .dvb-picker-file{font-weight:600}',
  'body[' +
    ATTR +
    '] .dvb-journal{display:flex;flex-direction:column;gap:6px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:6px}',
  'body[' + ATTR + '] .dvb-journal-title{font-size:11px;font-weight:600;opacity:.75;letter-spacing:.02em}',
  'body[' +
    ATTR +
    '] .dvb-task,.dvb-event{display:flex;flex-wrap:wrap;gap:6px;align-items:baseline;font-size:12px;line-height:1.45}',
  'body[' +
    ATTR +
    '] .dvb-task[data-status="error"],body[' +
    ATTR +
    '] .dvb-event[data-ok="false"]{color:var(--dsw-alias-label-danger,#c62828)}',
  'body[' + ATTR + '] .dvb-badge{font-size:11px;opacity:.7}',
  'body[' + ATTR + '] .dvb-badge[data-source="agent"]{opacity:1}',
  'body[' +
    ATTR +
    '] .dvb-panel{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:6px;min-width:0}',
  'body[' + ATTR + '] .dvb-panel-head{display:flex;flex-wrap:wrap;gap:8px;align-items:center;min-height:28px}',
  'body[' + ATTR + '] .dvb-panel-title{font-size:12px;font-weight:600;margin-right:auto}',
  'body[' + ATTR + '] .dvb-panel-fill{min-height:0;flex:1}',
  'body[' +
    ATTR +
    '] .dvb-split{display:grid;grid-template-columns:minmax(240px,.92fr) minmax(0,1.2fr);gap:10px;align-items:stretch;width:100%;min-width:0}',
  'body[' + ATTR + '] .dvb-split>.dvb-panel{min-width:0}',
  'body[' + ATTR + '] .dvb-toolbar{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:flex-end}',
  'body[' + ATTR + '] .dvb-devbar{display:flex;flex-wrap:wrap;gap:6px;align-items:center}',
  'body[' + ATTR + '] .dvb-devbar-add{display:flex;flex-wrap:wrap;gap:6px;margin-left:auto}',
  'body[' + ATTR + '] .dvb-devbar.is-empty .dvb-devbar-add{margin-left:0}',
  'body[' + ATTR + '] .dvb-toolbar .dvb-row{flex:0 1 12rem}',
  'body[' +
    ATTR +
    '] .dvb-dev{display:inline-flex;align-items:baseline;gap:6px;height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));border-radius:6px;background:transparent;color:inherit;cursor:pointer;font:inherit;font-size:12px}',
  'body[' +
    ATTR +
    '] .dvb-dev.is-on{font-weight:600;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.14));border-color:var(--dsw-alias-border-l1,rgba(128,128,128,.55))}',
  'body[' +
    ATTR +
    '] .dvb-tag{font-size:11px;line-height:18px;padding:0 6px;border-radius:3px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));opacity:.8}',
  'body[' +
    ATTR +
    '] .dvb-conn{display:grid;grid-template-columns:minmax(7rem,1fr) 6.5rem 5.5rem minmax(8rem,1.4fr) 6.5rem 6.5rem;gap:8px 10px}',
  'body[' +
    ATTR +
    '] .dvb-seg-add{display:grid;grid-template-columns:minmax(7rem,1.1fr) minmax(9rem,1.2fr) 6.5rem 5.5rem auto;gap:8px 10px;align-items:end}',
  'body[' + ATTR + '] .dvb-empty{opacity:.5;font-size:12px;padding:16px 2px}',
  'body[' + ATTR + '] .dvb-seg-actions{display:flex;gap:6px;justify-content:flex-end}',
  'body[' + ATTR + '] .dvb-seg-actions .dvb-btn{height:24px;padding:0 8px;font-size:12px}',
  'body[' + ATTR + '] .dvb-badge.dvb-status[data-kind="err"]{color:var(--dsw-alias-label-danger,#c62828)}',
  'body[' + ATTR + '] .dvb-badge.dvb-status[data-kind="warn"]{color:var(--dsw-alias-label-warning,#b45309)}',
  'body[' + ATTR + '] .dvb-badge.dvb-status[data-kind="live"]{color:var(--dsw-alias-label-success,#2e7d32)}',
  '@media (max-width:720px){body[' +
    ATTR +
    '] .dvb-conn,body[' +
    ATTR +
    '] .dvb-seg-add{grid-template-columns:repeat(2,minmax(0,1fr))}body[' +
    ATTR +
    '] .dvb-split{grid-template-columns:1fr}}',
]
