// @ts-check

/**
 * Converts a canonical ProgramModel into an Archify-compatible IR data structure.
 *
 * @param {import('../../types/program.d.ts').ProgramModel} model
 * @param {{ includeDataEdges?: boolean, includeFiles?: boolean }} [options]
 * @returns {import('../../types/archify.d.ts').ArchifyGraphIR}
 */
export function programModelToArchify(model, options = {}) {
  const includeData = options.includeDataEdges !== false
  const includeFiles = options.includeFiles !== false

  /** @type {import('../../types/archify.d.ts').ArchifyNode[]} */
  const nodes = []
  /** @type {import('../../types/archify.d.ts').ArchifyEdge[]} */
  const edges = []
  /** @type {import('../../types/archify.d.ts').ArchifyGroup[]} */
  const groups = []

  // Map file groups
  const nodesByFile = new Map()
  for (const f of model.files || []) {
    nodesByFile.set(f.id, [])
    if (includeFiles) {
      nodes.push({
        id: f.id,
        label: f.name,
        kind: 'file',
        file: f.rel,
        properties: { group: f.group, kind: f.kind },
      })
    }
  }

  // Function nodes
  for (const fn of model.functions || []) {
    nodes.push({
      id: fn.id,
      label: fn.name,
      kind: 'function',
      file: fn.fileId.replace(/^file:/, ''),
      line: fn.line,
      properties: {
        isStatic: Boolean(fn.isStatic),
        isInterrupt: Boolean(fn.isInterrupt),
        endLine: fn.endLine,
      },
    })
    const list = nodesByFile.get(fn.fileId) || []
    list.push(fn.id)
    nodesByFile.set(fn.fileId, list)
  }

  // Variable nodes
  if (includeData) {
    for (const v of model.variables || []) {
      nodes.push({
        id: v.id,
        label: v.name,
        kind: 'variable',
        file: v.fileId ? v.fileId.replace(/^file:/, '') : undefined,
        line: v.line,
        properties: {
          scope: v.scope,
          type: v.type,
          isStatic: Boolean(v.isStatic),
          isVolatile: Boolean(v.isVolatile),
        },
      })
      if (v.fileId && nodesByFile.has(v.fileId)) {
        nodesByFile.get(v.fileId).push(v.id)
      }
    }
  }

  // Create groups from files
  for (const [fileId, memberNodeIds] of nodesByFile.entries()) {
    const fileObj = model.files?.find((f) => f.id === fileId)
    groups.push({
      id: `group:${fileId}`,
      label: fileObj?.name || fileId.replace(/^file:/, ''),
      memberNodeIds,
    })
  }

  // Call edges
  for (const call of model.callEdges || []) {
    if (call.callerId && call.calleeId) {
      edges.push({
        id: call.id,
        from: call.callerId,
        to: call.calleeId,
        kind: 'call',
        confidence: call.confidence,
        metadata: { location: call.location },
      })
    }
  }

  // Data edges
  if (includeData) {
    for (const write of model.writeEdges || []) {
      if (write.accessorId && write.variableId) {
        edges.push({
          id: write.id,
          from: write.accessorId,
          to: write.variableId,
          kind: 'write',
          confidence: write.confidence,
          metadata: { location: write.location },
        })
      }
    }
    for (const read of model.readEdges || []) {
      if (read.accessorId && read.variableId) {
        edges.push({
          id: read.id,
          from: read.accessorId,
          to: read.variableId,
          kind: 'read',
          confidence: read.confidence,
          metadata: { location: read.location },
        })
      }
    }
  }

  return {
    version: '1.0.0',
    nodes,
    edges,
    groups,
    metadata: {
      project: model.project,
      target: model.target,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      generatedAt: Date.now(),
    },
  }
}
export { findCausalPath, findDownstream, findUpstream } from '../../domain/program/graph-analysis.mjs'

import { DEBUG_EVENT_TYPES } from '../../shared/debug-events.mjs'

/** @type {Record<string, string>} */
const CANONICAL_EVENT_TITLES = {
  [DEBUG_EVENT_TYPES.SESSION_STARTING]: '调试会话正在启动',
  [DEBUG_EVENT_TYPES.SESSION_READY]: '调试会话已就绪',
  [DEBUG_EVENT_TYPES.RUNNING]: '目标继续运行',
  [DEBUG_EVENT_TYPES.PAUSED]: '目标暂停',
  [DEBUG_EVENT_TYPES.STEP_COMPLETE]: '单步完成',
  [DEBUG_EVENT_TYPES.BREAKPOINT_HIT]: '命中断点',
  [DEBUG_EVENT_TYPES.WATCHPOINT_HIT]: '观察点触发',
  [DEBUG_EVENT_TYPES.EXCEPTION]: '调试异常',
  [DEBUG_EVENT_TYPES.SNAPSHOT_CREATED]: '诊断快照',
  [DEBUG_EVENT_TYPES.SESSION_FAILED]: '会话失败',
  [DEBUG_EVENT_TYPES.SESSION_STOPPED]: '会话结束',
}

