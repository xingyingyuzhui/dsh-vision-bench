// TemperatureDemo fixture for Client debug pages. Pages consume this module;
// they must not define another copy of the same sources / map / session.

const _p = '#pragma once\n'

export const DEMO_SOURCE_FILES = {
  'sensor.c': `#include "sensor.h"

float ReadTemperature(void)
{
    float voltage = ReadVoltage();
    float temperature = voltage * 100.0f;
    return temperature;
}

void UpdateTemperature(void)
{
    current_temperature = ReadTemperature();
}
`,
  'main.c': '#include "sensor.h"\nint main(){while(1){UpdateTemperature();}}\n',
  'display.c': 'void UpdateDisplay(){}\n',
  'system.c': 'void InitSystem(){}\n',
  'sensor.h': _p + 'float ReadTemperature(void);\nvoid UpdateTemperature(void);\n',
  'display.h': _p,
  'system.h': _p,
  'main.h': _p,
}

const demoF = (name, functions = []) => ({
  name,
  path: name,
  rel: name,
  inside: true,
  exists: true,
  readable: true,
  functions,
})

export const DEMO_PROJECT_MAP = {
  project: 'TemperatureDemo.uvprojx',
  target: 'Debug',
  counts: { files: 6, includes: 2, defines: 2, groups: 4 },
  groups: [
    {
      name: 'Source Group1',
      files: [
        demoF('main.c', [{ name: 'main', line: 24 }]),
        demoF('sensor.c', [
          { name: 'ReadTemperature', line: 3 },
          { name: 'UpdateTemperature', line: 10 },
        ]),
      ],
    },
    {
      name: 'Headers',
      files: [demoF('main.h'), demoF('sensor.h')],
    },
    {
      name: 'Startup',
      files: [],
    },
    {
      name: 'Libraries',
      files: [
        demoF('display.c', [
          { name: 'UpdateDisplay', line: 18 },
          { name: 'DrawText', line: 42 },
        ]),
        demoF('system.c', [{ name: 'InitSystem', line: 5 }]),
      ],
    },
  ],
  include_edges: [
    ['main.c', 'sensor.h'],
    ['main.c', 'main.h'],
    ['sensor.c', 'sensor.h'],
    ['display.c', 'sensor.h'],
  ].map(([from, to]) => ({ from, to, resolved: true })),
}

const _s = 'sensor.c'
const _d = 'display.c'
const _m = 'main.c'
const _fn = 'ReadTemperature'
const _ct = 'current_temperature'

function sourceSnippet(file, line, count = 8) {
  const lines = String(DEMO_SOURCE_FILES[file] || '').split('\n')
  const start = Math.max(1, Number(line) || 1)
  return { snippet: lines.slice(start - 1, start - 1 + count).join('\n'), snippetStartLine: start }
}

const mkNode = (name, file, line, signature, callers, callees, extra = {}) => ({
  id: `fn:${name}`,
  name,
  label: name,
  file,
  line,
  location: `${file}:${line}`,
  signature,
  kind: 'function',
  callers,
  callees,
  ...sourceSnippet(file, line),
  ...extra,
})
const cl = (name, loc, expanded = true) => ({ id: `fn:${name}`, name, location: loc, expanded })
const cMain = cl('main', `${_m}:24`)
const cUpd = cl('UpdateTemperature', `${_s}:10`)
const cDsp = cl('UpdateDisplay', `${_d}:18`)
const cRead = cl('ReadTemperature', `${_s}:3`)

export const DEMO_CALL_GRAPH_NODES = [
  mkNode('main', _m, 24, 'int main()', [], [cUpd, cDsp]),
  mkNode('UpdateTemperature', _s, 10, 'void UpdateTemperature()', [cMain], [cRead]),
  mkNode('UpdateDisplay', _d, 18, 'void UpdateDisplay()', [cMain], [cl('DrawText', `${_d}:42`)]),
  mkNode('ReadTemperature', _s, 3, 'float ReadTemperature(void)', [cUpd], [cl('ReadVoltage', '当前层级未展开', false)], {
    canExpand: true,
    expandBadge: '+1 可展开',
  }),
  mkNode('DrawText', _d, 42, 'void DrawText(const char*)', [cDsp], []),
  mkNode('ReadVoltage', _s, 1, 'float ReadVoltage()', [cRead], []),
]

const _stk = (level, fn, file, line) => ({ level, function: fn, file, line })

export const DEMO_DEBUG_SESSION = {
  status: 'paused',
  state: 'paused',
  targetKey: 'TemperatureDemo · Debug',
  backend: 'gdb-openocd',
  location: { file: _s, line: 7, function: _fn },
  stack: [_stk(0, _fn, _s, 7), _stk(1, 'UpdateTemperature', _s, 12), _stk(2, 'main', _m, 24)],
  breakpoints: [
    { id: 'bp:1', file: _s, line: 7, enabled: true },
    { id: 'bp:2', file: _m, line: 24, enabled: true },
  ],
  watchpoints: [],
  variables: {
    locals: [
      { name: 'voltage', type: 'float', value: '0.268' },
      { name: 'temperature', type: 'float', value: '26.8' },
    ],
    registers: [],
  },
  watches: [_ct],
  watchValues: [{ expression: _ct, value: '26.8' }],
  events: [
    { type: 'started', readable: '调试会话已启动', time: '14:05:10' },
    { type: 'paused', readable: '目标已暂停', time: '14:05:11' },
    { type: 'breakpoint', readable: '命中断点', time: '14:05:12', payload: `${_s}:7` },
  ],
}

export function demoFileText(path) {
  return DEMO_SOURCE_FILES[path] || DEMO_SOURCE_FILES[String(path || '').split(/[\\/]/).pop()] || ''
}
