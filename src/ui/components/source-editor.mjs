import { getCodeMirror } from '../vendor/codemirror-runtime.mjs'

function jumpDecoration(CM) {
  const setJump = CM.StateEffect.define()
  const field = CM.StateField.define({
    create() {
      return CM.Decoration.none
    },
    update(deco, tr) {
      for (const effect of tr.effects) {
        if (effect.is(setJump)) {
          const lineNo = Number(effect.value) || 0
          if (lineNo < 1 || lineNo > tr.state.doc.lines) return CM.Decoration.none
          const line = tr.state.doc.line(lineNo)
          return CM.Decoration.set([CM.Decoration.line({ class: 'dvb-cm-jump' }).range(line.from)])
        }
      }
      return deco.map(tr.changes)
    },
    provide: (f) => CM.EditorView.decorations.from(f),
  })
  return { setJump, field }
}

function langExt(CM, kind) {
  if (kind === 'json' && typeof CM.json === 'function') return CM.json()
  if (kind === 'cpp' && typeof CM.cpp === 'function') return CM.cpp()
  return []
}

const jumpByRuntime = new WeakMap()
const debugByRuntime = new WeakMap()

function jumpFieldOf(CM) {
  let rec = jumpByRuntime.get(CM)
  if (!rec) {
    rec = jumpDecoration(CM)
    jumpByRuntime.set(CM, rec)
  }
  return rec
}

function debugFieldOf(CM) {
  let rec = debugByRuntime.get(CM)
  if (rec) return rec
  const setDebug = CM.StateEffect.define()
  const field = CM.StateField.define({
    create() {
      return { exec: 0, bps: [] }
    },
    update(value, tr) {
      for (const effect of tr.effects) {
        if (effect.is(setDebug)) return effect.value
      }
      return value
    },
  })
  const lineField = CM.StateField.define({
    create() {
      return CM.Decoration.none
    },
    update(deco, tr) {
      for (const effect of tr.effects) {
        if (effect.is(setDebug)) {
          const lineNo = Number(effect.value?.exec) || 0
          if (lineNo < 1 || lineNo > tr.state.doc.lines) return CM.Decoration.none
          const line = tr.state.doc.line(lineNo)
          const bps = new Set((effect.value?.bps || []).map((n) => Number(n)))
          const cls = bps.has(lineNo) ? 'dvb-cm-exec dvb-cm-bp' : 'dvb-cm-exec'
          const marks = [CM.Decoration.line({ class: cls }).range(line.from)]
          for (const n of bps) {
            if (n === lineNo || n < 1 || n > tr.state.doc.lines) continue
            marks.push(CM.Decoration.line({ class: 'dvb-cm-bp' }).range(tr.state.doc.line(n).from))
          }
          return CM.Decoration.set(marks, true)
        }
      }
      return deco.map(tr.changes)
    },
    provide: (f) => CM.EditorView.decorations.from(f),
  })
  rec = { setDebug, field, extensions: [field, lineField] }
  debugByRuntime.set(CM, rec)
  return rec
}

