// @ts-check

import { createUseGraphCamera } from '../graph/graph-camera.mjs'
import { computeNeighborhood } from '../graph/graph-focus.mjs'
import { polylinePath, renderCommonSvgMarkers, routeCurvedEdge } from '../graph/graph-svg-primitives.mjs'

const NODE_W = 160
const NODE_H = 48
const CLUSTER_PAD = 14
const CLUSTER_HEADER_H = 26
const CLUSTER_GAP = 48
const NODE_GAP = 12
const MARGIN = 32

/**
 * Layouts a program graph into columns grouped by file clusters.
 * Deterministic and cached purely on graph topology.
 *
 * @param {{
 *   nodes: Array<{ id: string, label: string, kind: string, fileId?: string }>,
 *   edges: Array<{ id: string, from: string, to: string, kind: string, label?: string }>,
 *   files: Array<{ id: string, name: string }>,
 * }} graph
 */
export function layoutRuntimeProgramGraph(graph) {
  const nodes = graph.nodes || []
  const edges = graph.edges || []
  const files = graph.files || []

  // Group nodes by file
  const nodesByFile = new Map()
  for (const f of files) {
    nodesByFile.set(f.id, [])
  }
  for (const n of nodes) {
    const fId = n.fileId || 'unknown'
    const list = nodesByFile.get(fId) || []
    list.push(n)
    nodesByFile.set(fId, list)
  }

  const layoutNodes = []
  const layoutClusters = []
  let cursorX = MARGIN
  let maxBottom = MARGIN

  for (const [fileId, fileNodes] of nodesByFile.entries()) {
    if (!fileNodes.length) continue

    const clusterW = NODE_W + CLUSTER_PAD * 2
    const nodesH = fileNodes.length * NODE_H + Math.max(0, fileNodes.length - 1) * NODE_GAP
    const clusterH = CLUSTER_HEADER_H + CLUSTER_PAD + nodesH + CLUSTER_PAD
    const clusterY = MARGIN

    const fileMeta = files.find((f) => f.id === fileId)
    const label = fileMeta?.name || fileId.replace(/^file:/, '')

    layoutClusters.push({
      id: fileId,
      label,
      x: cursorX,
      y: clusterY,
      w: clusterW,
      h: clusterH,
      headerH: CLUSTER_HEADER_H,
    })

    let nodeY = clusterY + CLUSTER_HEADER_H + CLUSTER_PAD
    for (const node of fileNodes) {
      layoutNodes.push({
        ...node,
        x: cursorX + CLUSTER_PAD,
        y: nodeY,
        w: NODE_W,
        h: NODE_H,
        cx: cursorX + CLUSTER_PAD + NODE_W / 2,
        cy: nodeY + NODE_H / 2,
      })
      nodeY += NODE_H + NODE_GAP
    }

    maxBottom = Math.max(maxBottom, clusterY + clusterH)
    cursorX += clusterW + CLUSTER_GAP
  }

  const placed = new Map(layoutNodes.map((n) => [n.id, n]))
  const layoutEdges = []
  for (const edge of edges) {
    const from = placed.get(edge.from)
    const to = placed.get(edge.to)
    if (!from || !to) continue
    layoutEdges.push({
      ...edge,
      points: routeCurvedEdge(from, to),
    })
  }

  const width = Math.max(400, cursorX + MARGIN)
  const height = Math.max(300, maxBottom + MARGIN)

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    clusters: layoutClusters,
    width,
    height,
  }
}

/**
 * Converts a canonical ProgramModel into graph nodes, edges and clusters.
 *
 * @param {import('../../../types/program.d.ts').ProgramModel} model
 * @param {{ showDataEdges?: boolean }} [options]
 */
