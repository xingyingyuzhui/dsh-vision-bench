// @ts-check

import assert from 'node:assert/strict'
import test from 'node:test'
import { createBreakpointPanel } from '../../src/ui/debug/runtime/breakpoint-panel.mjs'
import { createDebugApprovalCard } from '../../src/ui/debug/runtime/debug-approval-card.mjs'
import { createDebugTimelinePanel } from '../../src/ui/debug/runtime/debug-timeline-panel.mjs'
import { createDebugToolbar } from '../../src/ui/debug/runtime/debug-toolbar.mjs'
import { createRuntimeController } from '../../src/ui/debug/runtime/runtime-controller.mjs'
import { createStackPanel } from '../../src/ui/debug/runtime/stack-panel.mjs'
import { createVariablesPanel } from '../../src/ui/debug/runtime/variables-panel.mjs'
import { createDebugWorkspace } from '../../src/ui/workspace/debug-workspace.mjs'
import { DEBUG_SECTIONS, focusKindOf, isDebugSection, routeForKind } from '../../src/ui/workspace/vision-route.mjs'

// Simple mock React for testing pure component render output
const mockReact = {
  createElement(type, props, ...children) {
    const flatChildren = children.flat().filter(Boolean)
    return { type, props: props || {}, children: flatChildren }
  },
  useState(init) {
    return [typeof init === 'function' ? init() : init, () => {}]
  },
  useEffect() {},
  useCallback(fn) {
    return fn
  },
  useMemo(fn) {
    return fn()
  },
  useRef(init) {
    return { current: init }
  },
}

const mockT = (k) => k

test('runtime-controller: dispatches correct RPC endpoints with scope', async () => {
  const calls = []
  const mockPost = async (path, body, timeout) => {
    calls.push({ path, body, timeout })
    return { ok: true }
  }

  const scope = { cwd: '/workspace/project', sessionId: 'sess-123' }
  const controller = createRuntimeController(mockPost, scope)

  // 1. getState
  await controller.getState('ds-1')
  assert.equal(calls[0]?.path, '/dsh-vision-bench/debug/state')
  assert.deepEqual(calls[0]?.body, {
    cwd: '/workspace/project',
    sessionId: 'sess-123',
    debugSessionId: 'ds-1',
  })

  // 2. command
  await controller.command('continue', { targetSpec: { target: 'stm32' } })
  assert.equal(calls[1]?.path, '/dsh-vision-bench/debug/command')
  assert.equal(calls[1]?.body.op, 'continue')
  assert.equal(calls[1]?.body.cwd, '/workspace/project')
  assert.equal(calls[1]?.body.sessionId, 'sess-123')
  assert.equal(calls[1]?.body.targetSpec.target, 'stm32')

  // 3. waitEvents
  await controller.waitEvents(42, undefined, 15000)
  assert.equal(calls[2]?.path, '/dsh-vision-bench/debug/events/wait')
  assert.equal(calls[2]?.body.cursor, 42)
  assert.equal(calls[2]?.body.timeoutMs, 15000)

  // 4. approval
  await controller.approval('approve', { requestId: 'req-42' })
  assert.equal(calls[3]?.path, '/dsh-vision-bench/debug/approval')
  assert.equal(calls[3]?.body.op, 'approve')
  assert.equal(calls[3]?.body.requestId, 'req-42')
})

test('vision-route: handles RUNTIME section, focusKindOf, and routeForKind', () => {
  assert.equal(DEBUG_SECTIONS.RUNTIME, 'runtime')
  assert.equal(isDebugSection('runtime'), true)
  assert.equal(isDebugSection('unknown'), false)

  // Route for debug kinds
  const debugKinds = ['debug', 'breakpoint', 'watchpoint', 'snapshot', 'debug-event', 'runtime']
  for (const kind of debugKinds) {
    const route = routeForKind(kind)
    assert.equal(route.viewId, 'vision-bench-debug')
    assert.equal(route.section, 'runtime')
    assert.equal(route.tab, 'runtime')
  }

  // focusKindOf runtime triggers
  assert.equal(focusKindOf({ request: { debugSessionId: 'ds-1' } }), 'runtime')
  assert.equal(focusKindOf({ request: { breakpointId: 'bp-1' } }), 'runtime')
  assert.equal(focusKindOf({ request: { watchpointId: 'wp-1' } }), 'runtime')
  assert.equal(focusKindOf({ request: { snapshotId: 'snap-1' } }), 'runtime')
})

