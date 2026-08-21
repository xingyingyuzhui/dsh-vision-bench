import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Execute the GENERATED bundle exactly like the DSH web loader would
// (factory(require) -> apply(ctx)) and mount every registered page with a
// stub React. Catches runtime crashes — e.g. the v0.17.0 blank-page bug where
// an aliased import was stripped away and a view died on first render.
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function loadBundle() {
  const src = readFileSync(join(root, 'client.js'), 'utf8')
  let loaded = null
  const sandboxWindow = {
    __ModuleLoader__: {
      load(mod) { loaded = mod },
    },
  }
  new Function('window', src)(sandboxWindow)
  assert.ok(loaded, 'bundle never called __ModuleLoader__.load')
  let ReactStub = null
  const makeReact = () => {
    const el = (type, props, ...children) => ({ type, props: props || {}, children })
    const R = { createElement: el }
    R.useState = (init) => [typeof init === 'function' ? init() : init, () => {}]
    R.useRef = (init) => ({ current: init })
    R.useEffect = () => {}
    return R
  }
  const requireStub = (name) => {
    if (name === 'react') {
      if (!ReactStub) ReactStub = makeReact()
      return ReactStub
    }
    throw new Error('unexpected require: ' + name)
  }
  return loaded.factory(requireStub)
}

function makeCtx(pages) {
  const slots = {
    inject(_name, fn) {
      const stop = fn()
      return typeof stop === 'function' ? stop : () => {}
    },
    register(def, comp) {
      pages[def.id] = comp
      return () => {}
    },
  }
  const sidebar = {
    registerTab(def) {
      pages['tab:' + def.id] = def.component
      return () => {}
    },
    openTab() {},
    closeTab() {},
    effect(fn) { return typeof fn === 'function' ? fn() : null },
  }
  return {
    pages,
    get(key) { return key === 'slots' ? slots : null },
    locale: { register: () => () => {} },
    inject(_deps, fn) {
      fn({ betterSidebar: sidebar, effect(fn2) { return fn2 && fn2() } })
      return () => {}
    },
    effect(fn) { const d = typeof fn === 'function' ? fn() : null; void d },
  }
}

test('every registered bench page mounts without runtime errors', () => {
  const mod = loadBundle()
  const pages = {}
  mod.apply(makeCtx(pages))
  const mounted = Object.entries(pages).filter(([, comp]) => typeof comp === 'function')
  assert.ok(mounted.length >= 7, 'expected at least 7 mounted pages, got ' + mounted.length)
  for (const [id, comp] of mounted) {
    let tree = null
    assert.doesNotThrow(() => {
      tree = comp({
        sessionId: 's1',
        useSessions: (fn) => fn({ byId: { s1: { cwd: '/tmp/proj' } }, current: 's1' }),
        tab: { id },
        scope: {},
      })
    }, id + ' threw during render')
    assert.ok(tree, id + ' rendered no tree')
  }
})
