import { ATTR } from './base.mjs'

/**
 * Vision design tokens on the plugin root.
 * Host `--dsw-alias-*` wins when present; fallbacks keep standalone / test renders usable.
 * Domain chart / pill / graph colors stay in feature stylesheets.
 */
export const TYPOGRAPHY_CSS = [
  'body[' +
    ATTR +
    ']{' +
    '--dvb-font-scale:1;' +
    '--dvb-font-size-base:calc(var(--dvb-font-scale, 1) * 13px);' +
    '--dvb-font-size-sm:calc(var(--dvb-font-scale, 1) * 12px);' +
    '--dvb-font-size-xs:calc(var(--dvb-font-scale, 1) * 11px);' +
    '--dvb-font-size-md:calc(var(--dvb-font-scale, 1) * 14px);' +
    '--dvb-font-size-lg:calc(var(--dvb-font-scale, 1) * 16px);' +
    '--dvb-font-size-xl:calc(var(--dvb-font-scale, 1) * 18px);' +
    '--dvb-line-height-tight:1.25;' +
    '--dvb-line-height-normal:1.45;' +
    '--dvb-line-height-base:1.5;' +
    '--dvb-line-height-relaxed:1.6;' +
    '--dvb-font-weight-regular:400;' +
    '--dvb-font-weight-medium:500;' +
    '--dvb-font-weight-semibold:600;' +
    '--dvb-font-weight-bold:700;' +
    '--dvb-font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;' +
    '--dvb-font-family-mono:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;' +
    '--dvb-space-1:4px;' +
    '--dvb-space-2:8px;' +
    '--dvb-space-3:12px;' +
    '--dvb-space-4:16px;' +
    '--dvb-space-5:24px;' +
    '--dvb-space-control:10px;' +
    '--dvb-control-height:28px;' +
    '--dvb-radius-sm:4px;' +
    '--dvb-radius-btn:6px;' +
    '--dvb-radius-card:8px;' +
    '--dvb-radius-popover:10px;' +
    '--dvb-radius-dialog:16px;' +
    '--dvb-radius-pill:999px;' +
    '--dvb-color-fg:var(--dsw-alias-label-primary,inherit);' +
    '--dvb-color-fg-muted:var(--dsw-alias-label-secondary,rgba(128,128,128,.72));' +
    '--dvb-color-fg-subtle:var(--dsw-alias-label-tertiary,rgba(128,128,128,.7));' +
    '--dvb-color-success:var(--dsw-alias-label-success,#2e7d32);' +
    '--dvb-color-danger:var(--dsw-alias-label-danger,#c62828);' +
    '--dvb-color-warning:var(--dsw-alias-label-warning,#b45309);' +
    '--dvb-color-info:var(--dsw-alias-label-info,#4f8ef7);' +
    '--dvb-color-brand:var(--dsw-alias-brand-primary,#3b82f6);' +
    '--dvb-color-error:var(--dsw-alias-state-error-primary,#ef4444);' +
    '--dvb-color-exec-line:rgba(250,204,21,.35);' +
    '--dvb-color-border:var(--dsw-alias-border-l2,rgba(128,128,128,.28));' +
    '--dvb-color-border-strong:var(--dsw-alias-border-l1,rgba(128,128,128,.4));' +
    '--dvb-bg-base:var(--dsw-alias-bg-base,#fff);' +
    '--dvb-bg-surface:var(--dsw-alias-bg-layer-1,#fff);' +
    '--dvb-bg-muted:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.08));' +
    '--dvb-bg-hover:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.12));' +
    '--dvb-bg-panel:var(--dvb-bg-surface);' +
    '--dvb-border:1px solid var(--dvb-color-border);' +
    '--dvb-border-strong:1px solid var(--dvb-color-border-strong);' +
    '--dvb-focus-ring:2px solid var(--dvb-color-brand);' +
    '--dvb-z-sticky:1;' +
    '--dvb-z-raised:10;' +
    '--dvb-z-menu:30;' +
    '--dvb-z-select:1050;' +
    '--dvb-z-popover:4000;' +
    '--dvb-z-modal:2147483000;' +
    '--dvb-mask-bg:rgba(0,0,0,.35)' +
    '}',
  'body[' +
    ATTR +
    '] .dvb-page,body[' +
    ATTR +
    '] .dvb-workspace{font-family:var(--dvb-font-family);font-size:var(--dvb-font-size-base, 13px);line-height:var(--dvb-line-height-base, 1.5)}',
]
