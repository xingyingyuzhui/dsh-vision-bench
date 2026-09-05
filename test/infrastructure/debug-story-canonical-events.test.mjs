import assert from 'node:assert/strict'
import test from 'node:test'
import { debugStoryToArchify } from '../../src/infrastructure/archify/archify-adapter.mjs'
import { DEBUG_EVENT_TYPES } from '../../src/shared/debug-events.mjs'

test('debugStoryToArchify: maps canonical DEBUG_EVENT_TYPES.* with correct titles and steps', () => {
  const events = [
    {
      id: 'e1',
      cursor: 1,
      debugSessionId: 's1',
      workspaceCwd: '/ws',
      ownerSessionId: 'o1',
      timestamp: 1000,
      type: DEBUG_EVENT_TYPES.SESSION_STARTING,
      backend: 'gdb-openocd',
    },
    {
      id: 'e2',
      cursor: 2,
      debugSessionId: 's1',
      workspaceCwd: '/ws',
      ownerSessionId: 'o1',
      timestamp: 1100,
      type: DEBUG_EVENT_TYPES.SESSION_READY,
      backend: 'gdb-openocd',
    },
    {
      id: 'e3',
      cursor: 3,
      debugSessionId: 's1',
      workspaceCwd: '/ws',
      ownerSessionId: 'o1',
      timestamp: 1200,
      type: DEBUG_EVENT_TYPES.RUNNING,
      backend: 'gdb-openocd',
    },
    {
      id: 'e4',
      cursor: 4,
      debugSessionId: 's1',
      workspaceCwd: '/ws',
      ownerSessionId: 'o1',
      timestamp: 1300,
      type: DEBUG_EVENT_TYPES.BREAKPOINT_HIT,
      backend: 'gdb-openocd',
      payload: {
        breakpointId: 'bp1',
        location: { file: 'Core/Src/main.c', line: 42 },
      },
    },
    {
      id: 'e5',
      cursor: 5,
      debugSessionId: 's1',
      workspaceCwd: '/ws',
      ownerSessionId: 'o1',
      timestamp: 1400,
      type: DEBUG_EVENT_TYPES.STEP_COMPLETE,
      backend: 'gdb-openocd',
      payload: {
        location: { file: 'Core/Src/main.c', line: 43 },
      },
    },
    {
      id: 'e6',
      cursor: 6,
      debugSessionId: 's1',
      workspaceCwd: '/ws',
      ownerSessionId: 'o1',
      timestamp: 1500,
      type: DEBUG_EVENT_TYPES.WATCHPOINT_HIT,
      backend: 'gdb-openocd',
      payload: {
        watchpointExpression: 'counter',
        location: { file: 'Core/Src/main.c', line: 45 },
      },
    },
    {
      id: 'e7',
      cursor: 7,
      debugSessionId: 's1',
      workspaceCwd: '/ws',
      ownerSessionId: 'o1',
      timestamp: 1600,
      type: DEBUG_EVENT_TYPES.SNAPSHOT_CREATED,
      backend: 'gdb-openocd',
      payload: {
        snapshotId: 'snap-1',
        reason: 'watchpoint-hit',
      },
    },
    {
      id: 'e8',
      cursor: 8,
      debugSessionId: 's1',
      workspaceCwd: '/ws',
      ownerSessionId: 'o1',
      timestamp: 1700,
      type: DEBUG_EVENT_TYPES.SESSION_STOPPED,
      backend: 'gdb-openocd',
    },
  ]

  const snapshots = [
    {
      id: 'snap-1',
      createdAt: 1600,
      reason: 'watchpoint-hit',
      location: { file: 'Core/Src/main.c', line: 45 },
      backend: 'gdb-openocd',
    },
  ]

  const story = debugStoryToArchify(events, snapshots, {
    title: 'Hardware Breakpoint & Watchpoint Trace',
    rootCause: 'Counter variable exceeded threshold',
  })

  assert.equal(story.title, 'Hardware Breakpoint & Watchpoint Trace')
  assert.equal(story.steps.length, 8)
  assert.equal(story.summary.totalSteps, 8)

  // Verify step titles map accurately to Chinese canonical titles
  assert.equal(story.steps[0].title, '调试会话正在启动')
  assert.equal(story.steps[1].title, '调试会话已就绪')
  assert.equal(story.steps[2].title, '目标继续运行')
  assert.equal(story.steps[3].title, '命中断点')
  assert.equal(story.steps[4].title, '单步完成')
  assert.equal(story.steps[5].title, '观察点触发')
  assert.equal(story.steps[6].title, '诊断快照')
  assert.equal(story.steps[7].title, '会话结束')

  // Verify sourceRef is captured for breakpoint
  assert.equal(story.steps[3].sourceRef, 'Core/Src/main.c:42')

  // Verify snapshotId is captured for snapshot step
  assert.equal(story.steps[6].snapshotId, 'snap-1')
})
