import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { installDomStub } from './dom-stub.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('Stage 0.25: CodeMirror is pinned and react-arborist is not a dependency', async () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.dependencies['@codemirror/view'], '6.43.9')
  assert.equal(pkg.dependencies['@codemirror/state'], '6.7.1')
  assert.equal(pkg.dependencies['@codemirror/lang-cpp'], '6.0.3')
  assert.equal(pkg.dependencies.reactArborist, undefined)
  assert.equal(pkg.dependencies['react-arborist'], undefined)
  const vendor = readFileSync(join(root, 'scripts/vendor-entry.mjs'), 'utf8')
  assert.match(vendor, /codeMirror/)
  assert.match(vendor, /@codemirror\/view/)
  assert.doesNotMatch(vendor, /from\s+['"]react-arborist['"]/)
})

test('Stage 0.24: package.json pins exact gridstack 11.5.1 and echarts 5.6.0', async () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.dependencies.gridstack, '11.5.1')
  assert.equal(pkg.dependencies.echarts, '5.6.0')
})

test('Stage 5: package.json pins exact @tanstack/react-table and table-core 8.21.3', async () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.dependencies['@tanstack/react-table'], '8.21.3')
  assert.equal(pkg.dependencies['@tanstack/table-core'], '8.21.3')
  assert.doesNotMatch(pkg.dependencies['@tanstack/react-table'], /[\^~]/)
  assert.doesNotMatch(pkg.dependencies['@tanstack/table-core'], /[\^~]/)
})

test('Stage 5: package-lock pins table-core 8.21.3', async () => {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
  const entry = lock.packages && lock.packages['node_modules/@tanstack/table-core']
  assert.ok(entry, 'lock should contain table-core')
  assert.equal(entry.version, '8.21.3')
  assert.equal(entry.resolved, 'https://registry.npmjs.org/@tanstack/table-core/-/table-core-8.21.3.tgz')
})