/**
 * Synthesizes a chronological Guided Debug Story from debug events, snapshots, and conclusions.
 *
 * @param {Array<import('../../types/debug.d.ts').DebugEvent>} events
 * @param {Array<import('../../types/debug.d.ts').DebugSnapshot>} [snapshots]
 * @param {{ title?: string, rootCause?: string }} [options]
 * @returns {import('../../types/archify.d.ts').DebugStory}
 */
export function debugStoryToArchify(events, snapshots = [], options = {}) {
  const steps = []
  const sortedEvents = [...(events || [])].sort((a, b) => a.timestamp - b.timestamp)
  const snapMap = new Map((snapshots || []).map((s) => [s.id, s]))

  let index = 1
  for (const ev of sortedEvents) {
    const p = ev.payload || {}
    let type = ev.type
    if (type === 'session-started') type = DEBUG_EVENT_TYPES.SESSION_READY
    else if (type === 'target-paused') type = DEBUG_EVENT_TYPES.PAUSED
    else if (type === 'target-resumed') type = DEBUG_EVENT_TYPES.RUNNING
    else if (type === 'snapshot-created') type = DEBUG_EVENT_TYPES.SNAPSHOT_CREATED

    const title = CANONICAL_EVENT_TITLES[type] || CANONICAL_EVENT_TITLES[ev.type] || `事件: ${ev.type}`
    let desc = ''
    let cause = ''

    if (ev.type === 'session-started') {
      desc = `调试会话已启动 (后端: ${ev.backend})`
    } else if (type === DEBUG_EVENT_TYPES.SESSION_STARTING) {
      desc = `调试会话正在启动 (后端: ${ev.backend})`
    } else if (type === DEBUG_EVENT_TYPES.SESSION_READY) {
      desc = `调试会话已就绪 (后端: ${ev.backend || 'unknown'})`
    } else if (type === DEBUG_EVENT_TYPES.RUNNING) {
      desc = '目标继续运行'
    } else if (type === DEBUG_EVENT_TYPES.PAUSED) {
      const reason = p.reason || 'manual'
      const loc = p.location ? `${p.location.file}:${p.location.line}` : '未知位置'
      desc = `目标暂停: ${reason} @ ${loc}`
      if (reason === 'watchpoint-hit' || reason === 'watchpoint') {
        cause = `变量写入触发观察点: ${p.watchpointExpression || p.watchpointId || 'expression'}`
      } else if (reason === 'breakpoint-hit' || reason === 'breakpoint') {
        cause = `命中断点 @ ${loc}`
      }
    } else if (type === DEBUG_EVENT_TYPES.STEP_COMPLETE) {
      const loc = p.location ? `${p.location.file}:${p.location.line}` : ''
      desc = `单步完成${loc ? ` @ ${loc}` : ''}`
    } else if (type === DEBUG_EVENT_TYPES.BREAKPOINT_HIT) {
      const loc = p.location ? `${p.location.file}:${p.location.line}` : '未知位置'
      desc = `命中断点 #${p.breakpointId || ''} @ ${loc}`
      cause = '执行到达断点位置'
    } else if (type === DEBUG_EVENT_TYPES.WATCHPOINT_HIT) {
      const loc = p.location ? `${p.location.file}:${p.location.line}` : '未知位置'
      desc = `观察点触发 #${p.watchpointId || ''} @ ${loc}`
      cause = '变量值发生变更'
    } else if (type === DEBUG_EVENT_TYPES.SNAPSHOT_CREATED || ev.type === 'snapshot-created') {
      const snap = snapMap.get(p.snapshotId)
      desc = `诊断快照已捕获: [${p.snapshotId}] (${snap?.reason || p.reason || 'manual'})`
      cause = snap?.reason || '手动或自动触发'
    } else if (type === DEBUG_EVENT_TYPES.EXCEPTION) {
      desc = `调试异常: ${p.message || p.signal || '未知异常'}`
      cause = p.message || '程序异常'
    } else if (type === DEBUG_EVENT_TYPES.SESSION_FAILED) {
      desc = `会话失败: ${p.error || p.message || '启动或运行错误'}`
      cause = p.error || '会话异常'
    } else if (type === DEBUG_EVENT_TYPES.SESSION_STOPPED) {
      desc = `会话结束: ${p.reason || '正常结束'}`
    } else {
      desc = `事件: ${ev.type}`
    }

    const loc = p.location || undefined
    const sourceRef = loc ? `${loc.file}:${loc.line}` : undefined

    steps.push({
      stepIndex: index++,
      timestamp: ev.timestamp,
      kind: type,
      title,
      description: desc,
      cause: cause || undefined,
      sourceRef,
      programNodeId: p.programNodeId || p.functionId || undefined,
      snapshotId: p.snapshotId || undefined,
      evidence: p,
    })
  }

  // Generate narrative string
  const narrativeLines = steps.map((s) => `步骤 ${s.stepIndex}: ${s.description}${s.cause ? ` (${s.cause})` : ''}`)
  if (options.rootCause) {
    narrativeLines.push(`根本原因分析: ${options.rootCause}`)
  }

  const firstTs = sortedEvents[0]?.timestamp || 0
  const lastTs = sortedEvents[sortedEvents.length - 1]?.timestamp || 0
  let lastPause = null
  for (let i = sortedEvents.length - 1; i >= 0; i--) {
    const t = sortedEvents[i].type
    if (
      t === 'target-paused' ||
      t === DEBUG_EVENT_TYPES.PAUSED ||
      t === DEBUG_EVENT_TYPES.BREAKPOINT_HIT ||
      t === DEBUG_EVENT_TYPES.WATCHPOINT_HIT
    ) {
      lastPause = sortedEvents[i]
      break
    }
  }

  return {
    title: options.title || '引导式调试故事 (Debug Story)',
    rootCause: options.rootCause || undefined,
    steps,
    narrative: narrativeLines.join('\n'),
    summary: {
      totalSteps: steps.length,
      durationMs: lastTs && firstTs ? Math.max(0, lastTs - firstTs) : 0,
      stoppedReason: lastPause?.payload?.reason || undefined,
    },
  }
}

