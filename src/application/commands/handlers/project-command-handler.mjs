// @ts-check
import { connLabel } from '../../../domain/modbus/connection-model.mjs'
import { isScopePartitioned } from '../../../domain/modbus/config-scope.mjs'
import { ERROR_CODES } from '../../../domain/modbus/errors.mjs'
import { normalizeModbus } from '../../../domain/modbus/modbus-migration.mjs'
import { loadSessionViewForRead } from '../../modbus/workspace-session-view.mjs'
import {
  filterAlarmStateForSession,
  filterTasksForSession,
  projectVisiblePolling,
  redactAgentStatusLog,
} from '../../modbus/agent-runtime-visibility.mjs'
import { listWorkspaceDir as listDir } from '../../../infrastructure/files/project-fs.mjs'
import { keilMap } from '../../keil/project-service.mjs'
import { keilBuild } from '../../keil/build-service.mjs'
import { buildEvidenceRefs } from '../../modbus/index.mjs'
import { requireKeilProject } from '../../../shared/workspace-paths.mjs'
import { decodeValue } from '../../../domain/modbus/point-math.mjs'
import { pointRuntimeStatus } from '../../../domain/modbus/point-model.mjs'
import { listConnectionStates } from '../../../infrastructure/modbus/serial-monitor.mjs'
import { journalView } from '../../../infrastructure/store/journal-store.mjs'
import { loadWorkspace, saveWorkspaceAsync } from '../../../infrastructure/store/workspace-store.mjs'

/**
 * @param {any} src
 * @returns {object}
 */
export const compactProjectMap = (src) => {
  const details = src && typeof src === 'object' ? src : {}
  const groups = Array.isArray(details.groups) ? details.groups : []
  return {
    project: details.project || '',
    target: details.target || '',
    defines: Array.isArray(details.defines) ? details.defines.slice(0, 80) : [],
    includes: (Array.isArray(details.includes) ? details.includes : []).slice(0, 80).map((/** @type {any} */ item) => ({
      path: item?.path ? item.path : '',
      exists: !!item?.exists,
      inside: !!item?.inside,
    })),
    groups: groups.map((/** @type {any} */ group) => ({
      name: group?.name ? group.name : '',
      files: (group && Array.isArray(group.files) ? group.files : []).map((/** @type {any} */ file) => ({
        name: file?.name ? file.name : '',
        kind: file?.kind ? file.kind : 'other',
        rel: file?.rel ? file.rel : '',
        exists: !!file?.exists,
        readable: !!file?.readable,
        inside: !!file?.inside,
        functions: (file && Array.isArray(file.functions) ? file.functions : [])
          .slice(0, 40)
          .map((/** @type {any} */ fn) => ({
            name: fn?.name ? fn.name : '',
            line: fn?.line ? fn.line : 0,
          })),
      })),
    })),
    include_edges: (Array.isArray(details.include_edges) ? details.include_edges : [])
      .slice(0, 200)
      .map((/** @type {any} */ edge) => ({
        from: edge?.from ? edge.from : '',
        name: edge?.name ? edge.name : '',
        to: edge?.to ? edge.to : '',
        resolved: !!edge?.resolved,
      })),
    truncated: details.truncated && typeof details.truncated === 'object' ? details.truncated : {},
    limits: details.limits && typeof details.limits === 'object' ? details.limits : {},
    counts: details.counts && typeof details.counts === 'object' ? details.counts : {},
  }
}

/**
 * @param {any} log
 * @returns {object[]}
 */
export const compactLog = (log) => {
  if (!Array.isArray(log)) return []
  return log.slice(0, 8).map((item) => ({
    at: item.at,
    ok: item.ok,
    action: item.action,
    summary: item.summary,
  }))
}

/**
 * @param {any} home
 * @param {any} args
 * @param {any} room
 * @param {any} origin
 * @param {any} opts
 * @returns {Promise<object | null>}
 */
