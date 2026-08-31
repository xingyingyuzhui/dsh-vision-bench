import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { fileKind, fileMatchesSearch, filePassesFilter } from '../../src/ui/debug/project/project-tree-model.mjs'
import { alarmListForView } from '../../src/ui/monitor/alarms/alarm-filter-model.mjs'
import { filterFrameList } from '../../src/ui/monitor/frames/frames-filter-model.mjs'

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
})
