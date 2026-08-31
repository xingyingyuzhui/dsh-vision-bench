import { ATTR } from './base.mjs'

export const TABLE_CSS = [
  'body[' + ATTR + '] .dvb-data-table{width:100%;min-width:0;font-size:12px}',
  'body[' +
    ATTR +
    '] .dvb-data-table-head,body[' +
    ATTR +
    '] .dvb-data-table-row{display:grid;gap:8px;align-items:center;padding:4px 8px;box-sizing:border-box}',
  'body[' +
    ATTR +
    '] .dvb-data-table-head{position:sticky;top:0;z-index:1;font-weight:500;opacity:.72;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.28));background:var(--dsw-alias-bg-layer-1,#fff)}',
  'body[' + ATTR + '] .dvb-data-table-row{border-bottom:1px solid rgba(128,128,128,.1);min-height:32px}',
  'body[' + ATTR + '] .dvb-data-table-row:hover{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.08))}',
  'body[' +
    ATTR +
    '] .dvb-data-table-row.is-on,body[' +
    ATTR +
    '] .dvb-data-table-row:focus{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.12))}',
  'body[' +
    ATTR +
    '] .dvb-data-table-row[data-status="error"],body[' +
    ATTR +
    '] .dvb-data-table-row[data-ok="false"]{color:var(--dsw-alias-label-danger,#c62828)}',
  'body[' + ATTR + '] .dvb-data-th,.dvb-data-td{min-width:0;overflow:hidden;text-overflow:ellipsis}',
  'body[' +
    ATTR +
    '] .dvb-data-th-sort{background:none;border:0;color:inherit;font:inherit;cursor:pointer;text-align:left;padding:0}',
  'body[' +
    ATTR +
    '] .dvb-data-table-scroll{min-height:0;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.28));border-radius:4px;overscroll-behavior:contain}',
  'body[' + ATTR + '] .dvb-data-ops{display:flex;flex-wrap:wrap;gap:4px;align-items:center}',
  '@media (prefers-color-scheme: dark){body[' +
    ATTR +
    '] .dvb-data-table-head{background:var(--dsw-alias-bg-layer-1,#1e1e1e)}}',
]
