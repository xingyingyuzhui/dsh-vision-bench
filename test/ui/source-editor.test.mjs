// P2-1: SourceEditor lifecycle tests (ADR-025 D2/D9).
//
// The component is a CodeMirror adapter: build once, dispatch effects on prop
// changes, destroy exactly once. These tests drive a fake runtime through the
// real vendor seam (`setCodeMirrorRuntime`) instead of reading production
// source strings, so the lifecycle is asserted by behaviour.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { render } from '@testing-library/react'
import React from 'react'
import { createSourceEditor } from '../../src/ui/components/source-editor.mjs'
import { setCodeMirrorRuntime } from '../../src/ui/vendor/codemirror-runtime.mjs'
import { useReactPageRuntime } from '../helpers/react-runtime.mjs'

useReactPageRuntime()

const SourceEditor = createSourceEditor(React)

/** Minimal CodeMirror surface `source-editor.mjs` touches, plus call counters. */
function makeFakeCodeMirror() {
  const stats = {
    constructed: 0,
    destroyed: 0,
    dispatches: 0,
    built: [],
    effectValues: [],
    live: new Set(),
  }

  const StateEffect = { define: () => ({ of: (value) => ({ __effect: true, value }) }) }
  const StateField = { define: (spec) => ({ type: { create: spec.create, update: spec.update }, spec }) }
  const Decoration = {
    none: { __none: true },
    set: (ranges, sort) => ({ __decorations: ranges, sort: Boolean(sort) }),
    line: (opts) => ({ range: (from) => ({ from, opts }) }),
  }

  class EditorState {
    constructor(config) {
      this.doc = {
        lines: String(config.doc || '').split('\n').length,
        line: (n) => ({ from: (n - 1) * 10, number: n }),
      }
    }
    static create(config) {
      return new EditorState(config)
    }
    static readOnly = { of: () => ({ __readonly: true }) }
  }

  class EditorView {
    constructor(config) {
      stats.constructed += 1
      this.state = config.state
      this.parent = config.parent
      stats.live.add(this)
      stats.built.push({ doc: config.state.doc.lines })
    }
    dispatch(transaction) {
      stats.dispatches += 1
      const effects = transaction?.effects
      if (Array.isArray(effects)) for (const effect of effects) stats.effectValues.push(effect?.value)
      else if (effects) stats.effectValues.push(effects?.value)
    }
    destroy() {
      stats.destroyed += 1
      stats.live.delete(this)
    }
    static editable = { of: (flag) => ({ __editable: flag }) }
    static decorations = { from: (field) => ({ __from: field }) }
    static theme = (spec) => ({ __theme: spec })
    static scrollIntoView = (pos, opts) => ({ __scroll: true, pos, opts })
  }

  return {
    stats,
    CM: {
      EditorView,
      EditorState,
      StateEffect,
      StateField,
      Decoration,
      lineNumbers: () => ({ __lineNumbers: true }),
      highlightActiveLine: () => ({ __active: true }),
      highlightActiveLineGutter: () => ({ __activeGutter: true }),
      foldGutter: () => ({ __fold: true }),
      syntaxHighlighting: () => ({ __syntax: true }),
      defaultHighlightStyle: {},
      history: () => ({ __history: true }),
      highlightSelectionMatches: () => ({ __selection: true }),
      keymap: { of: (bindings) => ({ __keymap: bindings }) },
      defaultKeymap: [],
      historyKeymap: [],
      searchKeymap: [],
      json: () => ({ __json: true }),
      cpp: () => ({ __cpp: true }),
    },
  }
}

test('without a CodeMirror runtime it renders the fallback pre and keeps the data contract', () => {
  setCodeMirrorRuntime(null)
  try {
    const { container } = render(React.createElement(SourceEditor, { text: 'line1\nline2', rel: 'src/main.c', jumpLine: 2 }))
    const pre = container.querySelector('pre')
    assert.ok(pre, 'fallback pre is rendered')
    assert.ok(pre.className.includes('dvb-log'))
    assert.equal(pre.textContent, 'line1\nline2')
    assert.equal(pre.getAttribute('data-jump-line'), '2')
  } finally {
    setCodeMirrorRuntime(null)
  }
})