export function buildGraphFromProgramModel(model, options = {}) {
  const showData = options.showDataEdges !== false

  /** @type {Array<{ id: string, label: string, kind: string, fileId?: string, detail?: string }>} */
  const nodes = []
  /** @type {Array<{ id: string, from: string, to: string, kind: string, label?: string }>} */
  const edges = []

  // Function nodes
  for (const fn of model.functions || []) {
    nodes.push({
      id: fn.id,
      label: fn.name,
      kind: 'function',
      fileId: fn.fileId,
      detail: `Line ${fn.line}${fn.isStatic ? ' (static)' : ''}`,
    })
  }

  // Variable nodes (if data edges enabled)
  if (showData) {
    for (const v of model.variables || []) {
      nodes.push({
        id: v.id,
        label: v.name,
        kind: 'variable',
        fileId: v.fileId || 'global',
        detail: v.type || (v.isStatic ? 'static' : 'global'),
      })
    }
  }

  // Call edges
  for (const call of model.callEdges || []) {
    if (call.callerId && call.calleeId) {
      edges.push({
        id: call.id,
        from: call.callerId,
        to: call.calleeId,
        kind: 'call',
        label: 'calls',
      })
    }
  }

  // Data edges (reads and writes)
  if (showData) {
    for (const edge of model.writeEdges || []) {
      if (edge.accessorId && edge.variableId) {
        edges.push({
          id: edge.id,
          from: edge.accessorId,
          to: edge.variableId,
          kind: 'write',
          label: 'writes',
        })
      }
    }
    for (const edge of model.readEdges || []) {
      if (edge.accessorId && edge.variableId) {
        edges.push({
          id: edge.id,
          from: edge.variableId,
          to: edge.accessorId,
          kind: 'read',
          label: 'reads',
        })
      }
    }
  }

  return {
    nodes,
    edges,
    files: model.files || [],
  }
}

/**
 * Factory for RuntimeProgramGraph React component.
 *
 * @param {any} React
 */
