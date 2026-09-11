import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFrameColumns } from '../../src/ui/monitor/frames/frames-columns.mjs'
import { formatPortName } from '../../src/ui/monitor/frames/frames-format.mjs'
import {
  DEFAULT_FRAME_COL_WIDTHS,
  MIN_FRAME_COL_WIDTHS,
  loadFrameColWidths,
  sanitizeFrameColWidths,
  saveFrameColWidths,
  useFrameColWidths,
} from '../../src/ui/monitor/frames/use-frame-col-widths.mjs'

test('DEFAULT_FRAME_COL_WIDTHS defines defaults and bounds for all columns', () => {
  const keys = ['time', 'port', 'dir', 'device', 'fc', 'status', 'bytes', 'hex']
  for (const k of keys) {
    assert.equal(typeof DEFAULT_FRAME_COL_WIDTHS[k], 'number', `missing default for ${k}`)
    assert.ok(DEFAULT_FRAME_COL_WIDTHS[k] > 0)
    assert.equal(typeof MIN_FRAME_COL_WIDTHS[k], 'number', `missing min for ${k}`)
    assert.ok(MIN_FRAME_COL_WIDTHS[k] <= DEFAULT_FRAME_COL_WIDTHS[k])
  }
})

test('sanitizeFrameColWidths respects minimum and maximum bounds', () => {
  const sanitized = sanitizeFrameColWidths({
    time: 10, // below min
    port: 2000, // above max
    dir: 'invalid',
    unknown: 100,
  })
  assert.equal(sanitized.time, MIN_FRAME_COL_WIDTHS.time)
  assert.equal(sanitized.port, 1200)
  assert.equal(sanitized.dir, DEFAULT_FRAME_COL_WIDTHS.dir)
  assert.equal(sanitized.unknown, undefined)
})

test('localStorage load and save roundtrips safely', () => {
  const storage = new Map()
  globalThis.localStorage = {
    getItem: (k) => storage.get(k) || null,
    setItem: (k, v) => storage.set(k, String(v)),
  }

  try {
    saveFrameColWidths({ time: 150, port: 90 })
    const loaded = loadFrameColWidths()
    assert.equal(loaded.time, 150)
    assert.equal(loaded.port, 90)
    assert.equal(loaded.dir, DEFAULT_FRAME_COL_WIDTHS.dir)
  } finally {
    delete globalThis.localStorage
  }
})

test('buildFrameColumns applies colWidths properly', () => {
  const React = { createElement: () => ({}) }
  const t = (k) => k
  const customWidths = {
    time: 140,
    port: 90,
    dir: 100,
    device: 120,
    fc: 80,
    status: 75,
    bytes: 70,
    hex: 300,
  }

  const protoCols = buildFrameColumns(
    React,
    t,
    {},
    {
      mode: 'proto',
      devices: [],
      encoding: 'hex',
      colWidths: customWidths,
    },
  )

  const protoMap = Object.fromEntries(protoCols.map((c) => [c.id, c]))
  assert.equal(protoMap.time.size, 140)
  assert.equal(protoMap.port.size, 90)
  assert.equal(protoMap.dir.size, 100)
  assert.equal(protoMap.device.size, 120)
  assert.equal(protoMap.fc.size, 80)
  assert.equal(protoMap.status.size, 75)
  assert.equal(protoMap.hex.minSize, 300)

  const rawCols = buildFrameColumns(
    React,
    t,
    {},
    {
      mode: 'raw',
      devices: [],
      encoding: 'hex',
      colWidths: customWidths,
    },
  )

  const rawMap = Object.fromEntries(rawCols.map((c) => [c.id, c]))
  assert.equal(rawMap.bytes.size, 70)
  assert.equal(rawMap.hex.minSize, 300)
})

test('useFrameColWidths calculates totalTableWidth for proto and raw modes', () => {
  const store = { state: null }
  const React = {
    useState(init) {
      if (store.state === null) store.state = typeof init === 'function' ? init() : init
      return [
        store.state,
        (next) => {
          store.state = typeof next === 'function' ? next(store.state) : next
        },
      ]
    },
    useRef(init) {
      return { current: init }
    },
    useCallback(fn) {
      return fn
    },
  }

  const hook = useFrameColWidths(React)
  const protoWidth = hook.totalTableWidth('proto')
  const rawWidth = hook.totalTableWidth('raw')

  assert.ok(protoWidth > 400)
  assert.ok(rawWidth > 350)
  assert.notEqual(protoWidth, rawWidth)
})

test('formatPortName converts c1 / c2 shorthand to COM1 / COM2 and respects connection ports', () => {
  assert.equal(formatPortName({ port: 'COM1' }), 'COM1')
  assert.equal(formatPortName({ port: 'com2' }), 'COM2')
  assert.equal(formatPortName({ port: 'c1' }), 'COM1')
  assert.equal(formatPortName({ port: 'C1' }), 'COM1')
  assert.equal(formatPortName({ port: 'c2' }), 'COM2')
  assert.equal(formatPortName({ connectionId: 'c1' }), 'COM1')
  assert.equal(formatPortName({ connectionId: 'c2' }), 'COM2')

  const conns = [
    { id: 'c1', name: 'C1', conn: { port: 'COM3' } },
    { id: 'c2', name: 'C2', conn: { port: 'COM4' } },
  ]
  assert.equal(formatPortName({ connectionId: 'c1' }, conns), 'COM3')
  assert.equal(formatPortName({ connectionId: 'c2' }, conns), 'COM4')
  assert.equal(formatPortName({ port: 'c1' }, conns), 'COM3')
})

test('loadFrameColWidths automatically migrates old 118 default to 76', () => {
  const storage = new Map()
  storage.set('dvb_frame_col_widths', JSON.stringify({ time: 118, port: 72 }))
  globalThis.localStorage = {
    getItem: (k) => storage.get(k) || null,
    setItem: (k, v) => storage.set(k, String(v)),
  }

  try {
    const loaded = loadFrameColWidths()
    assert.equal(loaded.time, 76)
    assert.equal(loaded.port, 72)
  } finally {
    delete globalThis.localStorage
  }
})