/**
 * Calculates a structured ProgramDelta between before and after ProgramModel states.
 * Uses fn.id, variable.id, and edge.id to guarantee accurate cross-file identity.
 *
 * @param {import('../../types/program.d.ts').ProgramModel} beforeModel
 * @param {import('../../types/program.d.ts').ProgramModel} afterModel
 * @param {{ includeDetails?: boolean }} [options]
 * @returns {import('../../types/archify.d.ts').ProgramDelta}
 */
export function programDeltaToArchify(beforeModel, afterModel, options = {}) {
  const beforeFnMap = new Map((beforeModel.functions || []).map((f) => [f.id, f]))
  const afterFnMap = new Map((afterModel.functions || []).map((f) => [f.id, f]))

  const addedFunctions = []
  const removedFunctions = []
  const modifiedFunctions = []

  for (const [id, fn] of afterFnMap.entries()) {
    if (!beforeFnMap.has(id)) {
      addedFunctions.push(fn)
    } else {
      const oldFn = beforeFnMap.get(id)
      if (oldFn && (oldFn.line !== fn.line || oldFn.endLine !== fn.endLine || oldFn.fileId !== fn.fileId)) {
        modifiedFunctions.push({
          id: fn.id,
          name: fn.name,
          changes: {
            oldLine: oldFn.line,
            newLine: fn.line,
            oldFile: oldFn.fileId,
            newFile: fn.fileId,
          },
        })
      }
    }
  }

  for (const [id, fn] of beforeFnMap.entries()) {
    if (!afterFnMap.has(id)) {
      removedFunctions.push(fn)
    }
  }

  // Variables delta by variable.id
  const beforeVarMap = new Map((beforeModel.variables || []).map((v) => [v.id, v]))
  const afterVarMap = new Map((afterModel.variables || []).map((v) => [v.id, v]))

  const addedVariables = []
  const removedVariables = []

  for (const [id, v] of afterVarMap.entries()) {
    if (!beforeVarMap.has(id)) addedVariables.push(v)
  }
  for (const [id, v] of beforeVarMap.entries()) {
    if (!afterVarMap.has(id)) removedVariables.push(v)
  }

  // Call edges delta by edge.id
  const beforeCallIds = new Set((beforeModel.callEdges || []).map((c) => c.id || `${c.callerId}->${c.calleeName}`))
  const afterCallIds = new Set((afterModel.callEdges || []).map((c) => c.id || `${c.callerId}->${c.calleeName}`))

  const addedCalls = (afterModel.callEdges || []).filter(
    (c) => !beforeCallIds.has(c.id || `${c.callerId}->${c.calleeName}`),
  )
  const removedCalls = (beforeModel.callEdges || []).filter(
    (c) => !afterCallIds.has(c.id || `${c.callerId}->${c.calleeName}`),
  )

  // Data edges delta by edge.id
  const beforeDataList = [...(beforeModel.writeEdges || []), ...(beforeModel.readEdges || [])]
  const afterDataList = [...(afterModel.writeEdges || []), ...(afterModel.readEdges || [])]

  const beforeDataIds = new Set(beforeDataList.map((d) => d.id || `${d.kind}:${d.accessorId}->${d.variableName}`))
  const afterDataIds = new Set(afterDataList.map((d) => d.id || `${d.kind}:${d.accessorId}->${d.variableName}`))

  const addedDataEdges = afterDataList.filter(
    (d) => !beforeDataIds.has(d.id || `${d.kind}:${d.accessorId}->${d.variableName}`),
  )
  const removedDataEdges = beforeDataList.filter(
    (d) => !afterDataIds.has(d.id || `${d.kind}:${d.accessorId}->${d.variableName}`),
  )

  return {
    addedFunctions,
    removedFunctions,
    modifiedFunctions,
    addedVariables,
    removedVariables,
    addedCalls,
    removedCalls,
    addedDataEdges,
    removedDataEdges,
    summary: {
      functionsDelta: addedFunctions.length - removedFunctions.length,
      variablesDelta: addedVariables.length - removedVariables.length,
      callsDelta: addedCalls.length - removedCalls.length,
      dataEdgesDelta: addedDataEdges.length - removedDataEdges.length,
    },
  }
}
