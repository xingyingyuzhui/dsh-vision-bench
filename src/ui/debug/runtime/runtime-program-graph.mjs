// @ts-check

import { translate } from '../../i18n/translate.mjs'
import { createUseGraphCamera } from '../graph/graph-camera.mjs'
import { computeNeighborhood } from '../graph/graph-focus.mjs'
import { polylinePath, renderCommonSvgMarkers } from '../graph/graph-svg-primitives.mjs'
import { buildGraphFromProgramModel, layoutRuntimeProgramGraph } from './runtime-program-graph-model.mjs'

export { buildGraphFromProgramModel, layoutRuntimeProgramGraph }

const GRAPH = {
  canvas: 'var(--dvb-bg-muted)',
  surface: 'var(--dvb-bg-surface)',
  muted: 'var(--dvb-bg-muted)',
  border: 'var(--dvb-color-border)',
  fg: 'var(--dvb-color-fg)',
  fgMuted: 'var(--dvb-color-fg-muted)',
  fgSubtle: 'var(--dvb-color-fg-subtle)',
  info: 'var(--dvb-color-info)',
  danger: 'var(--dvb-color-danger)',
  success: 'var(--dvb-color-success)',
  warning: 'var(--dvb-color-warning)',
  brand: 'var(--dvb-color-brand)',
  onAccent: 'var(--dsw-alias-bg-base,#fff)',
}

function tint(token, percent) {
  return `color-mix(in srgb, ${token} ${percent}%, transparent)`
}

/**
 * Factory for RuntimeProgramGraph React component.
 *
 * @param {any} React
 */
export function createRuntimeProgramGraph(React, t = (key, params) => translate('zh', key, params)) {
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
          backgroundColor: GRAPH.canvas,
          userSelect: 'none',
        },
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
                fill: GRAPH.muted,
                stroke: GRAPH.border,
                strokeWidth: 1,
              }),
              el('rect', {
                x: c.x,
                y: c.y,
                width: c.w,
                height: c.headerH,
                rx: 8,
                ry: 8,
                fill: GRAPH.surface,
              }),
              el(
                'text',
                {
                  x: c.x + 10,
                  y: c.y + 17,
                  fill: GRAPH.fgMuted,
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

            let strokeColor = GRAPH.border
            let markerUrl = 'url(#dvb-arrow-default)'
            let strokeWidth = 1.5
            let strokeDash = undefined

            if (isActive) {
              strokeColor = GRAPH.info
              markerUrl = 'url(#dvb-arrow-active)'
              strokeWidth = 2.5
            } else if (edge.kind === 'write') {
              strokeColor = GRAPH.danger
              markerUrl = 'url(#dvb-arrow-data-write)'
            } else if (edge.kind === 'read') {
              strokeColor = GRAPH.success
              markerUrl = 'url(#dvb-arrow-data-read)'
              strokeDash = '4,3'
            } else if (isSelected) {
              strokeColor = GRAPH.warning
              markerUrl = 'url(#dvb-arrow-highlight)'
              strokeWidth = 2
            } else if (isDimmed) {
              strokeColor = GRAPH.fgSubtle
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

            let borderColor = GRAPH.border
            let bgColor = node.kind === 'variable' ? GRAPH.muted : GRAPH.surface
            let strokeWidth = 1.5

            if (isException) {
              borderColor = GRAPH.danger
              bgColor = tint(GRAPH.danger, 25)
              strokeWidth = 2.5
            } else if (isPC) {
              borderColor = GRAPH.info
              bgColor = tint(GRAPH.info, 25)
              strokeWidth = 2.5
            } else if (isWatchpointHit) {
              borderColor = GRAPH.brand
              bgColor = tint(GRAPH.brand, 25)
              strokeWidth = 2.5
            } else if (inStack) {
              borderColor = GRAPH.info
              strokeWidth = 2
            } else if (isSelected) {
              borderColor = GRAPH.warning
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
                  fill: GRAPH.fg,
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
                  fill: GRAPH.fgMuted,
                  fontSize: 10,
                },
                liveValue != null ? `${node.label} = ${liveValue}` : node.detail || '',
              ),
              // Status Badges
              isPC &&
                el(
                  'g',
                  { transform: `translate(${node.x + node.w - 32}, ${node.y + 6})` },
                  el('rect', { width: 24, height: 14, rx: 3, fill: GRAPH.info }),
                  el('text', { x: 12, y: 10, fill: GRAPH.onAccent, fontSize: 9, fontWeight: 700, textAnchor: 'middle' }, 'PC'),
                ),
              hasBreakpoint &&
                el('circle', {
                  cx: node.x + 8,
                  cy: node.y + 8,
                  r: 4,
                  fill: GRAPH.danger,
                }),
              isWatchpointHit &&
                el(
                  'g',
                  { transform: `translate(${node.x + node.w - 32}, ${node.y + 6})` },
                  el('rect', { width: 24, height: 14, rx: 3, fill: GRAPH.brand }),
                  el('text', { x: 12, y: 10, fill: GRAPH.onAccent, fontSize: 8, fontWeight: 700, textAnchor: 'middle' }, 'WP'),
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
            title: t('graphFit'),
            onClick: camera.fit,
            style: {
              background: GRAPH.surface,
              border: `1px solid ${GRAPH.border}`,
              color: GRAPH.fg,
              padding: '4px 8px',
              borderRadius: 4,
              fontSize: 11,
              cursor: 'pointer',
            },
          },
          t('graphFit'),
        ),
      ),
    )
  }
}
