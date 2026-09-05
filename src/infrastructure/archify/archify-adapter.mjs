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
    let desc = ''
    let cause = ''

    if (ev.type === 'session-started') {
      desc = `调试会话已启动 (后端: ${ev.backend})`
    } else if (ev.type === 'target-paused') {
      const reason = p.reason || 'manual'
      const loc = p.location ? `${p.location.file}:${p.location.line}` : '未知位置'
      desc = `目标暂停: ${reason} @ ${loc}`
      if (reason === 'watchpoint-hit') {
        cause = `变量写入触发观察点: ${p.watchpointExpression || 'expression'}`
      } else if (reason === 'breakpoint-hit') {
        cause = `命中断点 @ ${loc}`
      }
    } else if (ev.type === 'target-resumed') {
      desc = '目标继续运行'
    } else if (ev.type === 'snapshot-created') {
      const snap = snapMap.get(p.snapshotId)
      desc = `诊断快照已捕获: [${p.snapshotId}] (${snap?.reason || p.reason || 'manual'})`
      cause = snap?.reason || '手动或自动触发'
    } else {
      desc = `事件: ${ev.type}`
    }

    steps.push({
      stepIndex: index++,
      timestamp: ev.timestamp,
      kind: ev.type,
      location: p.location || undefined,
      description: desc,
      cause: cause || undefined,
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
    if (sortedEvents[i].type === 'target-paused') {
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
 *
 * @param {import('../../types/program.d.ts').ProgramModel} beforeModel
 * @param {import('../../types/program.d.ts').ProgramModel} afterModel
 * @param {{ includeDetails?: boolean }} [options]
 * @returns {import('../../types/archify.d.ts').ProgramDelta}
 */
export function programDeltaToArchify(beforeModel, afterModel, options = {}) {
  const beforeFnMap = new Map((beforeModel.functions || []).map((f) => [f.name, f]))
  const afterFnMap = new Map((afterModel.functions || []).map((f) => [f.name, f]))

  const addedFunctions = []
  const removedFunctions = []
  const modifiedFunctions = []

  for (const [name, fn] of afterFnMap.entries()) {
    if (!beforeFnMap.has(name)) {
      addedFunctions.push(fn)
    } else {
      const oldFn = beforeFnMap.get(name)
      if (oldFn && (oldFn.line !== fn.line || oldFn.endLine !== fn.endLine || oldFn.fileId !== fn.fileId)) {
        modifiedFunctions.push({
          id: fn.id,
          name,
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

  for (const [name, fn] of beforeFnMap.entries()) {
    if (!afterFnMap.has(name)) {
      removedFunctions.push(fn)
    }
  }

  // Variables delta
  const beforeVarMap = new Map((beforeModel.variables || []).map((v) => [v.name, v]))
  const afterVarMap = new Map((afterModel.variables || []).map((v) => [v.name, v]))

  const addedVariables = []
  const removedVariables = []

  for (const [name, v] of afterVarMap.entries()) {
    if (!beforeVarMap.has(name)) addedVariables.push(v)
  }
  for (const [name, v] of beforeVarMap.entries()) {
    if (!afterVarMap.has(name)) removedVariables.push(v)
  }

  // Call edges delta
  const beforeCallIds = new Set((beforeModel.callEdges || []).map((c) => `${c.callerId}->${c.calleeName}`))
  const afterCallIds = new Set((afterModel.callEdges || []).map((c) => `${c.callerId}->${c.calleeName}`))

  const addedCalls = (afterModel.callEdges || []).filter((c) => !beforeCallIds.has(`${c.callerId}->${c.calleeName}`))
  const removedCalls = (beforeModel.callEdges || []).filter((c) => !afterCallIds.has(`${c.callerId}->${c.calleeName}`))

  // Data edges delta
  const beforeDataIds = new Set(
    [...(beforeModel.writeEdges || []), ...(beforeModel.readEdges || [])].map(
      (d) => `${d.kind}:${d.accessorId}->${d.variableName}`,
    ),
  )
  const afterDataList = [...(afterModel.writeEdges || []), ...(afterModel.readEdges || [])]
  const afterDataIds = new Set(afterDataList.map((d) => `${d.kind}:${d.accessorId}->${d.variableName}`))

  const addedDataEdges = afterDataList.filter((d) => !beforeDataIds.has(`${d.kind}:${d.accessorId}->${d.variableName}`))
  const removedDataEdges = [...(beforeModel.writeEdges || []), ...(beforeModel.readEdges || [])].filter(
    (d) => !afterDataIds.has(`${d.kind}:${d.accessorId}->${d.variableName}`),
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