/** Read-only CodeMirror host. Pages pass React; this module never talks to Host. */
export function createSourceEditor(React) {
  const el = React.createElement
  const useLayout = typeof React.useLayoutEffect === 'function' ? React.useLayoutEffect : React.useEffect
  return function SourceEditor(props) {
    const hostRef = React.useRef(null)
    const viewRef = React.useRef(null)
    const text = props.text || ''
    const rel = props.rel || ''
    const jumpLine = Number(props.jumpLine) || 0
    const execLine = Number(props.execLine) || 0
    const bpKey = Array.isArray(props.breakpoints) ? props.breakpoints.join(',') : ''
    const debugMode = Boolean(props.debugGutters)

    useLayout(() => {
      const CM = getCodeMirror()
      const host = hostRef.current
      if (!CM || !host) return undefined
      const jump = jumpFieldOf(CM)
      const debug = debugMode ? debugFieldOf(CM) : null
      const exts = [
        CM.lineNumbers(),
        debugMode ? [] : CM.highlightActiveLine(),
        debugMode ? [] : CM.highlightActiveLineGutter(),
        !debugMode && CM.foldGutter ? CM.foldGutter() : [],
        CM.syntaxHighlighting ? CM.syntaxHighlighting(CM.defaultHighlightStyle, { fallback: true }) : [],
        CM.history ? CM.history() : [],
        CM.highlightSelectionMatches ? CM.highlightSelectionMatches() : [],
        CM.keymap.of([...(CM.defaultKeymap || []), ...(CM.historyKeymap || []), ...(CM.searchKeymap || [])]),
        langExt(CM, props.language),
        jump.field,
        debug ? debug.extensions : [],
        CM.EditorView.editable.of(false),
        CM.EditorState.readOnly.of(true),
        CM.EditorView.theme({
          '&': { height: '100%', fontSize: '12px' },
          '.cm-scroller': {
            overflow: 'auto',
            maxHeight: '320px',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          },
          '.dvb-cm-exec': { backgroundColor: 'rgba(250, 204, 21, 0.35)' },
          '.dvb-cm-exec.dvb-cm-bp': { boxShadow: 'inset 14px 0 0 0 transparent' },
        }),
      ]
      const view = new CM.EditorView({
        state: CM.EditorState.create({ doc: text, extensions: exts.flat() }),
        parent: host,
      })
      viewRef.current = view
      const focusLine = execLine || jumpLine
      if (focusLine > 0) {
        const line = Math.min(view.state.doc.lines, focusLine)
        const info = view.state.doc.line(line)
        const effects = [jump.setJump.of(debugMode ? 0 : line), CM.EditorView.scrollIntoView(info.from, { y: 'center' })]
        if (debug) effects.push(debug.setDebug.of({ exec: execLine, bps: props.breakpoints || [] }))
        view.dispatch({ selection: { anchor: info.from }, effects })
      }
      return () => {
        try {
          view.destroy()
        } catch {}
        viewRef.current = null
      }
    }, [text, rel, props.language, debugMode])

    useLayout(() => {
      const CM = getCodeMirror()
      const view = viewRef.current
      if (!CM || !view) return
      const jump = jumpFieldOf(CM)
      const debug = debugMode ? debugFieldOf(CM) : null
      const focusLine = execLine || jumpLine
      const effects = []
      if (!debugMode && jumpLine > 0) {
        const line = Math.min(view.state.doc.lines, jumpLine)
        const info = view.state.doc.line(line)
        effects.push(jump.setJump.of(line), CM.EditorView.scrollIntoView(info.from, { y: 'center' }))
        view.dispatch({ selection: { anchor: info.from }, effects })
        return
      }
      if (debug) {
        effects.push(debug.setDebug.of({ exec: execLine, bps: props.breakpoints || [] }))
        if (focusLine > 0) {
          const line = Math.min(view.state.doc.lines, focusLine)
          const info = view.state.doc.line(line)
          effects.push(CM.EditorView.scrollIntoView(info.from, { y: 'center' }))
          view.dispatch({ selection: { anchor: info.from }, effects })
          return
        }
        view.dispatch({ effects })
      }
    }, [jumpLine, execLine, bpKey, debugMode])

    if (!getCodeMirror()) {
      return el(
        'pre',
        {
          className: 'dvb-log dvb-map-preview',
          style: { maxHeight: '320px', overflow: 'auto', whiteSpace: 'pre' },
          'data-jump-line': jumpLine > 0 ? String(jumpLine) : undefined,
        },
        text,
      )
    }
    return el('div', {
      className: 'dvb-source-editor',
      ref: hostRef,
      'data-rel': rel,
      'data-jump-line': jumpLine > 0 ? String(jumpLine) : undefined,
    })
  }
}
