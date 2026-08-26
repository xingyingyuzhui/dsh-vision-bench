import { ATTR } from './base.mjs'

export const VISUALIZATION_CSS = [
  'body[' +
    ATTR +
    '] .dvb-trend-canvas{width:100%;max-width:560px;height:190px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.28));border-radius:4px}',
  'body[' +
    ATTR +
    '] .dvb-uplot{width:100%;max-width:560px;height:190px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.28));border-radius:4px;overflow:hidden;background:var(--dsw-alias-bg-layer-1,transparent);position:relative}',
  'body[' + ATTR + '] .dvb-uplot .uplot{width:100%;height:100%}',
  'body[' + ATTR + '] .dvb-uplot .u-select{background:rgba(79,142,247,.18);border:1px solid rgba(79,142,247,.35)}',
  '@media (prefers-color-scheme: dark){body[' +
    ATTR +
    '] .dvb-uplot{border-color:rgba(255,255,255,.12)}body[' +
    ATTR +
    '] .dvb-uplot .u-select{background:rgba(79,142,247,.25)}}',
  'body[' + ATTR + '] .dvb-trend-legend{display:flex;flex-direction:column;gap:2px}',
  'body[' + ATTR + '] .dvb-trend-row{display:flex;gap:8px;align-items:baseline;font-size:12px;line-height:1.5}',
  'body[' + ATTR + '] .dvb-trend-dot{width:8px;height:8px;border-radius:999px;flex:none;align-self:center}',
  'body[' +
    ATTR +
    '] .dvb-trend-name{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.78}',
  'body[' + ATTR + '] .dvb-viz{display:flex;flex-direction:column;gap:12px;min-height:0}',
  'body[' +
    ATTR +
    '] .dvb-viz-page-head{align-items:flex-end;padding-bottom:4px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.18))}',
  'body[' + ATTR + '] .dvb-viz-page-title-block{display:flex;flex-direction:column;gap:2px;min-width:0}',
  'body[' + ATTR + '] .dvb-viz-list{display:flex;flex-direction:column;gap:12px}',
  'body[' +
    ATTR +
    '] .dvb-viz-card{padding:12px 14px;gap:10px;background:var(--dsw-alias-bg-layer-1,transparent);border-color:var(--dsw-alias-border-l2,rgba(128,128,128,.28))}',
  'body[' + ATTR + '] .dvb-viz-card.dvb-viz-degraded{border-color:rgba(180,83,9,.45)}',
  'body[' +
    ATTR +
    '] .dvb-viz-head{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}',
  'body[' + ATTR + '] .dvb-viz-head-main{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1 1 160px}',
  'body[' + ATTR + '] .dvb-viz-title-row{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}',
  'body[' + ATTR + '] .dvb-viz-title{font-size:14px;font-weight:600;letter-spacing:.01em}',
  'body[' + ATTR + '] .dvb-viz-type{font-size:11px;opacity:.62;padding:1px 0}',
  'body[' + ATTR + '] .dvb-viz-meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:11px;opacity:.7}',
  'body[' + ATTR + '] .dvb-viz-head-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}',
  'body[' + ATTR + '] .dvb-viz-body-wrap{min-height:48px;padding-top:2px}',
  'body[' + ATTR + '] .dvb-viz-empty{align-items:flex-start;gap:8px;padding:28px 16px}',
  'body[' + ATTR + '] .dvb-viz-empty-title{font-size:13px;font-weight:600}',
  'body[' + ATTR + '] .dvb-viz-bars{display:flex;flex-direction:column;gap:6px}',
  'body[' +
    ATTR +
    '] .dvb-viz-bar-row{display:grid;grid-template-columns:max-content 1fr max-content;gap:8px;align-items:center}',
  'body[' +
    ATTR +
    '] .dvb-viz-bar-track{position:relative;height:14px;background:rgba(128,128,128,.12);border-radius:3px;overflow:hidden}',
  'body[' +
    ATTR +
    '] .dvb-viz-bar-zero-line{position:absolute;left:50%;top:0;bottom:0;width:1px;background:rgba(128,128,128,.45);transform:translateX(-50%);pointer-events:none}',
  'body[' +
    ATTR +
    '] .dvb-viz-bar-fill{position:absolute;top:0;height:100%;background:#4f8ef7;border-radius:2px;min-width:1px;transition:width .2s,left .2s,right .2s}',
  'body[' + ATTR + '] .dvb-viz-bar-fill.dvb-viz-bar-pos{left:50%;transform-origin:left center}',
  'body[' + ATTR + '] .dvb-viz-bar-fill.dvb-viz-bar-neg{right:50%;background:#e0912f;transform-origin:right center}',
  'body[' +
    ATTR +
    '] .dvb-viz-bar-fill.dvb-viz-bar-zero{left:50%;width:2px!important;min-width:2px;background:rgba(128,128,128,.5);transform:translateX(-50%)}',
  'body[' + ATTR + '] .dvb-viz-bar-missing{display:inline-block;padding:0 8px;font-size:11px;opacity:.6}',
  'body[' + ATTR + '] .dvb-viz-card.dvb-viz-focused{outline:2px solid #4f8ef7;outline-offset:-2px}',
  'body[' + ATTR + '] .dvb-viz-value-card{display:flex;flex-direction:column;gap:4px;padding:8px 0 2px}',
  'body[' +
    ATTR +
    '] .dvb-viz-value{font-size:28px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.15}',
  'body[' + ATTR + '] .dvb-viz-value-stale{opacity:.45}',
  'body[' + ATTR + '] .dvb-viz-value-name{font-size:12px;opacity:.7}',
  'body[' + ATTR + '] .dvb-viz-value-unit{font-size:12px;opacity:.55}',
  'body[' + ATTR + '] .dvb-viz-switch-card{display:flex;flex-direction:column;gap:8px;padding:6px 0}',
  'body[' + ATTR + '] .dvb-viz-picker{display:flex;flex-direction:column;gap:8px;margin-top:4px}',
  'body[' +
    ATTR +
    '] .dvb-viz-picker-list{max-height:220px;overflow:auto;display:flex;flex-direction:column;gap:4px;padding:6px 0;border-top:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.14))}',
  'body[' +
    ATTR +
    '] .dvb-viz-picker-opt{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:4px 2px;font-size:12px}',
]
