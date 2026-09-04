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
  'body[' + ATTR + '] .dvb-label{display:flex;gap:8px;align-items:center;font-size:12px;opacity:.85}',
  'body[' + ATTR + '] .dvb-status{opacity:.7;font-size:12px}',
  'body[' + ATTR + '] .dvb-status[data-kind="ready"]{color:var(--dsw-alias-label-success,#2e7d32)}',
  'body[' + ATTR + '] .dvb-status[data-kind="missing"]{color:var(--dsw-alias-label-danger,#c62828)}',
  'body[' +
    ATTR +
    '] .dvb-status-pill{font-size:11px;line-height:16px;padding:1px 7px;border-radius:10px;display:inline-flex;align-items:center;border:1px solid transparent;font-weight:500;margin-left:auto}',
  'body[' +
    ATTR +
    '] .dvb-status-pill[data-kind="ready"]{color:var(--dsw-alias-label-success,#2e7d32);background:rgba(46,125,50,.12);border-color:rgba(46,125,50,.25)}',
  'body[' +
    ATTR +
    '] .dvb-status-pill[data-kind="missing"]{color:var(--dsw-alias-label-danger,#c62828);background:rgba(198,40,40,.12);border-color:rgba(198,40,40,.25)}',
  'body[' +
    ATTR +
    '] .dvb-status-pill[data-kind="unbound"]{color:inherit;opacity:.65;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.1));border-color:var(--dsw-alias-border-l2,rgba(128,128,128,.25))}',
  'body[' +
    ATTR +
    '] .dvb-callout{display:flex;gap:8px;align-items:center;padding:7px 10px;border-radius:6px;font-size:12px;line-height:1.4;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.08));border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.2));opacity:.85;margin-bottom:4px}',
  'body[' +
    ATTR +
    '] .dvb-runtime-line{display:flex;align-items:center;gap:6px;font-size:12px;line-height:1.4;margin:2px 0 6px}',
  'body[' +
    ATTR +
    '] .dvb-dot{width:7px;height:7px;border-radius:50%;display:inline-block;background:var(--dsw-alias-label-success,#2e7d32);flex-shrink:0}',
  'body[' + ATTR + '] .dvb-dot[data-kind="missing"]{background:var(--dsw-alias-label-danger,#c62828)}',
  'body[' +
    ATTR +
    '] .dvb-checkbox-row{display:flex;flex-direction:row;align-items:center;gap:8px;min-height:24px;cursor:pointer;font-size:12px;user-select:none}',
  'body[' +
    ATTR +
    '] .dvb-checkbox-row input[type="checkbox"]{margin:0;cursor:pointer;width:15px;height:15px;flex-shrink:0;accent-color:var(--dsw-alias-label-info,#4f8ef7)}',
  'body[' + ATTR + '] .dvb-checkbox-row[data-disabled="true"]{opacity:.4;cursor:default}',
  'body[' +
    ATTR +
    '] .dvb-share-subgroup{display:flex;flex-direction:column;gap:4px;padding-left:18px;border-left:2px solid var(--dsw-alias-border-l2,rgba(128,128,128,.15));margin:4px 0 6px 4px}',
  'body[' +
    ATTR +
    '] .dvb-setting-row{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:38px;padding:3px 0}',
  'body[' + ATTR + '] .dvb-setting-subrow{padding-left:14px}',
  'body[' +
    ATTR +
    '] .dvb-setting-label{display:flex;align-items:center;gap:10px;flex:1;min-width:0;font-size:14px;color:var(--dsw-alias-label-primary,inherit)}',
  'body[' + ATTR + '] .dvb-setting-control{display:inline-flex;align-items:center;gap:10px;flex:none}',
  'body[' +
    ATTR +
    '] .dvb-setting-switch, .dvb-setting-switch{appearance:none;-webkit-appearance:none;width:36px;height:20px;flex:none;margin:0;border:0;padding:2px;border-radius:999px;background-color:#e5e5e5;cursor:pointer;position:relative;box-sizing:border-box;display:inline-flex;align-items:center;transition:background-color .16s ease,opacity .16s ease;outline:none}',
  'body[' +
    ATTR +
    '] .dvb-setting-switch[data-checked="true"], .dvb-setting-switch[data-checked="true"]{background-color:#0f1115}',
  'body[' +
    ATTR +
    '] .dvb-setting-switch .dvb-setting-switch-thumb, .dvb-setting-switch .dvb-setting-switch-thumb{display:block;width:16px;height:16px;border-radius:50%;background-color:#ffffff;box-shadow:0 1px 3px rgba(0,0,0,.2);transform:translateX(0);transition:transform .16s ease;pointer-events:none}',
  'body[' +
    ATTR +
    '] .dvb-setting-switch[data-checked="true"] .dvb-setting-switch-thumb, .dvb-setting-switch[data-checked="true"] .dvb-setting-switch-thumb{transform:translateX(16px)}',
  'body[' +
    ATTR +
    '] .dvb-setting-switch:focus-visible, .dvb-setting-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#3b82f6);outline-offset:2px}',
  'body[' + ATTR + '] .dvb-setting-switch:disabled, .dvb-setting-switch:disabled{cursor:default;opacity:.45}',
  '@media (prefers-color-scheme:dark){body[' +
    ATTR +
    '] .dvb-setting-switch, .dvb-setting-switch{background-color:rgba(255,255,255,.2)}body[' +
    ATTR +
    '] .dvb-setting-switch[data-checked="true"], .dvb-setting-switch[data-checked="true"]{background-color:#3b82f6}}',
  '@media (prefers-reduced-motion:reduce){body[' +
    ATTR +
    '] .dvb-setting-switch, .dvb-setting-switch, body[' +
    ATTR +
    '] .dvb-setting-switch .dvb-setting-switch-thumb, .dvb-setting-switch .dvb-setting-switch-thumb{transition:none}}',
  'body[' +
    ATTR +
    '] .dvb-input-pill{height:34px;width:320px;max-width:100%;box-sizing:border-box;padding:0 14px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.28));border-radius:17px;background:var(--dsw-alias-bg-module-platform,rgba(128,128,128,.06));color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:13px;transition:background-color .15s ease,border-color .15s ease}',
  'body[' + ATTR + '] .dvb-input-pill:hover{border-color:var(--dsw-alias-border-l1,rgba(128,128,128,.45))}',
  'body[' +
    ATTR +
    '] .dvb-input-pill:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary,#3b82f6);background:transparent}',
  'body[' + ATTR + '] .dvb-input-pill::placeholder{opacity:.35;color:inherit}',
  'body[' +
    ATTR +
    '] .dvb-btn-pill{height:34px;padding:0 18px;border-radius:17px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));font:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,inherit);box-shadow:0 1px 2px rgba(0,0,0,.04);transition:background-color .15s ease,border-color .15s ease,opacity .15s ease}',
  'body[' +
    ATTR +
    '] .dvb-btn-pill:hover:not(:disabled){background:var(--dsw-alias-bg-module-platform,rgba(128,128,128,.08));border-color:var(--dsw-alias-border-l1,rgba(128,128,128,.55))}',
  'body[' +
    ATTR +
    '] .dvb-btn-pill-primary{background:var(--dsw-alias-label-primary,#1c1c1c);color:var(--dsw-alias-bg-base,#fff);border-color:var(--dsw-alias-label-primary,#1c1c1c)}',
  'body[' + ATTR + '] .dvb-btn-pill-primary:hover:not(:disabled){opacity:.88}',
  'body[' + ATTR + '] .dvb-btn-pill:disabled{opacity:.4;cursor:default}',
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
  'body[' + ATTR + '] .dvb-combo .dvb-select{flex:1;min-width:0}',
  'body[' + ATTR + '] .dvb-combo .dvb-btn{flex:none}',
  'body[' +
    ATTR +
    '] .dvb-select{position:relative;display:inline-flex;width:100%;box-sizing:border-box;font-size:12px;user-select:none}',
  'body[' +
    ATTR +
    '] .dvb-select-trigger{height:28px;width:100%;box-sizing:border-box;padding:0 8px 0 10px;display:inline-flex;align-items:center;justify-content:space-between;gap:8px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:6px;background:var(--dsw-alias-bg-module-platform,transparent);color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:12px;cursor:pointer;text-align:left;transition:border-color .15s ease,background-color .15s ease,box-shadow .15s ease}',
  'body[' +
    ATTR +
    '] .dvb-select-trigger:hover:not(:disabled){border-color:var(--dsw-alias-border-l1,rgba(128,128,128,.55))}',
  'body[' +
    ATTR +
    '] .dvb-select-trigger.is-open{border-color:var(--dsw-alias-label-info,#4f8ef7);outline:none;box-shadow:0 0 0 1px var(--dsw-alias-label-info,#4f8ef7)}',
  'body[' + ATTR + '] .dvb-select-trigger:disabled{opacity:.45;cursor:not-allowed}',
  'body[' + ATTR + '] .dvb-select-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  'body[' +
    ATTR +
    '] .dvb-select-chevron{width:14px;height:14px;flex:none;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.7));transition:transform .18s ease}',
  'body[' + ATTR + '] .dvb-select-trigger.is-open .dvb-select-chevron{transform:rotate(180deg)}',
  'body[' +
    ATTR +
    '] .dvb-select-dropdown{position:absolute;top:calc(100% + 4px);left:0;min-width:100%;max-height:220px;overflow-y:auto;z-index:1000;padding:4px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.28));border-radius:10px;background:var(--dsw-alias-bg-layer-1,#ffffff);box-shadow:0 6px 20px rgba(0,0,0,.15),0 2px 6px rgba(0,0,0,.08);box-sizing:border-box;scrollbar-width:thin}',
  'body[' + ATTR + '] .dvb-select-dropdown.is-right{left:auto;right:0}',
  'body[' +
    ATTR +
    '] .dvb-select-option{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;box-sizing:border-box;padding:6px 10px;border-radius:6px;border:none;background:transparent;color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:12px;cursor:pointer;text-align:left;transition:background-color .12s ease}',
  'body[' +
    ATTR +
    '] .dvb-select-option:hover:not(.is-disabled){background:var(--dsw-alias-bg-module-platform,rgba(128,128,128,.1))}',
  'body[' +
    ATTR +
    '] .dvb-select-option.is-selected{background:var(--dsw-alias-bg-module-platform,rgba(128,128,128,.14));font-weight:500}',
  'body[' + ATTR + '] .dvb-select-option.is-disabled{opacity:.4;cursor:not-allowed}',
  'body[' +
    ATTR +
    '] .dvb-select-option-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  'body[' +
    ATTR +
    '] .dvb-select-check{width:14px;height:14px;flex:none;color:var(--dsw-alias-label-primary,currentColor);stroke-width:2.4}',
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
    '] .dvb-mask{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.35);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}',
  'body[' +
    ATTR +
    '] .dvb-dialog{width:min(400px,92vw);background:var(--dsw-alias-bg-layer-1,#ffffff);border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.22));border-radius:16px;box-shadow:0 20px 48px -8px rgba(0,0,0,.16),0 0 0 1px rgba(0,0,0,.04);padding:22px 24px;display:flex;flex-direction:column;gap:12px;box-sizing:border-box;color:var(--dsw-alias-label-primary,inherit);animation:dvbDialogIn .2s cubic-bezier(0.16,1,0.3,1)}',
  '@keyframes dvbDialogIn{from{opacity:0;transform:scale(0.96)}to{opacity:1;transform:scale(1)}}',
  'body[' + ATTR + '] .dvb-dialog-header{display:flex;align-items:center;justify-content:space-between;gap:12px}',
  'body[' + ATTR + '] .dvb-dialog-title-wrap{display:flex;align-items:center;gap:10px;min-width:0}',
  'body[' +
    ATTR +
    '] .dvb-dialog-icon{flex:none;width:32px;height:32px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center}',
  'body[' +
    ATTR +
    '] .dvb-dialog-icon.is-error{background:rgba(239,68,68,.12);color:var(--dsw-alias-state-error-primary,#ef4444)}',
  'body[' + ATTR + '] .dvb-dialog-icon.is-warn{background:rgba(245,158,11,.12);color:#f59e0b}',
  'body[' +
    ATTR +
    '] .dvb-dialog-icon.is-confirm,body[' +
    ATTR +
    '] .dvb-dialog-icon.is-info{background:rgba(59,130,246,.12);color:var(--dsw-alias-brand-primary,#3b82f6)}',
  'body[' +
    ATTR +
    '] .dvb-dialog-title{font-size:16px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary,inherit)}',
  'body[' +
    ATTR +
    '] .dvb-dialog-close{width:28px;height:28px;border-radius:8px;border:none;background:transparent;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.7));cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;transition:all .15s ease}',
  'body[' +
    ATTR +
    '] .dvb-dialog-close:hover{color:var(--dsw-alias-label-primary,inherit);background:var(--dsw-alias-bg-module-platform,rgba(128,128,128,.1))}',
  'body[' +
    ATTR +
    '] .dvb-dialog-body{font-size:14px;line-height:1.6;color:var(--dsw-alias-label-secondary,inherit);opacity:.9;word-break:break-word;padding:2px 0 6px}',
  'body[' + ATTR + '] .dvb-dialog-footer{display:flex;justify-content:flex-end;gap:10px;padding-top:4px}',
  'body[' +
    ATTR +
    '] .dvb-dialog-btn{height:34px;padding:0 18px;border-radius:8px;font-size:13px;font-weight:500;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;transition:all .15s ease}',
  'body[' + ATTR + '] .dvb-dialog-btn:active{transform:scale(0.98)}',
  'body[' +
    ATTR +
    '] .dvb-dialog-btn-cancel{border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3))!important;background:var(--dsw-alias-bg-base,#ffffff)!important;color:var(--dsw-alias-label-primary,inherit)!important}',
  'body[' +
    ATTR +
    '] .dvb-dialog-btn-cancel:hover{background:var(--dsw-alias-bg-module-platform,rgba(128,128,128,.08))!important;border-color:var(--dsw-alias-border-l1,rgba(128,128,128,.5))!important}',
  'body[' +
    ATTR +
    '] .dvb-dialog-btn-primary{border:1px solid transparent!important;background:var(--dsw-alias-brand-primary,#3b82f6)!important;color:#ffffff!important;box-shadow:0 1px 3px rgba(59,130,246,.3)}',
  'body[' + ATTR + '] .dvb-dialog-btn-primary:hover{opacity:.92;box-shadow:0 3px 10px rgba(59,130,246,.4)}',
  'body[' +
    ATTR +
    '] .dvb-dialog-btn-danger{border:1px solid transparent!important;background:var(--dsw-alias-state-error-primary,#ef4444)!important;color:#ffffff!important;box-shadow:0 1px 3px rgba(239,68,68,.3)}',
  'body[' + ATTR + '] .dvb-dialog-btn-danger:hover{opacity:.92;box-shadow:0 3px 10px rgba(239,68,68,.4)}',
  'body[' +
    ATTR +
    '] .dvb-btn-danger-solid{background:var(--dsw-alias-label-danger,#e53935)!important;color:#ffffff!important;border-color:transparent!important}',
  'body[' + ATTR + '] .dvb-btn-danger-solid:hover{opacity:.9}',
  'body[' +
    ATTR +
    '] .dvb-btn-danger-hover:hover{color:var(--dsw-alias-label-danger,#e53935)!important;border-color:var(--dsw-alias-label-danger,#e53935)!important}',
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