export function createRuntimeProgramGraph(React) {
  const el = React.createElement
  const useGraphCamera = createUseGraphCamera(React)

  return function RuntimeProgramGraph({
    programModel,
    runtimeOverlay = {},
    selectedId = '',
    onSelect = () => {},
    showDataEdges = true,
  }) {
    const hostRef = React.useRef(null)

    // 1. Graph topology is memoized STRICTLY on programModel changes (Section 14.3)
    const graphData = React.useMemo(
      () => buildGraphFromProgramModel(programModel, { showDataEdges }),
      [programModel, showDataEdges],
    )

    // 2. Layout is memoized ONLY on graph structure changes, NEVER on runtime step
    const layout = React.useMemo(() => layoutRuntimeProgramGraph(graphData), [graphData])

    // 3. Camera pan and zoom
    const camera = useGraphCamera({
      layout,
      selectedId,
      hostRef,
    })

    // 4. Neighborhood focus
    const neighborhood = React.useMemo(() => computeNeighborhood(selectedId, layout.edges), [selectedId, layout.edges])

    // 5. Runtime overlay sets for high-performance class toggling
    const activeNodeSet = React.useMemo(
      () => new Set(runtimeOverlay.activeNodeIds || []),
      [runtimeOverlay.activeNodeIds],
    )
    const activeEdgeSet = React.useMemo(
      () => new Set(runtimeOverlay.activeEdgeIds || []),
      [runtimeOverlay.activeEdgeIds],
    )
    const breakpointSet = React.useMemo(
      () => new Set(runtimeOverlay.breakpointNodeIds || []),
      [runtimeOverlay.breakpointNodeIds],
    )
    const activeFunctionId = runtimeOverlay.activeFunctionId || ''
    const watchpointHitId = runtimeOverlay.watchpointHitNodeId || ''
    const exceptionNodeId = runtimeOverlay.exceptionNodeId || ''
    const valuesByNode = runtimeOverlay.valuesByNodeId || {}

    return el(
      'div',
      {
        ref: hostRef,
        className: 'dvb-runtime-graph-host',
        style: {
          position: 'relative',
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          backgroundColor: 'var(--dvb-bg-canvas, #0d1117)',
          userSelect: 'none',
        },
        onWheel: camera.onWheel,
        onPointerDown: camera.onPointerDown,
        onPointerMove: camera.onPointerMove,
        onPointerUp: camera.onPointerUp,
      },
      // Graph SVG Canvas
      el(
        'svg',
        {
          className: 'dvb-runtime-graph-svg',
          width: '100%',
          height: '100%',
          style: { display: 'block', cursor: 'grab' },
        },
        renderCommonSvgMarkers(React),
        el(
          'g',
          {
            transform: `translate(${camera.pan.x}, ${camera.pan.y}) scale(${camera.scale})`,
          },
          // Clusters (Files)
          layout.clusters.map((c) =>
            el(
              'g',
              { key: `cluster-${c.id}`, className: 'dvb-graph-cluster' },
              el('rect', {
                x: c.x,
                y: c.y,
                width: c.w,
                height: c.h,
                rx: 8,
                ry: 8,
                fill: 'rgba(22, 27, 34, 0.65)',
                stroke: 'var(--dvb-border-subtle, #30363d)',
                strokeWidth: 1,
              }),
              el('rect', {
                x: c.x,
                y: c.y,
                width: c.w,
                height: c.headerH,
                rx: 8,
                ry: 8,
                fill: 'rgba(33, 38, 45, 0.85)',
              }),
              el(
                'text',
                {
                  x: c.x + 10,
                  y: c.y + 17,
                  fill: 'var(--dvb-text-secondary, #8b949e)',
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: 'monospace',
                },
                c.label,
              ),
            ),
          ),
          // Edges
          layout.edges.map((edge) => {
            const isSelected = selectedId && (edge.from === selectedId || edge.to === selectedId)
            const isActive = activeEdgeSet.has(edge.id)
            const isDimmed = selectedId && !isSelected

            let strokeColor = 'var(--dvb-border-subtle, #3b4252)'
            let markerUrl = 'url(#dvb-arrow-default)'
            let strokeWidth = 1.5
            let strokeDash = undefined

            if (isActive) {
              strokeColor = 'var(--dvb-accent-cyan, #58a6ff)'
              markerUrl = 'url(#dvb-arrow-active)'
              strokeWidth = 2.5
            } else if (edge.kind === 'write') {
              strokeColor = 'var(--dvb-accent-red, #f85149)'
              markerUrl = 'url(#dvb-arrow-data-write)'
            } else if (edge.kind === 'read') {
              strokeColor = 'var(--dvb-accent-green, #3fb950)'
              markerUrl = 'url(#dvb-arrow-data-read)'
              strokeDash = '4,3'
            } else if (isSelected) {
              strokeColor = 'var(--dvb-accent-gold, #e3b341)'
              markerUrl = 'url(#dvb-arrow-highlight)'
              strokeWidth = 2
            } else if (isDimmed) {
              strokeColor = 'rgba(255, 255, 255, 0.08)'
              markerUrl = 'url(#dvb-arrow-dim)'
            }

            return el('path', {
              key: `edge-${edge.id}`,
              d: polylinePath(edge.points),
              fill: 'none',
              stroke: strokeColor,
              strokeWidth,
              strokeDasharray: strokeDash,
              markerEnd: markerUrl,
            })
          }),
          // Nodes
          layout.nodes.map((node) => {
            const isSelected = node.id === selectedId
            const isPC = node.id === activeFunctionId
            const inStack = activeNodeSet.has(node.id)
            const hasBreakpoint = breakpointSet.has(node.id)
            const isWatchpointHit = node.id === watchpointHitId
            const isException = node.id === exceptionNodeId
            const liveValue = valuesByNode[node.id]

            let borderColor = 'var(--dvb-border-subtle, #30363d)'
            let bgColor = node.kind === 'variable' ? '#161b22' : '#21262d'
            let strokeWidth = 1.5

            if (isException) {
              borderColor = 'var(--dvb-accent-red, #f85149)'
              bgColor = 'rgba(248, 81, 73, 0.25)'
              strokeWidth = 2.5
            } else if (isPC) {
              borderColor = 'var(--dvb-accent-cyan, #58a6ff)'
              bgColor = 'rgba(56, 139, 253, 0.25)'
              strokeWidth = 2.5
            } else if (isWatchpointHit) {
              borderColor = 'var(--dvb-accent-purple, #bc8cff)'
              bgColor = 'rgba(188, 140, 255, 0.25)'
              strokeWidth = 2.5
            } else if (inStack) {
              borderColor = 'var(--dvb-accent-cyan, #58a6ff)'
              strokeWidth = 2
            } else if (isSelected) {
              borderColor = 'var(--dvb-accent-gold, #e3b341)'
              strokeWidth = 2
            }

            return el(
              'g',
              {
                key: `node-${node.id}`,
                className: `dvb-graph-node ${isPC ? 'is-pc' : ''} ${inStack ? 'is-stack' : ''}`,
                style: { cursor: 'pointer' },
                onClick: (ev) => {
                  ev.stopPropagation()
                  onSelect(node.id)
                },
              },
              // Node Body Card
              el('rect', {
                x: node.x,
                y: node.y,
                width: node.w,
                height: node.h,
                rx: 6,
                ry: 6,
                fill: bgColor,
                stroke: borderColor,
                strokeWidth,
              }),
              // Node Label
              el(
                'text',
                {
                  x: node.x + 10,
                  y: node.y + 20,
                  fill: isPC ? '#ffffff' : 'var(--dvb-text-primary, #c9d1d9)',
                  fontSize: 12,
                  fontWeight: isPC || inStack ? 700 : 500,
                  fontFamily: 'monospace',
                },
                node.label,
              ),
              // Subtitle / Detail
              el(
                'text',
                {
                  x: node.x + 10,
                  y: node.y + 36,
                  fill: 'var(--dvb-text-muted, #8b949e)',
                  fontSize: 10,
                },
                liveValue != null ? `${node.label} = ${liveValue}` : node.detail || '',
              ),
              // Status Badges
              isPC &&
                el(
                  'g',
                  { transform: `translate(${node.x + node.w - 32}, ${node.y + 6})` },
                  el('rect', { width: 24, height: 14, rx: 3, fill: '#1f6feb' }),
                  el('text', { x: 12, y: 10, fill: '#fff', fontSize: 9, fontWeight: 700, textAnchor: 'middle' }, 'PC'),
                ),
              hasBreakpoint &&
                el('circle', {
                  cx: node.x + 8,
                  cy: node.y + 8,
                  r: 4,
                  fill: '#f85149',
                }),
              isWatchpointHit &&
                el(
                  'g',
                  { transform: `translate(${node.x + node.w - 32}, ${node.y + 6})` },
                  el('rect', { width: 24, height: 14, rx: 3, fill: '#8957e5' }),
                  el('text', { x: 12, y: 10, fill: '#fff', fontSize: 8, fontWeight: 700, textAnchor: 'middle' }, 'WP'),
                ),
            )
          }),
        ),
      ),
      // Controls Overlay (Fit Button, Zoom)
      el(
        'div',
        {
          className: 'dvb-graph-controls',
          style: {
            position: 'absolute',
            bottom: 12,
            right: 12,
            display: 'flex',
            gap: 6,
          },
        },
        el(
          'button',
          {
            type: 'button',
            className: 'dvb-btn-icon',
            title: '适应视口',
            onClick: camera.fit,
            style: {
              background: 'rgba(33, 38, 45, 0.8)',
              border: '1px solid var(--dvb-border-subtle, #30363d)',
              color: '#c9d1d9',
              padding: '4px 8px',
              borderRadius: 4,
              fontSize: 11,
              cursor: 'pointer',
            },
          },
          '适应视口',
        ),
      ),
    )
  }
}
