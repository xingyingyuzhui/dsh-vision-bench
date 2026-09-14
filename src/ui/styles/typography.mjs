import { ATTR } from './base.mjs'

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
    '--dvb-radius-btn:6px;' +
    '--dvb-radius-card:8px;' +
    '--dvb-border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.28));' +
    '--dvb-bg-panel:var(--dsw-alias-bg-layer-1,#fff)' +
    '}',
  'body[' +
    ATTR +
    '] .dvb-page,body[' +
    ATTR +
    '] .dvb-workspace{font-family:var(--dvb-font-family);font-size:var(--dvb-font-size-base, 13px);line-height:var(--dvb-line-height-base, 1.5)}',
  'body[' +
    ATTR +
    '] .dvb-text-xs{font-size:var(--dvb-font-size-xs,11px)}.dvb-text-sm{font-size:var(--dvb-font-size-sm,12px)}.dvb-text-base{font-size:var(--dvb-font-size-base,13px)}.dvb-text-md{font-size:var(--dvb-font-size-md,14px)}.dvb-text-lg{font-size:var(--dvb-font-size-lg,16px)}.dvb-text-xl{font-size:var(--dvb-font-size-xl,18px)}.dvb-text-mono{font-family:var(--dvb-font-family-mono);font-variant-numeric:tabular-nums}.dvb-font-medium{font-weight:500}.dvb-font-semibold{font-weight:600}.dvb-font-bold{font-weight:700}',
]
