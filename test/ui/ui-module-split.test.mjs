import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  buildProjectTree,
  fileKind,
  fileMatchesSearch,
  filePassesFilter,
  languageForPath,
} from '../../src/ui/debug/project/project-tree-model.mjs'
import { alarmListForView } from '../../src/ui/monitor/alarms/alarm-filter-model.mjs'
import { filterFrameList, filtersForMode } from '../../src/ui/monitor/frames/frames-filter-model.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

test('UI facades re-export split pages', () => {
  const viz = readFileSync(join(root, 'bench-visualization-view.mjs'), 'utf8')
  const frames = readFileSync(join(root, 'bench-frames-view.mjs'), 'utf8')
  const map = readFileSync(join(root, 'bench-map.mjs'), 'utf8')
  const live = readFileSync(join(root, 'bench-live.mjs'), 'utf8')
  assert.match(viz, /src\/ui\/monitor\/visualization\/visualization-page\.mjs/)
  assert.match(frames, /src\/ui\/monitor\/frames\/frames-page\.mjs/)
  assert.match(map, /src\/ui\/debug\/project\/project-page\.mjs/)
  assert.match(live, /src\/ui\/monitor\/alarms\/alarm-page\.mjs/)
  assert.match(live, /src\/ui\/monitor\/journal\/journal-page\.mjs/)
  assert.doesNotMatch(live, /betterSidebar/)
  assert.doesNotMatch(live, /registerLive/)
  assert.doesNotMatch(map, /betterSidebar/)
  assert.doesNotMatch(map, /registerMap/)
})

