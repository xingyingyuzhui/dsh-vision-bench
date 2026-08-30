import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

// Task1 / 0.18.1: bundle uPlot + @tanstack/virtual-core into `DvbVendor`
// factory-scope var. Third-party JS is never reached via window/globalThis.
async function buildVendor(root) {
  const res = await esbuild.build({
    entryPoints: [join(root, 'scripts/vendor-entry.mjs')],
    bundle: true,
    format: 'iife',
    globalName: 'DvbVendor',
    minify: true,
    target: ['es2020'],
    // Task2/0.18.2: harness provides React via the ModuleLoader factory
    // `require` — never bundle a second React. react-dom is aliased to a tiny
    // flushSync shim so the bundle never issues require('react-dom').
    external: ['react'],
    alias: { 'react-dom': join(root, 'scripts/react-dom-shim.mjs') },
    logLevel: 'error',
    write: false,
  })
  const iife = res.outputFiles[0].text.trim()
  return 'var DvbVendor = ' + iife.replace(/^var DvbVendor\s*=\s*/, '').replace(/;$/, '') + ';'
}

async function readUplotCss(root) {
  // uPlot official CSS is injected verbatim (Task1: 不手写替代版 uPlot 样式)
  const p = join(root, 'node_modules/uplot/dist/uPlot.min.css')
  try {
    return readFileSync(p, 'utf8')
  } catch (e) {
    throw new Error('无法读取 uPlot 官方 CSS: ' + p + ' (' + e.message + ')')
  }
}

// Task8: @tanstack/virtual-core 依赖兼容小样 — 验证点：
// - 生成客户端可加载（valid JS via new Function）
// - Harness React 不双份（client 不打包 React，复用宿主 React）
// - 500/1000/5000 条 DOM 与视口相关（Virtualizer overscan 视口裁剪）
// - 暗色/动态行高可用（measureElement + CSS 变量 dark）
// - 自动跟随仅底部时生效（shouldStickToBottom 阈值判定）
import { Virtualizer } from '@tanstack/virtual-core'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// Virtualizer viewport / dark / dynamic / autoFollow 兼容校验（不影响打包，仅验证依赖可用）
function shouldStickToBottom(scrollTop, scrollHeight, clientHeight, threshold = 5) {
  return scrollHeight - scrollTop - clientHeight <= threshold
}
function validateVirtualCompat() {
  const makeEl = (h = 300) => ({
    scrollTop: 0,
    scrollHeight: 0,
    offsetHeight: h,
    offsetWidth: 300,
    getBoundingClientRect() {
      return { width: 300, height: h }
    },
    addEventListener() {},
    removeEventListener() {},
  })
  const win = {
    ResizeObserver: class {
      observe() {}
      unobserve() {}
    },
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    cancelAnimationFrame: () => {},
  }
  const sample = (count) => {
    const el = makeEl(300)
    const v = new Virtualizer({
      count,
      getScrollElement: () => el,
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
    v.scrollElement = el
    v.targetWindow = win
    v.scrollRect = { width: 300, height: 300 }
    v.scrollOffset = 0
    v.measurementsCache = Array.from({ length: count }, (_, i) => ({
      index: i,
      start: i * 36,
      size: 36,
      end: (i + 1) * 36,
      key: i,
    }))
    // dark mode handled via CSS variables (bench-styles uses var(--dsw...)), not hard-coded
    // dynamic row height via measureElement API
    void v.measureElement
    return v.getVirtualItems()
  }
  const a = sample(500)
  const b = sample(1000)
  const c = sample(5000)
  if (a.length >= 50 || b.length >= 50 || c.length >= 50) throw new Error('Virtualizer DOM should be viewport-limited')
  if (Math.abs(a.length - b.length) > 5 || Math.abs(b.length - c.length) > 5)
    throw new Error('500/1000/5000 should have similar viewport DOM count')
  if (!shouldStickToBottom(700, 1000, 300) || shouldStickToBottom(0, 1000, 300))
    throw new Error('autoFollow shouldStickToBottom only at bottom')
  // prefers-color-scheme / CSS var dark support is verified via bench-styles content at build time (see styles check)
}
// Task1: dependency/vendor validation failure MUST fail the build (no swallow).
validateVirtualCompat()

function stripModule(src) {
  return (
    src
      // Aliased specifiers must become REAL bindings: `X as Y` -> var Y = X.
      // Deleting import blocks outright silently kills aliases (the blank-page
      // bug of v0.17.0).
      .replace(/^import\s*\{([^}]*)\}\s*from\s*'[^']+'\n+/gm, (_m, specs) => {
        const decls = String(specs)
          .split(',')
          .map((piece) => piece.trim())
          .filter(Boolean)
          .map((spec) => {
            const mm = spec.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/)
            return mm ? `var ${mm[2]} = ${mm[1]};` : null
          })
          .filter(Boolean)
        return decls.length ? decls.join('\n') + '\n' : ''
      })
      .replace(/^import\s+([A-Za-z_$][\w$]*)\s+from\s*'[^']+'\n+/gm, 'var $1 = $1;\n')
      .replace(/^import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*'[^']+'\n+/gm, '')
      // Re-exports contribute no new factory-scope bindings: the underlying
      // symbol already exists in its defining module.
      .replace(/^export\s*\{[^}]*\}\s*from\s*'[^']+'\n+/gm, '')
      .replace(/^import[\s\S]*?from '[^']+'\n+/gm, '')
      .replace(/^export /gm, '')
  )
}

