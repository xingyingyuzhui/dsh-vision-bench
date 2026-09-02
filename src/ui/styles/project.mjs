import { ATTR } from './base.mjs'

export const PROJECT_CSS = [
  'body[' + ATTR + '] .dvb-project{display:flex;flex-direction:column;gap:8px;min-height:0;flex:1}',
  'body[' +
    ATTR +
    '] .dvb-project-head{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding-bottom:4px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.14))}',
  'body[' + ATTR + '] .dvb-project-split{display:flex;gap:10px;min-height:0;flex:1;align-items:stretch}',
  'body[' +
    ATTR +
    '] .dvb-project-nav{flex:0 0 38%;min-width:240px;max-width:420px;display:flex;flex-direction:column;gap:6px;min-height:0;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.22));border-radius:8px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.04));overflow:hidden}',
  'body[' +
    ATTR +
    '] .dvb-project-preview{flex:1 1 0;min-width:0;min-height:0;display:flex;flex-direction:column;gap:6px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.22));border-radius:8px;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.02));overflow:hidden}',
  'body[' + ATTR + '] .dvb-project-nav-scroll{flex:1;min-height:0;overflow:auto;padding:8px 10px}',
  'body[' + ATTR + '] .dvb-project-preview-body{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}',
  'body[' + ATTR + '] .dvb-project-preview-empty{flex:1;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center}',
  'body[' + ATTR + '] .dvb-project-chip{font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.28));opacity:.85}',
  'body[' + ATTR + '] .dvb-map-block{display:flex;flex-direction:column;gap:3px;margin:0;padding:8px 10px;border-top:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.14))}',
  'body[' + ATTR + '] .dvb-map-label{font-size:11px;font-weight:600;opacity:.7}',
  'body[' +
    ATTR +
    '] .dvb-map-path{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;opacity:.8;line-height:1.4;padding:2px 0}',
  'body[' + ATTR + '] .dvb-map-defs{font-size:11px;opacity:.78;line-height:1.45}',
  'body[' + ATTR + '] .dvb-map-group{margin-top:6px}',
  'body[' + ATTR + '] .dvb-map-group:first-child{margin-top:0}',
  'body[' + ATTR + '] .dvb-map-group-name{font-size:12px;font-weight:600;padding:4px 0}',
  'body[' + ATTR + '] .dvb-map-file-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  'body[' + ATTR + '] .dvb-map-file-mark{font-size:10px;opacity:.7;flex:none;padding:0 5px;border-radius:4px;border:1px solid currentColor}',
  'body[' + ATTR + '] .dvb-map-funcs{font-size:11px;opacity:.72;padding:0 0 4px 8px;line-height:1.4;border-left:2px solid var(--dsw-alias-border-l2,rgba(128,128,128,.2));margin-left:10px}',
  'body[' + ATTR + '] .dvb-map-tree{outline:none}',
  'body[' +
    ATTR +
    '] .dvb-map-file-row.is-on{background:var(--dsw-alias-bg-layer-2,rgba(79,142,247,.12));border-radius:6px}',
  'body[' +
    ATTR +
    '] .dvb-source-editor{border:0;border-radius:0;min-height:200px;flex:1;overflow:hidden}',
  'body[' + ATTR + '] .dvb-source-editor .cm-editor{height:100%}',
  'body[' + ATTR + '] .dvb-cm-jump{background:rgba(79,142,247,.22)}',
  'body[' +
    ATTR +
    '] .dvb-map-file[data-kind="missing"] .dvb-map-file-name,body[' +
    ATTR +
    '] .dvb-map-path[data-kind="missing"]{color:var(--dsw-alias-label-danger,#c62828)}',
  'body[' + ATTR + '] .dvb-map-file[data-kind="unread"] .dvb-map-file-name{opacity:.55}',
  'body[' +
    ATTR +
    '] .dvb-map-file[data-kind="out"] .dvb-map-file-name,body[' +
    ATTR +
    '] .dvb-map-path[data-kind="out"]{opacity:.6}',
  'body[' + ATTR + '] .dvb-map-search{min-width:150px;flex:1 1 180px}',
  'body[' + ATTR + '] .dvb-map-filter{width:auto}',
  'body[' +
    ATTR +
    '] .dvb-map-group-name{display:flex;gap:6px;align-items:center;font-weight:600;padding:6px 0;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.12))}',
  'body[' + ATTR + '] .dvb-map-file-row{padding:2px 4px}',
  'body[' + ATTR + '] .dvb-map-file{display:flex;gap:6px;align-items:center;min-width:0}',
  'body[' + ATTR + '] .dvb-map-file[data-kind="missing"]{opacity:.85}',
  'body[' + ATTR + '] .dvb-map-file[data-kind="unread"]{opacity:.9}',
  'body[' + ATTR + '] .dvb-map-file[data-kind="out"]{opacity:.75}',
  'body[' + ATTR + '] .dvb-map-file-name{font-family:ui-monospace,Menlo,monospace;font-size:12px;text-align:left}',
  'body[' +
    ATTR +
    '] .dvb-map-file.dvb-map-jump .dvb-map-file-name{outline:2px solid #e0912f;outline-offset:1px;border-radius:4px}',
  'body[' + ATTR + '] .dvb-map-func{display:flex;gap:8px;align-items:center;font-family:ui-monospace,Menlo,monospace;font-size:11px;padding:1px 0}',
  'body[' + ATTR + '] .dvb-map-func[data-jump="true"]{background:rgba(224,145,47,.14);border-radius:4px;padding:0 4px}',
  'body[' + ATTR + '] .dvb-map-toggle{min-width:18px;padding:0 2px;font-size:10px;flex:none}',
  'body[' + ATTR + '] .dvb-map-toggle-void{opacity:.35;width:18px;text-align:center}',
  'body[' + ATTR + '] .dvb-map-cfg-toggle{margin:0;width:100%;text-align:left;font-size:12px}',
  'body[' + ATTR + '] .dvb-map-preview{max-height:320px;overflow:auto;white-space:pre;font-size:11px;line-height:1.5}',
  'body[' + ATTR + '] .dvb-project-file-menu{position:relative;flex:none}',
  'body[' +
    ATTR +
    '] .dvb-project-file-menu-pop{position:absolute;top:calc(100% + 2px);right:0;z-index:30;display:flex;flex-direction:column;gap:2px;min-width:132px;padding:6px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:8px;background:var(--dsw-alias-bg-layer-1,#1e1e1e);box-shadow:0 4px 16px rgba(0,0,0,.18)}',
  'body[' +
    ATTR +
    '] .dvb-project-file-menu-pop .dvb-btn{width:100%;justify-content:flex-start;border:0;background:transparent}',
  'body[' + ATTR + '] .dvb-project-file-menu-pop .dvb-btn:hover{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.12))}',
  'body[' + ATTR + '] .dvb-map-file-actions{display:flex;gap:4px;align-items:center;flex:none;margin-left:auto}',
  'body[' + ATTR + '] .dvb-project-view-toggle{display:inline-flex;gap:4px;align-items:center}',
  'body[' +
    ATTR +
    '] .dvb-project-focus-chip{font-size:11px;padding:3px 10px;border-radius:999px;border:1px solid var(--dsw-alias-label-info,#4f8ef7);color:var(--dsw-alias-label-info,#4f8ef7);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  'body[' + ATTR + '] .dvb-graph-wrap{display:flex;flex-direction:column;gap:6px;min-height:0;height:100%}',
  'body[' + ATTR + '] .dvb-graph-toolbar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:0 2px}',
  'body[' + ATTR + '] .dvb-graph-legend{font-size:10px;opacity:.65;margin-left:4px}',
  'body[' + ATTR + '] .dvb-graph-host{flex:1;min-height:220px;overflow:hidden;position:relative;border-radius:6px;background:radial-gradient(circle at 20% 10%,rgba(79,142,247,.08),transparent 42%),var(--dsw-alias-bg-layer-1,rgba(0,0,0,.12));cursor:grab}',
  'body[' + ATTR + '] .dvb-graph-host:active{cursor:grabbing}',
  'body[' + ATTR + '] .dvb-graph-svg{display:block}',
  'body[' + ATTR + '] .dvb-graph-cluster-box{fill:rgba(79,142,247,.04);stroke:var(--dsw-alias-border-l2,rgba(128,128,128,.28));stroke-width:1}',
  'body[' + ATTR + '] .dvb-graph-cluster-label{font-size:11px;font-weight:600;fill:var(--dsw-alias-text-secondary,rgba(255,255,255,.65))}',
  'body[' + ATTR + '] .dvb-graph-node{cursor:pointer;outline:none}',
  'body[' + ATTR + '] .dvb-graph-node:focus-visible .dvb-graph-node-box{stroke:var(--dsw-alias-label-info,#4f8ef7);stroke-width:2;filter:drop-shadow(0 0 4px rgba(79,142,247,.45))}',
  'body[' + ATTR + '] .dvb-graph-node-box{fill:var(--dsw-alias-bg-layer-2,rgba(15,23,42,.72));stroke:var(--dsw-alias-border-l2,rgba(148,163,184,.35));stroke-width:1;transition:stroke .15s,filter .15s}',
  'body[' + ATTR + '] .dvb-graph-node.is-on .dvb-graph-node-box{stroke:var(--dsw-alias-label-info,#4f8ef7);stroke-width:2;filter:drop-shadow(0 0 6px rgba(79,142,247,.35))}',
  'body[' + ATTR + '] .dvb-graph-node.is-near .dvb-graph-node-box{stroke:rgba(79,142,247,.55)}',
  'body[' + ATTR + '] .dvb-graph-node[data-kind="missing"] .dvb-graph-node-box{stroke:var(--dsw-alias-label-danger,#c62828)}',
  'body[' + ATTR + '] .dvb-graph-node[data-kind="outside"] .dvb-graph-node-box{opacity:.72}',
  'body[' + ATTR + '] .dvb-graph-node-label{font-size:12px;font-weight:600;fill:var(--dsw-alias-text-primary,#fff)}',
  'body[' + ATTR + '] .dvb-graph-node-sub{font-size:10px;fill:var(--dsw-alias-text-secondary,rgba(255,255,255,.55))}',
  'body[' + ATTR + '] .dvb-graph-edge{fill:none;stroke:rgba(148,163,184,.45);stroke-width:1.4}',
  'body[' + ATTR + '] .dvb-graph-edge.is-on{stroke:var(--dsw-alias-label-info,#4f8ef7);stroke-width:2.2}',
  'body[' + ATTR + '] .dvb-graph-edge.is-weak{stroke-dasharray:4 4;opacity:.55}',
  'body[' + ATTR + '] .dvb-graph-arrowhead{fill:rgba(148,163,184,.7)}',
  'body[' + ATTR + '] .dvb-graph-empty,.dvb-graph-hint{padding:8px 4px}',
  '@media (max-width:960px){body[' +
    ATTR +
    '] .dvb-project-split{flex-direction:column}body[' +
    ATTR +
    '] .dvb-project-nav{flex:1 1 auto;max-width:none;min-height:200px}body[' +
    ATTR +
    '] .dvb-project-preview{min-height:240px}}',
  '@media (prefers-reduced-motion:reduce){body[' +
    ATTR +
    '] .dvb-graph-node-box{transition:none}}',
]