export async function handleProjectCommand(home, args, room, origin, opts) {
  const action = args?.action
  const signal = opts?.signal

  if (action === 'status') {
    const sessionId = typeof origin.sessionId === 'string' ? origin.sessionId : ''
    /** @type {any} */
    let workspace
    /** @type {any} */
    let pack
    if (sessionId) {
      const view = loadSessionViewForRead(home, room.cwd, sessionId)
      workspace = view.workspace
      pack = view.pack
    } else {
      workspace = loadWorkspace(home, room.cwd)
      if (isScopePartitioned(workspace.modbus)) {
        return {
          ok: false,
          action,
          errorCode: ERROR_CODES.SESSION_REQUIRED,
          error: '该工作区已按会话隔离，status 必须携带 sessionId',
        }
      }
      pack = normalizeModbus(workspace.modbus)
    }
    const journal = journalView(workspace)
    const configVersion = pack.configVersion || 1
    const states = await listConnectionStates(home, room.cwd, opts)
    const connectionStates = states?.connectionStates || []
    const stateByConn = new Map(connectionStates.map((s) => [s.connectionId, s.status || '']))
    const layered = workspace.modbus
    const visiblePolling = projectVisiblePolling(
      layered,
      sessionId,
      pack.connections,
      pack.pollingByConnection,
    )
    const visibleAlarms = filterAlarmStateForSession(layered, sessionId, pack, pack.alarmState)
    const isAgent = origin?.source === 'agent'
    const scopedTasks = sessionId ? filterTasksForSession(journal.tasks, sessionId) : journal.tasks
    const scopedRunning = sessionId ? filterTasksForSession(journal.running, sessionId) : journal.running
    const logView = isAgent
      ? redactAgentStatusLog(compactLog(workspace.log))
      : { log: compactLog(workspace.log), logHiddenCount: 0 }
    return {
      ok: true,
      action,
      cwd: room.cwd,
      configVersion,
      session: {
        autoService: true,
        sessionId: sessionId || workspace.session?.boundId || '',
      },
      keil: workspace.keil,
      modbus: {
        version: pack.version,
        connections: pack.connections,
        devices: pack.devices,
        connectionStates,
        points: (pack.points || []).map((/** @type {any} */ p) => {
          const rec = (pack.values || []).find((/** @type {any} */ item) => item.key === p.id || item.pointId === p.id)
          return {
            id: p.id,
            connectionId: p.connectionId,
            connId: p.connectionId,
            deviceId: p.deviceId,
            name: p.name,
            area: p.area,
            function: p.function,
            address: p.address,
            scale: p.scale,
            offset: p.offset,
            unit: p.unit,
            alarmMin: p.alarmMin,
            alarmMax: p.alarmMax,
            alarmDeadband: p.alarmDeadband == null ? null : p.alarmDeadband,
            monitorEnabled: p.monitorEnabled === true,
            alarmEnabled: p.alarmEnabled === true,
            trendEnabled: p.monitorEnabled === true,
            writable: [1, 3].includes(p.function),
            raw: rec ? rec.raw : null,
            value: rec ? decodeValue(p, rec.raw) : null,
            ok: rec ? rec.ok : false,
            at: rec ? rec.at : 0,
            runtimeStatus: pointRuntimeStatus(p, rec, visibleAlarms, stateByConn.get(p.connectionId) || '').label,
          }
        }),
        values: pack.values,
        activeConnectionId: pack.activeConnectionId,
        activeDeviceId: pack.activeDeviceId,
        pollingByConnection: visiblePolling,
        framesByConnection: pack.framesByConnection,
        polling: pack.polling,
        alarmState: visibleAlarms,
        alarmActive: visibleAlarms,
        conn: {
          mode: pack.conn.mode,
          port: pack.conn.port,
          baudrate: pack.conn.baudrate,
          bytesize: pack.conn.bytesize,
          parity: pack.conn.parity,
          stopbits: pack.conn.stopbits,
          host: pack.conn.host,
          tcpPort: pack.conn.tcpPort,
          sim: pack.conn.sim,
          label: connLabel(pack.conn),
        },
        configVersion,
      },
      focus: workspace.focus || { request: null, prev: null, tempWatchIds: [], badgeOnly: false, evidence: [] },
      evidence: buildEvidenceRefs(home, room.cwd),
      log: logView.log,
      logHiddenCount: logView.logHiddenCount,
      tasks: scopedTasks,
      running: scopedRunning,
      timeline: journal.timeline,
    }
  }

  if (action === 'ls') {
    return { ok: true, action, .../** @type {object} */ (await Promise.resolve(listDir(room.cwd, args.path))) }
  }

  if (action === 'select') {
    const keil = /** @type {any} */ (
      requireKeilProject(room.cwd, typeof args.path === 'string' ? args.path.trim() : '')
    )
    if (keil.error) return { ok: false, action, error: keil.error }
    const saved = await saveWorkspaceAsync(home, room.cwd, {
      keil: { project: keil.project, target: typeof args.target === 'string' ? args.target : '' },
      origin,
    })
    if (!saved.ok) return { ok: false, action, error: saved.error }
    return { ok: true, action, keil: saved.workspace.keil, source: origin.source }
  }

  if (action === 'map') {
    const ran = await keilMap(home, room.cwd, args.path, args.target, { signal })
    if (!ran.ok) return { action, ...ran }
    return { ok: true, action, map: compactProjectMap(/** @type {any} */ (ran).result?.details) }
  }

  if (action === 'build') {
    const ran = await keilBuild(
      home,
      room.cwd,
      {
        project: args.path,
        target: args.target,
        artifact: args.artifact,
        source: origin.source,
        sessionId: origin.sessionId,
      },
      { signal },
    )
    return { action, ...ran }
  }

  return null
}