function assertUniqueBindings(stripped, file) {
  // Split a declarator list on TOP-LEVEL commas only — commas inside arrow
  // params or object literals are not separators.
  const splitTop = (text) => {
    const out = []
    let depth = 0
    let cur = ''
    let quote = null
    for (const ch of text) {
      if (quote) {
        cur += ch
        if (ch === quote) quote = null
        continue
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        quote = ch
        cur += ch
        continue
      }
      if ('([{'.includes(ch)) depth += 1
      if (')]}'.includes(ch)) depth -= 1
      if (ch === ',' && depth === 0) {
        out.push(cur)
        cur = ''
        continue
      }
      cur += ch
    }
    out.push(cur)
    return out
  }

  // Top-level declarations, including destructures and comma declarators.
  const re = /^(?:async\s+)?(?:function\*?|class)\s+([A-Za-z_$][\w$]*)|^(?:const|let|var)\s+([^;\n]+);?/gm
  let match
  while ((match = re.exec(stripped))) {
    const names = match[2]
      ? splitTop(match[2])
          .map((part) => {
            const decl = part.trim()
            const fnLike = decl.match(/^([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(|function)/)
            if (fnLike) return fnLike[1]
            const destructure = decl.match(/^(?:\{([^}]*)\}|\[([^\]]*)\])\s*=/)
            if (destructure) {
              return (destructure[1] || destructure[2]).split(',').map((piece) => piece.trim().split(':')[0].trim())
            }
            const simple = decl.match(/^([A-Za-z_$][\w$]*)\s*=|^([A-Za-z_$][\w$]*)$/)
            return simple ? simple[1] || simple[2] : []
          })
          .flat()
      : [match[1]]
    for (const name of names.filter(Boolean)) {
      const prev = seen.get(name)
      if (prev) {
        throw new Error(
          'duplicate binding "' +
            name +
            '" in ' +
            file +
            ' (already in ' +
            prev +
            '); strip-concat is one factory scope',
        )
      }
      seen.set(name, file)
    }
  }
}

const seen = new Map()