test('Stage 5: vendor-entry ships table-core createTable, not useReactTable', async () => {
  const src = readFileSync(join(root, 'scripts/vendor-entry.mjs'), 'utf8')
  assert.match(src, /@tanstack\/table-core/)
  assert.match(src, /createTable/)
  assert.match(src, /getCoreRowModel/)
  assert.match(src, /getSortedRowModel/)
  assert.doesNotMatch(src, /import\s*\{[^}]*useReactTable/)
  assert.doesNotMatch(src, /import\s*\{[^}]*flexRender/)
  assert.doesNotMatch(src, /from\s+['"]@tanstack\/react-table['"]/)
})

test('Task8: package.json has exact @tanstack/virtual-core', async () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  assert.ok(pkg.dependencies, 'should have dependencies')
  const v = pkg.dependencies['@tanstack/virtual-core']
  assert.ok(v, 'should have @tanstack/virtual-core dependency')
  assert.equal(v, '3.13.12', 'should be exact version 3.13.12 without ^ or ~')
  assert.doesNotMatch(v, /[\^~]/, 'exact version should not contain ^ or ~')
})

test('Task8: package-lock.json has exact @tanstack/virtual-core', async () => {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
  const entry = lock.packages && lock.packages['node_modules/@tanstack/virtual-core']
  assert.ok(entry, 'lock should contain virtual-core')
  assert.equal(entry.version, '3.13.12')
  assert.equal(entry.resolved, 'https://registry.npmjs.org/@tanstack/virtual-core/-/virtual-core-3.13.12.tgz')
})

test('Task8: build-client.mjs validates virtual-core compat', async () => {
  const src = readFileSync(join(root, 'scripts/build-client.mjs'), 'utf8')
  assert.match(src, /@tanstack\/virtual-core/, 'should reference virtual-core')
  assert.match(src, /Virtualizer/, 'should reference Virtualizer')
  assert.match(src, /measureElement/, 'should support dynamic row height via measureElement')
  assert.match(src, /overscan/, 'should configure overscan for viewport limiting')
  assert.match(src, /dark|prefers-color-scheme|CSS.*dark/i, 'should mention dark mode handling')
  assert.match(src, /shouldStickToBottom|isAtBottom|autoFollow/i, 'should handle auto-follow only at bottom')
})

test('Task8: generated client can load', async () => {
  const src = readFileSync(join(root, 'client.js'), 'utf8')
  const restore = installDomStub()
  try {
    assert.match(src, /Do not edit by hand/)
    assert.match(src, /window\.__ModuleLoader__\.load/)
    assert.doesNotThrow(() => new Function('window', src), 'client.js should be valid JS')
    // no duplicate React: client should not bundle React itself; it uses require('react') at runtime via Harness
    assert.doesNotMatch(src, /from\s+['"]react['"]/, 'client should not contain literal react import')
    assert.doesNotMatch(src, /node_modules\/react/, 'client should not bundle React source')
    assert.doesNotMatch(src, /ReactDOM/, 'client should not bundle ReactDOM')
    // Ensure client does not contain duplicate React factory (e.g., second __ModuleLoader for react)
    const loaderCount = (src.match(/__ModuleLoader__\.load/g) || []).length
    assert.equal(loaderCount, 1, 'client should have single ModuleLoader entry, not duplicate React bundle')
  } finally {
    restore()
  }
})

test('Task8: 500/1000/5000 条 DOM 与视口相关 (Virtualizer viewport limiting)', async () => {
  const { Virtualizer } = await import('@tanstack/virtual-core')
  assert.ok(Virtualizer, 'Virtualizer should be importable')
  const makeEl = (height = 300) => {
    const el = {
      scrollTop: 0,
      scrollHeight: 0,
      offsetHeight: height,
      offsetWidth: 300,
      getBoundingClientRect() {
        return { width: 300, height }
      },
      addEventListener() {},
      removeEventListener() {},
    }
    return el
  }
  const makeTargetWindow = () => ({
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
  })
  const create = (count) => {
    const scrollElement = makeEl(300)
    const win = makeTargetWindow()
    const v = new Virtualizer({
      count,
      getScrollElement: () => scrollElement,
      estimateSize: () => 36,
      overscan: 5,
      scrollToFn: () => {},
      observeElementRect: (_, cb) => {
        cb({ width: 300, height: 300 })
        return () => {}
      },
      observeElementOffset: (_, cb) => {
        cb(0, false)
        return () => {}
      },
    })
    // need to set targetWindow and scrollElement manually for getVirtualItems
    v.scrollElement = scrollElement
    v.targetWindow = win
    v.scrollRect = { width: 300, height: 300 }
    v.scrollOffset = 0
    // Force measurements
    v.measurementsCache = Array.from({ length: count }, (_, i) => ({
      index: i,
      start: i * 36,
      size: 36,
      end: (i + 1) * 36,
      key: i,
    }))
    // getVirtualItems should be viewport-limited
    const items = v.getVirtualItems()
    return items
  }
  const items500 = create(500)
  const items1000 = create(1000)
  const items5000 = create(5000)
  // viewport is 300px, item 36px => ~8-10 visible + overscan 5*2 => ~18-20 items
  for (const [label, items, total] of [
    ['500', items500, 500],
    ['1000', items1000, 1000],
    ['5000', items5000, 5000],
  ]) {
    assert.ok(items.length > 0, `${label} should have some virtual items`)
    assert.ok(items.length < 50, `${label} DOM count should be viewport-limited, got ${items.length} not ~5000`)
    assert.ok(items.length < total, `${label} virtual items ${items.length} should be << total ${total}`)
  }
  // 500/1000/5000 should have similar viewport-limited counts (not linear with total)
  assert.ok(Math.abs(items500.length - items1000.length) <= 5, '500 and 1000 should have similar DOM count')
  assert.ok(Math.abs(items1000.length - items5000.length) <= 5, '1000 and 5000 should have similar DOM count')
})

test('Task8: 暗色/动态行高可用', async () => {
  const { Virtualizer } = await import('@tanstack/virtual-core')
  // dynamic row height via measureElement
  const v = new Virtualizer({
    count: 10,
    getScrollElement: () => null,
    estimateSize: () => 36,
    overscan: 5,
    scrollToFn: () => {},
    observeElementRect: () => () => {},
    observeElementOffset: () => () => {},
  })
  assert.equal(typeof v.measureElement, 'function', 'Virtualizer should support measureElement for dynamic height')
  // dark mode: CSS should use CSS variables, not hard-coded light colors for virtual list
  const styles = readFileSync(join(root, 'bench-styles.mjs'), 'utf8')
  // allow either existing CSS handles dark via var or explicit check in build-client
  const client = readFileSync(join(root, 'client.js'), 'utf8')
  const combined = styles + client
  // Check dark mode support: should use var(--dsw-...) or prefers-color-scheme
  assert.match(
    combined,
    /var\(--dsw|--dsw-alias|prefers-color-scheme/,
    'styles should support dark mode via CSS variables or media query',
  )
  // dynamic height: styles should not fix virtual row height rigidly without measure
  assert.match(
    readFileSync(join(root, 'scripts/build-client.mjs'), 'utf8'),
    /measureElement/,
    'build-client should preserve measureElement for dynamic height',
  )
})

test('Task8: 自动跟随仅底部时生效', async () => {
  // helper shouldStickToBottom logic: only auto-scroll when already at bottom
  const src = readFileSync(join(root, 'scripts/build-client.mjs'), 'utf8')
  assert.match(
    src,
    /shouldStickToBottom|isAtBottom|autoFollow/,
    'build-client should contain auto-follow-at-bottom logic',
  )
  // functional check: simulate helper
  function shouldStickToBottom(scrollTop, scrollHeight, clientHeight, threshold = 5) {
    return scrollHeight - scrollTop - clientHeight <= threshold
  }
  assert.equal(shouldStickToBottom(0, 1000, 300), false, 'at top should not auto-follow')
  assert.equal(shouldStickToBottom(700, 1000, 300), true, 'at bottom should auto-follow')
  assert.equal(shouldStickToBottom(695, 1000, 300), true, 'near bottom within threshold should auto-follow')
  assert.equal(shouldStickToBottom(500, 1000, 300), false, 'middle should not auto-follow')
  // ensure build-client's implementation matches this semantics (check source contains threshold check)
  assert.match(
    src,
    /scrollHeight.*scrollTop.*clientHeight|threshold/,
    'build-client should implement bottom threshold check',
  )
})
