import { createUseGraphCamera } from '../graph/graph-camera.mjs'
import { layoutProjectGraph, polylinePath } from './project-graph-layout.mjs'
import { graphNeighborhood } from './project-graph-model.mjs'

const fileGlyph = (l) => {
  const s = String(l || '').toLowerCase()
  const d = s.lastIndexOf('.')
  return d >= 0 ? s.slice(d + 1, d + 3) || '·' : '·'
}

const FILE_DESC = {
  kind: 'file',
  scopeRoot: '工程',
  scopeFocus: (g) => g?.clusters?.[0]?.label || '全部',
  scopeNote: (s) => `当前范围: 全部 ${s.nodes} 个文件`,
  nodeSubtitle: (n) => String(n?.groupName || ''),
  nodeGlyph: (n) => fileGlyph(n?.label),
}

const CALL_DESC = {
  kind: 'call',
  scopeRoot: '工程',
  scopeFocus: (g) => g?.focus || 'main',
  scopeNote: (s) => s?.scopeNote || '当前范围: main的两层调用',
  nodeSubtitle: (n) => n?.location || n?.groupName || '',
  nodeGlyph: () => 'ƒ',
}

const ZOOM_STEP = 1.15

/**
 * Human-readable truncation hints derived from the graph model's own metadata.
 * Returns an empty list when nothing was dropped, so a clean graph shows no warning.
 * @param {ReturnType<import('./project-graph-model.mjs').buildProjectGraph> | null | undefined} graph
 * @returns {string[]}
 */
export function graphTruncationHints(graph) {
  if (!graph || typeof graph !== 'object') return []
  const stats = graph.truncation && typeof graph.truncation === 'object' ? graph.truncation : {}
  const maxNodes = Number(graph.maxNodes) > 0 ? Number(graph.maxNodes) : 0
  const maxEdges = Number(graph.maxEdges) > 0 ? Number(graph.maxEdges) : 0
  const hints = []

  if (graph.nodesCapped) {
    hints.push(maxNodes ? `节点已截断，仅展示前 ${maxNodes} 个文件` : '节点已截断，仅展示部分文件')
  }
  if (graph.edgesCapped || stats.cappedEdgeCount > 0) {
    const dropped = Number(stats.cappedEdgeCount) || 0
    const tail = dropped > 0 ? `（另有 ${dropped} 条未绘制）` : ''
    hints.push(maxEdges ? `仅展示前 ${maxEdges} 条依赖${tail}` : `依赖已截断${tail}`)
  }
  if (stats.backendTruncated) {
    hints.push('后端已截断依赖列表，当前视图可能不完整')
  }
  if (stats.unresolvedEdgeCount > 0) {
    hints.push(`${stats.unresolvedEdgeCount} 条依赖未解析到工程文件`)
  }
  if (stats.filteredEdgeCount > 0) {
    hints.push(`${stats.filteredEdgeCount} 条依赖被当前筛选隐藏`)
  }
  return hints
}

/** Status badge shown on the card for non-ok nodes; empty for healthy ones. */
function statusBadge(node) {
  if (node.kind === 'missing') return { text: '缺失', tone: 'danger' }
  if (node.kind === 'outside') return { text: '外', tone: 'muted' }
  if (node.kind === 'unread') return { text: '不可读', tone: 'warn' }
  return null
}

