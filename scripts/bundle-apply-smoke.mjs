// Execute the GENERATED bundle exactly like the DSH web loader would:
// window.__ModuleLoader__.load -> factory(require) -> exports.apply(ctx).
// Then mount every registered page with a stub React and report any throw.
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(join(root, 'client.js'), 'utf8')

let loaded = null
const sandboxWindow = {
  __ModuleLoader__: {
    load(mod) { loaded = mod },
  },
}
new Function('window', src)(sandboxWindow)
if (!loaded) throw new Error('bundle never called __ModuleLoader__.load')

let ReactStub = null
function makeReact() {
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

const mod = loaded.factory(requireStub)

const pages = {}
const slots = {
  inject(_name, fn) {
    const stop = fn()
    return typeof stop === 'function' ? stop : () => {}
  },
  register(def, comp) {
    pages[def.id] = { def, comp }
    return () => {}
  },
}
const sidebar = {
  registerTab(def) { pages['tab:' + def.id] = def; return () => {} },
  openTab() {},
  closeTab() {},
  effect(fn) { const d = typeof fn === 'function' ? fn() : null; return d },
}

const ctx = {
  get(key) {
    if (key === 'slots') return slots
    return null
  },
  locale: { register: () => () => {} },
  inject(deps, fn) {
    fn({ betterSidebar: sidebar, effect(fn2) { return fn2 && fn2() } })
    return () => {}
  },
  effect(fn) { const d = fn(); void d },
}

mod.apply(ctx)

const results = []
for (const [id, entry] of Object.entries(pages)) {
  const comp = entry.comp || entry.def && null
  if (typeof comp !== 'function') {
    results.push([id, 'registered (non-component)'])
    continue
  }
  try {
    const props = {
      sessionId: 's1',
      useSessions: (fn) => fn({ byId: { s1: { cwd: '/tmp/proj' } }, current: 's1' }),
      tab: { id },
      scope: {},
    }
    const tree = comp(props)
    results.push([id, typeof tree === 'object' ? 'rendered' : 'returned ' + typeof tree])
  } catch (error) {
    results.push([id, 'THROW: ' + (error && error.stack || error).split('\n').slice(0, 4).join(' | ')])
  }
}
for (const [id, status] of results) console.log(id.padEnd(40), status)
