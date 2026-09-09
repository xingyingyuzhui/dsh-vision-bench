import { ATTR } from './base.mjs'

export const FRAMES_CSS = [
  `body[${ATTR}] .dvb-frames{flex-basis:100%;font-family:var(--dvb-font-family-mono,ui-monospace,monospace);font-size:var(--dvb-font-size-sm,12px);line-height:1.5;opacity:.72;word-break:break-all}.dvb-frames-page{display:flex;flex-direction:column;gap:8px}.dvb-frames-virtual{border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.28));border-radius:4px;background:var(--dsw-alias-bg-layer-1,#fff);overscroll-behavior:contain}.dvb-frames-virtual .dvb-live-row{border-bottom:1px solid rgba(128,128,128,.08);padding:6px 8px;box-sizing:border-box}.dvb-frames-virtual .dvb-live-row:hover{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.08))}@media (prefers-color-scheme: dark){.dvb-frames-virtual{background:var(--dsw-alias-bg-layer-1,#1e1e1e)}}`,
]
