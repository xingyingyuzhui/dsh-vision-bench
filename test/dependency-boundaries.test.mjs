import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('bench-visualization-view must not import bench-live', async () => {
  const src = readFileSync(join(root, 'bench-visualization-view.mjs'), 'utf8')
  assert.doesNotMatch(src, /from\s+['"]\.\/bench-live\.mjs['"]/)
  assert.match(src, /from\s+['"]\.\/src\/ui\/common\/session-scope\.mjs['"]/)
})

test('bench-live and bench-map import sessionCwd from session-scope', async () => {
  const live = readFileSync(join(root, 'bench-live.mjs'), 'utf8')
  const map = readFileSync(join(root, 'bench-map.mjs'), 'utf8')
  assert.match(live, /from\s+['"]\.\/src\/ui\/common\/session-scope\.mjs['"]/)
  assert.match(map, /from\s+['"]\.\/src\/ui\/common\/session-scope\.mjs['"]/)
  assert.doesNotMatch(live, /export function sessionCwd/)
})

test('bench-shared is a re-export facade only', async () => {
  const src = readFileSync(join(root, 'bench-shared.mjs'), 'utf8')
  assert.match(src, /Compatibility facade/)
  assert.doesNotMatch(src, /export function subscribeState/)
  assert.doesNotMatch(src, /export function buildAgentRef/)
  assert.match(src, /src\/ui\/common\//)
})

test('internal runtime uses createVisualizationPage (not createTrendPage)', async () => {
  const runtime = readFileSync(join(root, 'bench-runtime.mjs'), 'utf8')
  const monitor = readFileSync(join(root, 'src/ui/workspace/monitor-workspace.mjs'), 'utf8')
  assert.match(monitor, /createVisualizationPage/)
  assert.doesNotMatch(runtime, /createTrendPage/)
  assert.doesNotMatch(runtime, /betterSidebar/)
  assert.match(runtime, /vision-bench-monitor|VIEW_MONITOR|createMonitorWorkspace/)
})

test('dependency-cruiser reports zero circular dependencies for UI graph', async () => {
  const out = execFileSync(
    process.execPath,
    [
      join(root, 'node_modules/dependency-cruiser/bin/dependency-cruise.mjs'),
      '--config',
      'dependency-cruiser.config.mjs',
      '--output-type',
      'err',
      'src/ui',
      'bench-live.mjs',
      'bench-visualization-view.mjs',
      'bench-frames-view.mjs',
      'bench-view.mjs',
      'bench-hmi.mjs',
      'bench-map.mjs',
      'bench-shared.mjs',
      'bench-runtime.mjs',
    ],
    { cwd: root, encoding: 'utf8' },
  )
  assert.doesNotMatch(out, /no-circular/)
  assert.match(out, /no dependency violations|0 errors/)
})
