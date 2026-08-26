import { ATTR } from './base.mjs'

export const SIDEBAR_CSS = [
  'body[' +
    ATTR +
    '] .dvb-live{width:100%;height:100%;box-sizing:border-box;display:flex;flex-direction:column;gap:8px;padding:10px 12px}',
  'body[' + ATTR + '] .dvb-live-head{display:flex;align-items:center;justify-content:space-between;gap:8px}',
  'body[' + ATTR + '] .dvb-live-title{font-size:12px;font-weight:600}',
  'body[' + ATTR + '] .dvb-live-dot{width:8px;height:8px;border-radius:999px;background:rgba(128,128,128,.45)}',
  'body[' + ATTR + '] .dvb-live-dot[data-kind="live"]{background:var(--dsw-alias-label-success,#2e7d32)}',
  'body[' + ATTR + '] .dvb-live-dot[data-kind="err"]{background:var(--dsw-alias-label-danger,#c62828)}',
  'body[' + ATTR + '] .dvb-live-controls{display:flex;gap:6px;align-items:center}',
  'body[' + ATTR + '] .dvb-live-interval{width:72px;height:28px;padding:0 6px}',
  'body[' + ATTR + '] .dvb-live-list{overflow:auto;min-height:0;flex:1;display:flex;flex-direction:column;gap:0}',
  'body[' +
    ATTR +
    '] .dvb-live-row{display:flex;gap:8px;align-items:baseline;justify-content:space-between;font-size:12px;line-height:1.45;padding:3px 0;border-bottom:1px solid rgba(128,128,128,.1)}',
  'body[' +
    ATTR +
    '] .dvb-live-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.78}',
  'body[' + ATTR + '] .dvb-live-row[data-ok="false"] .dvb-val{color:var(--dsw-alias-label-danger,#c62828)}',
  'body[' + ATTR + '] .dvb-live-close{height:24px;width:24px;padding:0;border:0;opacity:.65}',
  'body[' + ATTR + '] .dvb-btn-write{color:var(--dsw-alias-label-warning,#b45309)}',
  'body[' +
    ATTR +
    '] .dvb-btn-write.is-on,body[' +
    ATTR +
    '] .dvb-btn-write.dvb-btn-primary{font-weight:600;border-color:currentColor}',
  'body[' + ATTR + '] .dvb-write-panel{border-color:var(--dsw-alias-border-l1,rgba(128,128,128,.55))}',
  'body[' + ATTR + '] .dvb-write-inline{display:flex;flex-direction:column;gap:6px;padding:8px 10px;font-size:12px}',
  'body[' + ATTR + '] .dvb-write-head{display:flex;gap:8px;align-items:center;justify-content:space-between}',
  'body[' +
    ATTR +
    '] .dvb-write-title{font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  'body[' + ATTR + '] .dvb-write-form{display:flex;gap:6px;align-items:center}',
  'body[' + ATTR + '] .dvb-write-form .dvb-input{flex:1;min-width:0;height:26px}',
  'body[' +
    ATTR +
    '] .dvb-write-result{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.5;word-break:break-all}',
  'body[' + ATTR + '] .dvb-write-result[data-kind="ok"]{color:var(--dsw-alias-label-success,#2e7d32)}',
  'body[' + ATTR + '] .dvb-write-result[data-kind="err"]{color:var(--dsw-alias-label-danger,#c62828)}',
  'body[' + ATTR + '] .dvb-write-note{display:block;font-family:inherit;opacity:.65;margin-top:2px}',
  'body[' +
    ATTR +
    '] .dvb-live-edit{height:20px;width:22px;padding:0;font-size:11px;line-height:1;flex:none;align-self:center}',
  'body[' + ATTR + '] .dvb-live-row .dvb-live-name{flex:1}',
  'body[' + ATTR + '] .dvb-bindbar{display:flex;gap:8px;align-items:center}',
  'body[' + ATTR + '] .dvb-serial-log{display:flex;flex-direction:column;max-height:260px}',
  'body[' + ATTR + '] .dvb-serial-line{white-space:pre-wrap;word-break:break-all}',
  'body[' + ATTR + '] .dvb-serial-line[data-kind="err"]{color:var(--dsw-alias-label-danger,#c62828)}',
  'body[' + ATTR + '] .dvb-serial-line[data-kind="warn"]{color:var(--dsw-alias-label-warning,#b45309)}',
  'body[' +
    ATTR +
    '] .dvb-csv-area{height:auto;padding:6px 8px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;resize:vertical}',
]