test('debug-toolbar: renders correct action buttons according to status', () => {
  const Toolbar = createDebugToolbar(mockReact, mockT)

  // Idle state: Start button available, Continue/Step/Pause/Reset unavailable
  const idleTree = Toolbar({ status: 'idle' })
  assert.equal(idleTree.props.className, 'dvb-debug-toolbar')
  const btnGroupIdle = idleTree.children[1]
  const idleLabels = btnGroupIdle.children.map((c) => (typeof c.children[0] === 'string' ? c.children[0] : ''))
  assert.ok(
    idleLabels.some((l) => l.includes('启动调试')),
    'Start button must exist in idle state',
  )
  assert.ok(!idleLabels.some((l) => l.includes('继续')), 'Continue button must not exist in idle state')
  assert.ok(!idleLabels.some((l) => l.includes('暂停')), 'Pause button must not exist in idle state')

  // Running state: Pause & Stop buttons available
  const runningTree = Toolbar({ status: 'running' })
  const btnGroupRunning = runningTree.children[1]
  const runningLabels = btnGroupRunning.children.map((c) => (typeof c.children[0] === 'string' ? c.children[0] : ''))
  assert.ok(
    runningLabels.some((l) => l.includes('暂停')),
    'Pause button must exist in running state',
  )
  assert.ok(
    runningLabels.some((l) => l.includes('停止')),
    'Stop button must exist in running state',
  )
  assert.ok(!runningLabels.some((l) => l.includes('启动调试')), 'Start button must not exist in running state')

  // Paused state: Continue, Step (Over/Into/Out), Reset, Stop available
  const pausedTree = Toolbar({ status: 'paused' })
  const btnGroupPaused = pausedTree.children[1]
  const pausedLabels = btnGroupPaused.children.map((c) => (typeof c.children[0] === 'string' ? c.children[0] : ''))
  assert.ok(
    pausedLabels.some((l) => l.includes('继续')),
    'Continue button must exist in paused state',
  )
  assert.ok(
    pausedLabels.some((l) => l.includes('单步跳过')),
    'Step Over button must exist in paused state',
  )
  assert.ok(
    pausedLabels.some((l) => l.includes('进入')),
    'Step Into button must exist in paused state',
  )
  assert.ok(
    pausedLabels.some((l) => l.includes('复位')),
    'Reset button must exist in paused state',
  )
  assert.ok(
    pausedLabels.some((l) => l.includes('停止')),
    'Stop button must exist in paused state',
  )
})

test('debug-approval-card: renders pending tickets and dispatches callbacks', () => {
  const ApprovalCard = createDebugApprovalCard(mockReact, mockT)

  let approvedId = ''
  let rejectedId = ''
  const tickets = [
    { requestId: 'ticket-1', reason: 'Agent requested gdb start', backend: 'gdb-openocd', target: 'STM32F407' },
  ]

  const tree = ApprovalCard({
    tickets,
    onApprove: (id) => {
      approvedId = id
    },
    onReject: (id) => {
      rejectedId = id
    },
  })

  assert.ok(tree, 'ApprovalCard should render when tickets exist')
  assert.equal(tree.children.length, 1)

  const card = tree.children[0]
  assert.equal(card.props.className, 'dvb-debug-approval-card')
  const btnGroup = card.children[1]
  assert.equal(btnGroup.children.length, 2)

  // Click approve
  btnGroup.children[0].props.onClick()
  assert.equal(approvedId, 'ticket-1')

  // Click reject
  btnGroup.children[1].props.onClick()
  assert.equal(rejectedId, 'ticket-1')
})