export function createProjectGraphView(React) {
  const useGraphCamera = createUseGraphCamera(React)
  return function ProjectGraphView({
    graph,
    selectedId,
    onSelect,
    onClearSelect,
    descriptor: customDescriptor,
    targetLabel = '',
  }) {
    const descriptor = customDescriptor || (graph?.kind === 'call' ? CALL_DESC : FILE_DESC)
    const el = React.createElement
    const hostRef = React.useRef(null)
    const wrapRef = React.useRef(null)
    const layout = React.useMemo(() => layoutProjectGraph(graph), [graph])
    const { camera, applyFit, zoomBy, onPointerDown, onPointerMove, onPointerUp } = useGraphCamera({
      layout,
      hostRef,
    })
    const [hoverEdge, setHoverEdge] = React.useState('')
    const hood = React.useMemo(() => graphNeighborhood(selectedId, graph), [selectedId, graph])

    if (!graph?.nodes?.length) {
      return el(
        'div',
        { className: 'dvb-graph-empty' },
        el('div', { className: 'dvb-hint' }, '没有可绘制的节点。请调整筛选或切换到树形视图。'),
      )
    }

    const stats = { nodes: layout.nodes.length, edges: layout.edges.length, scopeNote: graph.scopeNote }
    const transform = `translate(${camera.panX},${camera.panY}) scale(${camera.scale})`
    const hints = graphTruncationHints(graph)
    const focus = String(targetLabel || descriptor.scopeFocus(graph) || '')

    return el(
      'div',
      { ref: wrapRef, className: 'dvb-graph-wrap', 'data-graph-kind': descriptor.kind },
      el(
        'div',
        { className: 'dvb-graph-scope dvb-graph-toolbar' },
        el(
          'div',
          { className: 'dvb-graph-scope-main' },
          el(
            'span',
            { className: 'dvb-graph-scope-path' },
            el('span', { className: 'dvb-graph-scope-root' }, descriptor.scopeRoot),
            el('span', { className: 'dvb-graph-scope-sep' }, ' / '),
            el('span', { className: 'dvb-graph-scope-focus' }, focus),
          ),
          el('span', { className: 'dvb-graph-scope-note' }, descriptor.scopeNote(stats)),
        ),
        el(
          'div',
          { className: 'dvb-graph-scope-actions' },
          el('button', { type: 'button', className: 'dvb-btn dvb-btn-sm', 'aria-label': '适应画布', onClick: applyFit }, '⛶ 适应画布'),
        ),
        hints.length
          ? el(
              'div',
              { className: 'dvb-graph-hints' },
              ...hints.map((msg, i) => el('span', { key: `hint-${i}`, className: 'dvb-hint dvb-need dvb-graph-hint-chip' }, msg)),
            )
          : null,
      ),
      el(
        'div',
        {
          ref: hostRef,
          className: 'dvb-graph-host',
          onPointerDown,
          onPointerMove,
          onPointerUp,
          onPointerCancel: onPointerUp,
        },
        el(
          'svg',
          {
            className: 'dvb-graph-svg',
          },
          el('defs', null,
            ...[['dvb-graph-arrow', '#94a3b8'], ['dvb-graph-arrow-on', '#1677ff']].map(([id, fill]) =>
              el('marker', { key: id, id, markerWidth: 8, markerHeight: 8, refX: 7, refY: 4, orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse' },
                el('path', { d: 'M0,1L7,4L0,7Z', fill })))),
          el('g', { className: 'dvb-graph-world', transform },
          layout.clusters.map((cluster) =>
            el('g', { key: cluster.id, className: 'dvb-graph-cluster' },
              el('rect', { x: cluster.x, y: cluster.y, width: cluster.w, height: cluster.h, rx: 12, ry: 12, className: 'dvb-graph-cluster-box' }),
              el('path', { d: `M${cluster.x},${cluster.y + cluster.headerH + 0.5} H${cluster.x + cluster.w}`, className: 'dvb-graph-cluster-rule' }),
              el('text', { x: cluster.x + 14, y: cluster.y + 18, className: 'dvb-graph-cluster-label' }, cluster.label),
            ),
          ),
          layout.edges.map((edge) => {
            const active = hood.edgeIds.has(edge.id) || hoverEdge === edge.id || edge.from === selectedId || edge.to === selectedId
            return el('path', {
              key: edge.id,
              d: edge.d || polylinePath(edge.points),
              className: `dvb-graph-edge${active ? ' is-on' : ''}${edge.resolved === false ? ' is-weak' : ''}`,
              markerEnd: active ? 'url(#dvb-graph-arrow-on)' : 'url(#dvb-graph-arrow)',
              onMouseEnter: () => setHoverEdge(edge.id),
              onMouseLeave: () => setHoverEdge(''),
            })
          }),
          layout.nodes.map((node) => {
            const selected = node.id === selectedId
            const neighbor = hood.nodeIds.has(node.id)
            const badge = statusBadge(node)
            const ariaLabel = `${node.label}，${descriptor.nodeSubtitle(node)}${selected ? '，已选中' : ''}`
            return el('g', {
              key: node.id,
              className: `dvb-graph-node${selected ? ' is-on' : ''}${neighbor ? ' is-near' : ''}`,
              'data-kind': node.kind,
              role: 'button',
              tabIndex: 0,
              'aria-label': ariaLabel,
              transform: `translate(${node.x},${node.y})`,
              onPointerDown(ev) { ev.stopPropagation() },
              onClick(ev) { ev.stopPropagation(); onSelect(node) },
              onKeyDown(ev) {
                if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); onSelect(node) }
                else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); onClearSelect?.() }
              },
            },
            el('rect', { width: node.w, height: node.h, rx: 8, ry: 8, className: 'dvb-graph-node-box' }),
            el('text', { x: 22, y: 30, className: 'dvb-graph-node-glyph', textAnchor: 'middle', dominantBaseline: 'central' }, descriptor.nodeGlyph(node)),
            el('text', { x: 40, y: 23, className: 'dvb-graph-node-label' }, node.label.length > 20 ? `${node.label.slice(0, 18)}…` : node.label),
            el('text', { x: 40, y: 41, className: 'dvb-graph-node-sub' }, descriptor.nodeSubtitle(node)),
            badge
              ? el(
                  'g',
                  { className: 'dvb-graph-node-badge', 'data-tone': badge.tone },
                  el('rect', { x: node.w - 10 - badge.text.length * 11 - 12, y: 8, width: badge.text.length * 11 + 12, height: 18, rx: 9 }),
                  el(
                    'text',
                    {
                      x: node.w - 10 - badge.text.length * 5.5 - 6,
                      y: 17,
                      textAnchor: 'middle',
                      dominantBaseline: 'central',
                    },
                    badge.text,
                  ),
                )
              : null,
            (node.canExpand || node.expandBadge)
              ? el(
                  'g',
                  { className: 'dvb-graph-node-expand-badge' },
                  el('rect', { x: node.w - 56, y: -8, width: 56, height: 18, rx: 9, className: 'dvb-graph-node-expand-bg' }),
                  el(
                    'text',
                    {
                      x: node.w - 28,
                      y: 1,
                      textAnchor: 'middle',
                      dominantBaseline: 'central',
                      className: 'dvb-graph-node-expand-text',
                    },
                    node.expandBadge || '+1 可展开',
                  ),
                )
              : null,
            )
          }),
          ),
        ),
          el('div', { className: 'dvb-graph-zoom-bar' },
            el('button', { type: 'button', className: 'dvb-graph-zoom-btn', onClick: (e) => { e.stopPropagation(); zoomBy(1 / ZOOM_STEP) }, title: '缩小', 'aria-label': '缩小' }, '－'),
            el('button', { type: 'button', className: 'dvb-graph-zoom-btn dvb-graph-zoom-val', onClick: (e) => { e.stopPropagation(); applyFit() }, title: '适应画布', 'aria-label': '适应画布' }, `${Math.round(camera.scale * 100)}%`),
            el('button', { type: 'button', className: 'dvb-graph-zoom-btn', onClick: (e) => { e.stopPropagation(); zoomBy(ZOOM_STEP) }, title: '放大', 'aria-label': '放大' }, '＋'),
            el('button', { type: 'button', className: 'dvb-graph-zoom-btn', onClick: (e) => { e.stopPropagation(); applyFit() }, title: '适应画布', 'aria-label': '适应画布' }, '⛶'),
          ),
      ),
    )
  }
}
