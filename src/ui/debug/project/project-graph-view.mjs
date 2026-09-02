import { graphNeighborhood } from './project-graph-model.mjs'
import { fitViewTransform, focusNodeTransform, layoutProjectGraph, polylinePath } from './project-graph-layout.mjs'

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n))
}

export function createProjectGraphView(React) {
  return function ProjectGraphView({
    graph,
    selectedId,
    onSelect,
    capped,
    edgesCapped,
    orphanEdges,
    truncatedIncludeEdges,
  }) {
    const el = React.createElement
    const hostRef = React.useRef(null)
    const layout = React.useMemo(() => layoutProjectGraph(graph), [graph])
    const [pan, setPan] = React.useState({ x: 0, y: 0 })
    const [scale, setScale] = React.useState(1)
    const dragRef = React.useRef(null)
    const [hoverEdge, setHoverEdge] = React.useState('')

    const reducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const fit = React.useCallback(() => {
      const host = hostRef.current
      if (!host) return
      const rect = host.getBoundingClientRect()
      const next = fitViewTransform(layout, rect.width, rect.height)
      setPan({ x: next.panX, y: next.panY })
      setScale(next.scale)
    }, [layout])

    React.useEffect(() => {
      const host = hostRef.current
      if (!host) return
      const rect = host.getBoundingClientRect()
      if (selectedId) {
        const next = focusNodeTransform(layout, selectedId, rect.width, rect.height)
        setPan({ x: next.panX, y: next.panY })
        setScale(next.scale)
        return
      }
      fit()
    }, [fit, layout, selectedId])

    React.useEffect(() => {
      const host = hostRef.current
      if (!host || typeof ResizeObserver === 'undefined') return undefined
      const ro = new ResizeObserver(() => {
        if (selectedId) {
          const rect = host.getBoundingClientRect()
          const next = focusNodeTransform(layout, selectedId, rect.width, rect.height)
          setPan({ x: next.panX, y: next.panY })
          setScale(next.scale)
        } else {
          fit()
        }
      })
      ro.observe(host)
      return () => ro.disconnect()
    }, [fit, layout, selectedId])

    const hood = React.useMemo(() => graphNeighborhood(selectedId, graph), [selectedId, graph])

    const onWheel = (ev) => {
      ev.preventDefault()
      const delta = ev.deltaY > 0 ? 0.92 : 1.08
      setScale((s) => clamp(s * delta, 0.35, 2.5))
    }

    const onPointerDown = (ev) => {
      if (ev.button !== 0) return
      dragRef.current = { x: ev.clientX, y: ev.clientY, panX: pan.x, panY: pan.y }
      ev.currentTarget.setPointerCapture(ev.pointerId)
    }

    const onPointerMove = (ev) => {
      const drag = dragRef.current
      if (!drag) return
      setPan({
        x: drag.panX + (ev.clientX - drag.x),
        y: drag.panY + (ev.clientY - drag.y),
      })
    }

    const onPointerUp = (ev) => {
      dragRef.current = null
      try {
        ev.currentTarget.releasePointerCapture(ev.pointerId)
      } catch {
        /* ignore */
      }
    }

    if (!graph?.nodes?.length) {
      return el(
        'div',
        { className: 'dvb-graph-empty' },
        el('div', { className: 'dvb-hint' }, '没有可绘制的文件节点。请调整筛选或切换到树形视图。'),
      )
    }

    const transform = `translate(${pan.x},${pan.y}) scale(${scale})`

    return el(
      'div',
      { className: 'dvb-graph-wrap' },
      el(
        'div',
        { className: 'dvb-graph-toolbar' },
        el(
          'button',
          { type: 'button', className: 'dvb-btn dvb-btn-sm', onClick: fit },
          '适应画布',
        ),
        el(
          'button',
          {
            type: 'button',
            className: 'dvb-btn dvb-btn-sm',
            onClick() {
              setScale(1)
              setPan({ x: 24, y: 24 })
            },
          },
          '100%',
        ),
        el('span', { className: 'dvb-graph-legend' }, '● 正常 ○ 缺失 △ 外'),
        capped || edgesCapped
          ? el('span', { className: 'dvb-hint dvb-need' }, '图谱已截断，仅展示部分节点/依赖')
          : null,
        truncatedIncludeEdges
          ? el('span', { className: 'dvb-hint dvb-need' }, '仅展示前 120 条依赖')
          : null,
        orphanEdges > 0 ? el('span', { className: 'dvb-hint' }, `${orphanEdges} 条边未解析`) : null,
      ),
      el(
        'div',
        {
          ref: hostRef,
          className: 'dvb-graph-host',
          onWheel,
          onPointerDown,
          onPointerMove,
          onPointerUp,
          onPointerCancel: onPointerUp,
        },
        el(
          'svg',
          {
            className: 'dvb-graph-svg',
            width: layout.width,
            height: layout.height,
            viewBox: `0 0 ${layout.width} ${layout.height}`,
            style: { transform, transformOrigin: '0 0' },
          },
          el('defs', null, el('marker', {
            id: 'dvb-graph-arrow',
            markerWidth: 8,
            markerHeight: 8,
            refX: 7,
            refY: 4,
            orient: 'auto',
            markerUnits: 'strokeWidth',
          }, el('path', { d: 'M0,0 L8,4 L0,8 Z', className: 'dvb-graph-arrowhead' }))),
          layout.clusters.map((cluster) =>
            el(
              'g',
              { key: cluster.id, className: 'dvb-graph-cluster' },
              el('rect', {
                x: cluster.x,
                y: cluster.y,
                width: cluster.w,
                height: cluster.h,
                rx: 10,
                ry: 10,
                className: 'dvb-graph-cluster-box',
              }),
              el(
                'text',
                { x: cluster.x + 12, y: cluster.y + 16, className: 'dvb-graph-cluster-label' },
                cluster.label,
              ),
            ),
          ),
          layout.edges.map((edge) => {
            const active =
              hood.edgeIds.has(edge.id) || hoverEdge === edge.id || edge.from === selectedId || edge.to === selectedId
            return el('path', {
              key: edge.id,
              d: polylinePath(edge.points),
              className: `dvb-graph-edge${active ? ' is-on' : ''}${edge.resolved === false ? ' is-weak' : ''}`,
              markerEnd: 'url(#dvb-graph-arrow)',
              onMouseEnter: () => setHoverEdge(edge.id),
              onMouseLeave: () => setHoverEdge(''),
            })
          }),
          layout.nodes.map((node) => {
            const selected = node.id === selectedId
            const neighbor = hood.nodeIds.has(node.id)
            return el(
              'g',
              {
                key: node.id,
                className: `dvb-graph-node${selected ? ' is-on' : ''}${neighbor ? ' is-near' : ''}`,
                'data-kind': node.kind,
                transform: `translate(${node.x},${node.y})`,
                onClick(ev) {
                  ev.stopPropagation()
                  onSelect(node)
                },
              },
              el('rect', {
                width: node.w,
                height: node.h,
                rx: 8,
                ry: 8,
                className: 'dvb-graph-node-box',
              }),
              el(
                'text',
                { x: 10, y: 18, className: 'dvb-graph-node-label' },
                node.label.length > 18 ? `${node.label.slice(0, 16)}…` : node.label,
              ),
              el('text', { x: 10, y: 34, className: 'dvb-graph-node-sub' }, node.groupName),
            )
          }),
        ),
      ),
      !reducedMotion
        ? el('div', { className: 'dvb-hint dvb-graph-hint' }, '拖拽平移 · 滚轮缩放 · 点击节点预览')
        : null,
    )
  }
}
