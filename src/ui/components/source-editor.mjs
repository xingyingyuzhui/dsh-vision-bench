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

function jumpFieldOf(CM) {
  let rec = jumpByRuntime.get(CM)
  if (!rec) {
    rec = jumpDecoration(CM)
    jumpByRuntime.set(CM, rec)
  }
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

    useLayout(() => {
      const CM = getCodeMirror()
      const host = hostRef.current
      if (!CM || !host) return undefined
      const jump = jumpFieldOf(CM)
      const exts = [
        CM.lineNumbers(),
        CM.highlightActiveLine(),
        CM.highlightActiveLineGutter(),
        CM.foldGutter ? CM.foldGutter() : [],
        CM.syntaxHighlighting ? CM.syntaxHighlighting(CM.defaultHighlightStyle, { fallback: true }) : [],
        CM.history ? CM.history() : [],
        CM.highlightSelectionMatches ? CM.highlightSelectionMatches() : [],
        CM.keymap.of([...(CM.defaultKeymap || []), ...(CM.historyKeymap || []), ...(CM.searchKeymap || [])]),
        langExt(CM, props.language),
        jump.field,
        CM.EditorView.editable.of(false),
        CM.EditorState.readOnly.of(true),
        CM.EditorView.theme({
          '&': { height: '100%', fontSize: '12px' },
          '.cm-scroller': {
            overflow: 'auto',
            maxHeight: '320px',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          },
        }),
      ]
      const view = new CM.EditorView({
        state: CM.EditorState.create({ doc: text, extensions: exts.flat() }),
        parent: host,
      })
      viewRef.current = view
      if (jumpLine > 0) {
        const line = Math.min(view.state.doc.lines, jumpLine)
        const info = view.state.doc.line(line)
        view.dispatch({
          selection: { anchor: info.from },
          effects: [jump.setJump.of(line), CM.EditorView.scrollIntoView(info.from, { y: 'center' })],
        })
      }
      return () => {
        try {
          view.destroy()
        } catch {}
        viewRef.current = null
      }
    }, [text, rel, props.language])

    useLayout(() => {
      const CM = getCodeMirror()
      const view = viewRef.current
      if (!CM || !view || jumpLine < 1) return
      const jump = jumpFieldOf(CM)
      const line = Math.min(view.state.doc.lines, jumpLine)
      const info = view.state.doc.line(line)
      view.dispatch({
        selection: { anchor: info.from },
        effects: [jump.setJump.of(line), CM.EditorView.scrollIntoView(info.from, { y: 'center' })],
      })
    }, [jumpLine])

    if (!getCodeMirror()) {
      return el(
        'pre',
        {
          className: 'dvb-log dvb-map-preview',
          style: { maxHeight: '320px', overflow: 'auto', whiteSpace: 'pre' },
        },
        text,
      )
    }
    return el('div', { className: 'dvb-source-editor', ref: hostRef, 'data-rel': rel })
  }
}