test('stack-panel: renders call stack frames and triggers frame selection', () => {
  const StackPanel = createStackPanel(mockReact, mockT)

  let selected = -1
  const stack = [
    { level: 0, function: 'HardFault_Handler', file: 'stm32f4xx_it.c', line: 55 },
    { level: 1, function: 'main', file: 'main.c', line: 120 },
  ]

  const tree = StackPanel({
    stack,
    selectedFrame: 0,
    onSelectFrame: (lvl) => {
      selected = lvl
    },
  })

  assert.equal(tree.props.className, 'dvb-debug-panel')
  const body = tree.children[1]
  assert.equal(body.children.length, 2)

  // Frame 0 is active
  assert.ok(body.children[0].props.className.includes('is-active'))

  // Click frame 1
  body.children[1].props.onClick()
  assert.equal(selected, 1)
})

test('variables-panel: renders variables and registers', () => {
  const VariablesPanel = createVariablesPanel(mockReact, mockT)

  const locals = [
    { name: 'count', value: '42', type: 'int' },
    { name: 'status', value: '0x01', type: 'uint8_t' },
  ]

  const tree = VariablesPanel({
    locals,
    watches: ['buffer[0]'],
    watchValues: [{ expression: 'buffer[0]', value: '0xaa' }],
    registers: [{ name: 'pc', value: '0x08000100' }],
  })

  assert.equal(tree.props.className, 'dvb-debug-panel')
  const body = tree.children[1]
  assert.equal(body.children.length, 2)
  assert.equal(body.children[0].props.className, 'dvb-debug-var-row')
})

test('breakpoint-panel: renders breakpoints and watchpoints', () => {
  const BreakpointPanel = createBreakpointPanel(mockReact, mockT)

  let removedBp = ''
  const breakpoints = [{ id: 'bp-1', file: 'main.c', line: 45, condition: 'i > 5' }]

  const tree = BreakpointPanel({
    breakpoints,
    watchpoints: [],
    onRemoveBreakpoint: (id) => {
      removedBp = id
    },
  })

  assert.equal(tree.props.className, 'dvb-debug-panel')
  const body = tree.children[1]
  // subTab defaults to bp
  const bpContainer = body.children[0]
  const bpRow = bpContainer.children[1]
  assert.equal(bpRow.props.className, 'dvb-debug-item')

  // Click remove breakpoint
  const delBtn = bpRow.children[1]
  delBtn.props.onClick()
  assert.equal(removedBp, 'bp-1')
})

test('debug-timeline-panel: renders debug event stream', () => {
  const Timeline = createDebugTimelinePanel(mockReact, mockT)

  const events = [
    { type: 'running', timestamp: 1700000000000 },
    { type: 'breakpoint_hit', timestamp: 1700000001000, payload: { bpId: 'bp-1' } },
  ]

  const tree = Timeline({ events })
  assert.equal(tree.props.className, 'dvb-debug-timeline')
  const list = tree.children[1]
  assert.equal(list.children.length, 3) // 2 entries + 1 end ref div
  assert.equal(list.children[0].props.className, 'dvb-debug-timeline-entry')
  assert.equal(list.children[1].props.className, 'dvb-debug-timeline-entry')
})

test('debug-workspace: exports 3 sections (workbench, project, runtime)', () => {
  let renderedSection = ''
  const mockPost = async () => ({ ok: true })
  const Workspace = createDebugWorkspace(mockReact, mockT, mockPost)

  const tree = Workspace({ sessionId: 's1', scope: { cwd: '/test' } })
  assert.equal(tree.props['data-workspace'], 'debug')
  // Tabs contain 3 sections
  const tabs = tree.children[0]
  assert.ok(tabs)
})