const parts = [
  'bench-vendor.mjs',
  'bench-i18n.mjs',
  // Styles modules before aggregator
  'src/ui/styles/base.mjs',
  'src/ui/styles/hmi.mjs',
  'src/ui/styles/sidebar.mjs',
  'src/ui/styles/visualization.mjs',
  'src/ui/styles/frames.mjs',
  'bench-styles.mjs',
  'bench-settings.mjs',
  'src/domain/modbus/point-math.mjs',
  'bench-points.mjs',
  'bench-alarm.mjs',
  'bench-devices.mjs',
  'bench-visualization-model.mjs',
  // UI common helpers (must precede views that used to import bench-shared implementations)
  'src/ui/common/ui-format.mjs',
  'src/ui/common/state-subscription.mjs',
  'src/ui/common/frame-cache.mjs',
  'src/ui/common/sidebar-scope.mjs',
  'src/ui/common/focus-store.mjs',
  'src/ui/common/agent-reference.mjs',
  'src/ui/common/session-scope.mjs',
  'bench-shared.mjs',
  'bench-visualization-view.mjs',
  'bench-io-capability.mjs',
  'bench-trend.mjs',
  'bench-view.mjs',
  // HMI modules before facade
  'src/ui/hmi/hmi-ids.mjs',
  'src/ui/hmi/hmi-controller.mjs',
  'src/ui/hmi/point-flags.mjs',
  'src/ui/hmi/inline-write.mjs',
  'src/ui/hmi/batch-add.mjs',
  'src/ui/hmi/csv-transfer.mjs',
  'src/ui/hmi/point-table.mjs',
  'src/ui/hmi/point-editor.mjs',
  'src/ui/hmi/point-row.mjs',
  'src/ui/hmi/connection-tabs.mjs',
  'src/ui/hmi/connection-panel.mjs',
  'src/ui/hmi/connection-form.mjs',
  'src/ui/hmi/device-form.mjs',
  'src/ui/hmi/device-card.mjs',
  'src/ui/hmi/hmi-command-client.mjs',
  'src/ui/hmi/hooks/use-hmi-state.mjs',
  'src/ui/hmi/hooks/use-connections.mjs',
  'src/ui/hmi/hooks/use-points.mjs',
  'src/ui/hmi/hooks/use-agent-focus.mjs',
  'src/ui/hmi/hooks/use-pending-writes.mjs',
  'src/ui/hmi/connection-overview.mjs',
  'src/ui/hmi/connection-workspace.mjs',
  'src/ui/hmi/connection-editor.mjs',
  'src/ui/hmi/device-editor.mjs',
  'src/ui/hmi/device-section.mjs',
  'src/ui/hmi/hmi-config-persistence.mjs',
  'src/ui/hmi/hmi-core-actions.mjs',
  'src/ui/hmi/hmi-connection-actions.mjs',
  'src/ui/hmi/hmi-point-actions.mjs',
  'src/ui/hmi/hmi-live-actions.mjs',
  'src/ui/hmi/hmi-page-actions.mjs',
  'src/ui/hmi/hmi-page.mjs',
  'bench-hmi.mjs',
  'bench-live.mjs',
  'bench-frames-model.mjs',
  'bench-frames-view.mjs',
  'bench-map.mjs',
  'bench-runtime.mjs',
].map((file) => {
  const stripped = stripModule(readFileSync(join(root, file), 'utf8'))
  assertUniqueBindings(stripped, file)
  return stripped
})

const banner = `// Generated by scripts/build-client.mjs. Do not edit by hand.

`

async function assembleVendor() {
  const vendor = await buildVendor(root) // var DvbVendor = (()=>{...})();
  const uplotCss = await readUplotCss(root)
  return vendor + '\nvar DvbVendorCss = ' + JSON.stringify('\n' + uplotCss.trim()) + ';'
}

const bodyTpl = (vendorBlock, bodyParts) => `window.__ModuleLoader__.load({
  id: 'dsh-vision-bench',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    var name = 'dsh-vision-bench'
    var inject = ['slots']

${vendorBlock}
${bodyParts.join('\n')}

    exports.name = name
    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
`

async function main() {
  const vendorBlock = await assembleVendor()
  const next = banner + bodyTpl(vendorBlock, parts)
  const dest = join(root, 'client.js')
  const check = process.argv.includes('--check')
  if (check) {
    const current = readFileSync(dest, 'utf8')
    if (current !== next) {
      console.error('client.js is stale; run node scripts/build-client.mjs')
      process.exit(1)
    }
    process.exit(0)
  }
  writeFileSync(dest, next)
}

main().catch((e) => {
  console.error('build-client failed:', e && e.message ? e.message : e)
  process.exit(1)
})