test('fallback and host expose an accessible region name when given one', () => {
  setCodeMirrorRuntime(null)
  try {
    const { container } = render(React.createElement(SourceEditor, { text: 'a', rel: 'a.c', ariaLabel: '源码预览' }))
    const pre = container.querySelector('pre')
    assert.equal(pre.getAttribute('role'), 'region')
    assert.equal(pre.getAttribute('aria-label'), '源码预览')
  } finally {
    setCodeMirrorRuntime(null)
  }

  const { CM } = makeFakeCodeMirror()
  setCodeMirrorRuntime(CM)
  try {
    const { container } = render(React.createElement(SourceEditor, { text: 'a', rel: 'a.c', ariaLabel: '源码预览' }))
    const host = container.querySelector('.dvb-source-editor')
    assert.equal(host.getAttribute('role'), 'region')
    assert.equal(host.getAttribute('aria-label'), '源码预览')
  } finally {
    setCodeMirrorRuntime(null)
  }
})

test('creates exactly one EditorView, on the host node, with the shared data contract', () => {
  const { CM, stats } = makeFakeCodeMirror()
  setCodeMirrorRuntime(CM)
  try {
    const { container } = render(
      React.createElement(SourceEditor, { text: 'a\nb\nc', rel: 'src/main.c', language: 'cpp', jumpLine: 0 }),
    )
    assert.equal(stats.constructed, 1)
    const host = container.querySelector('.dvb-source-editor')
    assert.ok(host, 'host div carries the editor class')
    assert.equal(host.getAttribute('data-rel'), 'src/main.c')
    assert.equal(stats.built[0].doc, 3)
  } finally {
    setCodeMirrorRuntime(null)
  }
})

test('destroys the view exactly once on unmount', () => {
  const { CM, stats } = makeFakeCodeMirror()
  setCodeMirrorRuntime(CM)
  try {
    const { unmount } = render(React.createElement(SourceEditor, { text: 'x', rel: 'a.c' }))
    assert.equal(stats.constructed, 1)
    assert.equal(stats.destroyed, 0)
    unmount()
    assert.equal(stats.destroyed, 1)
    assert.equal(stats.live.size, 0)
  } finally {
    setCodeMirrorRuntime(null)
  }
})

test('text, rel and language changes rebuild the view', () => {
  const { CM, stats } = makeFakeCodeMirror()
  setCodeMirrorRuntime(CM)
  try {
    const { rerender } = render(React.createElement(SourceEditor, { text: 'a', rel: 'a.c', language: 'cpp' }))
    assert.equal(stats.constructed, 1)

    rerender(React.createElement(SourceEditor, { text: 'a\nb', rel: 'a.c', language: 'cpp' }))
    assert.equal(stats.constructed, 2, 'text change rebuilds')

    rerender(React.createElement(SourceEditor, { text: 'a\nb', rel: 'b.c', language: 'cpp' }))
    assert.equal(stats.constructed, 3, 'rel change rebuilds')

    rerender(React.createElement(SourceEditor, { text: 'a\nb', rel: 'b.c', language: 'json' }))
    assert.equal(stats.constructed, 4, 'language change rebuilds')
  } finally {
    setCodeMirrorRuntime(null)
  }
})

test('jumpLine, execLine and breakpoints only dispatch, they never rebuild', () => {
  const { CM, stats } = makeFakeCodeMirror()
  setCodeMirrorRuntime(CM)
  try {
    // debugGutters is held constant: it is a build input (see the next test),
    // so only the effect-only props vary here.
    const base = { text: 'a\nb\nc', rel: 'a.c', debugGutters: true }
    const { rerender } = render(React.createElement(SourceEditor, { ...base, jumpLine: 1, execLine: 0 }))
    assert.equal(stats.constructed, 1)

    rerender(React.createElement(SourceEditor, { ...base, jumpLine: 3, execLine: 0 }))
    rerender(React.createElement(SourceEditor, { ...base, jumpLine: 3, execLine: 2 }))
    rerender(React.createElement(SourceEditor, { ...base, jumpLine: 3, execLine: 2, breakpoints: [1, 3] }))

    assert.equal(stats.constructed, 1, 'effect-only prop changes must not recreate the view')
    assert.ok(stats.dispatches >= 3, 'each change dispatches an effect')
  } finally {
    setCodeMirrorRuntime(null)
  }
})

test('debugGutters toggle changes the build inputs and rebuilds', () => {
  const { CM, stats } = makeFakeCodeMirror()
  setCodeMirrorRuntime(CM)
  try {
    const { rerender } = render(React.createElement(SourceEditor, { text: 'a', rel: 'a.c', debugGutters: false }))
    assert.equal(stats.constructed, 1)
    rerender(React.createElement(SourceEditor, { text: 'a', rel: 'a.c', debugGutters: true }))
    assert.equal(stats.constructed, 2, 'debugGutters is part of the build effect deps')
  } finally {
    setCodeMirrorRuntime(null)
  }
})