test('viz grid and echarts runtimes do not talk to Host or wrap React DOM', () => {
  const grid = readFileSync(join(root, 'src/ui/components/viz-grid.mjs'), 'utf8')
  const gridRt = readFileSync(join(root, 'src/ui/vendor/grid-runtime.mjs'), 'utf8')
  const chartRt = readFileSync(join(root, 'src/ui/vendor/echarts-runtime.mjs'), 'utf8')
  const vendor = readFileSync(join(root, 'scripts/vendor-entry.mjs'), 'utf8')
  for (const src of [grid, gridRt, chartRt]) {
    assert.doesNotMatch(src, /\/dsh-vision-bench\//)
    assert.doesNotMatch(src, /from\s+['"]react['"]/)
    assert.doesNotMatch(src, /\.addWidget\(/)
  }
  assert.match(grid, /makeWidget/)
  assert.match(grid, /removeWidget\(node\.el, false\)/)
  assert.match(grid, /destroy\(false\)/)
  assert.match(vendor, /from 'gridstack'/)
  assert.match(vendor, /echarts\/core/)
  assert.doesNotMatch(vendor, /from\s+['"]echarts-for-react['"]/)
  assert.doesNotMatch(vendor, /from\s+['"]@gridstack\/react['"]/)
})

test('DataTable and table-runtime do not talk to Host or third-party React', () => {
  const table = readFileSync(join(root, 'src/ui/components/data-table.mjs'), 'utf8')
  const runtime = readFileSync(join(root, 'src/ui/vendor/table-runtime.mjs'), 'utf8')
  for (const src of [table, runtime]) {
    assert.doesNotMatch(src, /\/dsh-vision-bench\//)
    assert.doesNotMatch(src, /subscribeState/)
    assert.doesNotMatch(src, /useReactTable/)
    assert.doesNotMatch(src, /flexRender/)
    assert.doesNotMatch(src, /from\s+['"]react['"]/)
    assert.doesNotMatch(src, /from\s+['"]@tanstack\/react-table['"]/)
  }
  assert.match(table, /getRowId/)
  assert.doesNotMatch(table, /from\s+['"]@tanstack\//)
  const pages = [
    'src/ui/monitor/frames/frames-page.mjs',
    'src/ui/monitor/alarms/alarm-page.mjs',
    'src/ui/monitor/journal/journal-page.mjs',
  ]
  for (const file of pages) {
    const src = readFileSync(join(root, file), 'utf8')
    assert.doesNotMatch(src, /from\s+['"]@tanstack\//, file)
    assert.match(src, /createDataTable/, file)
  }
})

test('visualization renderers do not talk to Host', () => {
  const dir = join(root, 'src/ui/monitor/visualization/renderers')
  for (const file of readdirSync(dir)) {
    const src = readFileSync(join(dir, file), 'utf8')
    assert.doesNotMatch(src, /\/dsh-vision-bench\/(state|command|modbus\/write)/)
    assert.doesNotMatch(src, /subscribeState/)
    const lines = src.split('\n').length
    assert.ok(lines <= 200, file + ' renderer is ' + lines + ' lines')
  }
})

test('pure models filter alarms, frames, and project files without React', () => {
  const grouped = {
    buckets: {
      activeUnacked: [
        { id: 'a', group: 'process' },
        { id: 'b', group: 'comm' },
      ],
      activeAcked: [],
      recoveredUnacked: [],
      recoveredAcked: [],
    },
  }
  assert.deepEqual(
    alarmListForView(grouped, 'activeUnacked', 'process').map((x) => x.id),
    ['a'],
  )
  const frames = [
    {
      deviceId: 'd1',
      functionCode: 3,
      status: 'ok',
      source: '',
      request: 'aa',
      response: 'bb',
      label: 'temp',
      connectionId: 'c1',
    },
    {
      deviceId: 'd2',
      functionCode: 1,
      status: 'err',
      source: '',
      request: 'cc',
      response: 'dd',
      label: 'coil',
      connectionId: 'c1',
    },
  ]
  assert.equal(filterFrameList(frames, { deviceId: 'd1' }, '').length, 1)
  assert.equal(filterFrameList(frames, {}, 'coil').length, 1)
  assert.equal(filterFrameList([{ ...frames[0], hex: '01 03 00', direction: 'tx' }], { direction: 'tx' }, '01 03').length, 1)
  assert.equal(filterFrameList([{ ...frames[0], hex: '010300', direction: 'rx' }], { direction: 'tx' }, '').length, 0)
  const protoFlt = { deviceId: 'd1', functionCode: '3', status: 'ok', source: 'polling', direction: 'tx' }
  assert.deepEqual(filtersForMode('raw', protoFlt), {
    deviceId: '',
    functionCode: '',
    status: '',
    source: '',
    direction: 'tx',
  })
  const rawRow = { deviceId: '', functionCode: 0, status: 'ok', source: 'polling', direction: 'tx', hex: '0103' }
  assert.equal(filterFrameList([rawRow], protoFlt, '').length, 0, 'stale proto device filter would hide raw')
  assert.equal(filterFrameList([rawRow], filtersForMode('raw', protoFlt), '').length, 1)
  const file = {
    name: 'main.c',
    rel: 'src/main.c',
    inside: true,
    exists: true,
    readable: true,
    functions: [{ name: 'Init' }],
  }
  assert.equal(fileKind(file), 'ok')
  assert.equal(filePassesFilter(file, 'missing'), false)
  assert.equal(fileMatchesSearch(file, 'init'), true)
  assert.equal(languageForPath('src/main.c'), 'cpp')
  assert.equal(languageForPath('cfg.json'), 'json')
  assert.equal(languageForPath('note.txt'), 'plain')
  const tree = buildProjectTree(
    [
      {
        name: 'Source',
        files: [
          { name: 'main.c', rel: 'src/main.c', inside: true, exists: true, readable: true, functions: [] },
          { name: 'gone.c', rel: 'src/gone.c', inside: true, exists: false, readable: false, functions: [] },
        ],
      },
    ],
    { filter: 'missing', search: '' },
  )
  assert.equal(tree.length, 1)
  assert.equal(tree[0].files.length, 1)
  assert.equal(tree[0].files[0].name, 'gone.c')
})

test('source-editor does not talk to Host', () => {
  const src = readFileSync(join(root, 'src/ui/components/source-editor.mjs'), 'utf8')
  assert.doesNotMatch(src, /\/dsh-vision-bench\//)
  assert.doesNotMatch(src, /from\s+['"]react['"]/)
  assert.match(src, /EditorView/)
  assert.match(src, /readOnly/)
})
