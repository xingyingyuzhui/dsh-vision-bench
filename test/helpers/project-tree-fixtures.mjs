// @ts-check
/** Shared MAP_DETAILS / makePost for project tree suites (P2-5). */
export const MAP_DETAILS = {
  target: 'Debug',
  counts: { files: 3, includes: 1, include_edges: 1 },
  groups: [
    {
      name: 'Source',
      files: [
        {
          name: 'main.c',
          rel: 'src/main.c',
          inside: true,
          exists: true,
          readable: true,
          functions: [
            { name: 'main', line: 12 },
            { name: 'setup', line: 37 },
          ],
        },
        { name: 'missing.c', rel: 'src/missing.c', inside: true, exists: false, readable: false, functions: [] },
      ],
    },
    {
      name: 'Drivers',
      files: [
        {
          name: 'uart.c',
          rel: 'drv/uart.c',
          inside: false,
          exists: true,
          readable: true,
          functions: [{ name: 'uart_init', line: 4 }],
        },
      ],
    },
  ],
  includes: [{ path: 'inc/', exists: true, inside: true }],
  defines: ['USE_HAL', 'STM32F1'],
  include_edges: [{ from: 'main.c', to: 'uart.h', resolved: true }],
}

export const makePost = (details = MAP_DETAILS) => {
  const calls = []
  const post = async (path, body) => {
    calls.push([path, body || {}])
    if (/\/dsh-vision-bench\/keil\/map$/.test(path)) {
      return { ok: true, result: { details } }
    }
    if (/\/dsh-vision-bench\/project\/file$/.test(path)) {
      return {
        ok: true,
        rel: String((body && (body.path || body.file)) || ''),
        text: 'int main(void) { return 0; }\n// setup line',
        lines: 2,
        truncated: false,
      }
    }
    if (/\/dsh-vision-bench\/state$/.test(path)) {
      return {
        ok: true,
        workspace: {
          keil: { project: '/proj/x.uvprojx', target: 'Debug' },
          journal: { tasks: [], running: [], timeline: [] },
          modbus: { version: 3, connections: [], devices: [], points: [], values: [], alarmState: {} },
        },
      }
    }
    return { ok: true }
  }
  return { post, calls }
}
