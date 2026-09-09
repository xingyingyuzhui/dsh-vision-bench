import {
  buildInputBridge,
  formatErrorMessage,
  pageSessionId,
  readInputDraft,
  runningOf,
  statusBar,
  useSessionCwd,
  visionCollabBar,
} from '../../../bench-shared.mjs'
import { getCustomSelect } from '../components/custom-select.mjs'
import { renderConnectionEditor } from './connection-editor.mjs'
import { renderConnectionOverview } from './connection-overview.mjs'
import { renderConnectionPanel } from './connection-panel.mjs'
import { renderConnectionTabs } from './connection-tabs.mjs'
import { renderConnectionWorkspace } from './connection-workspace.mjs'
import { renderDeviceEditor } from './device-editor.mjs'
import { renderDeviceSection } from './device-section.mjs'
import { createHmiCommandClient } from './hmi-command-client.mjs'
import { renderField, renderFocusToast, renderPendingPanel } from './hmi-controller.mjs'
import { createHmiActions } from './hmi-page-actions.mjs'
import { useAgentFocus } from './hooks/use-agent-focus.mjs'
import { useConnections } from './hooks/use-connections.mjs'
import { useHmiState } from './hooks/use-hmi-state.mjs'
import { usePendingWrites } from './hooks/use-pending-writes.mjs'
import { usePoints } from './hooks/use-points.mjs'

export function createHmiView(React, t, post) {
  const CustomSelect = getCustomSelect(React)
  return function HmiView(props) {
    const el = React.createElement
    const cwd = useSessionCwd(React, props)
    const sessionId = pageSessionId(props) || props?.sessionId || ''
    const inputDraft = readInputDraft(props?.useInput)
    const agentBridge = buildInputBridge(props, inputDraft)
    const [busy, setBusy] = React.useState('')
    const [error, setErrorRaw] = React.useState('')
    const [modal, setModal] = React.useState(null)
    const setError = (err) => {
      const formatted = formatErrorMessage(err)
      setErrorRaw(formatted)
      if (formatted) {
        setModal({
          open: true,
          kind: 'err',
          title: '操作提示',
          message: formatted,
          onClose: () => {
            setModal(null)
            setErrorRaw('')
          },
        })
      } else {
        setModal(null)
      }
    }
    const [ports, setPorts] = React.useState([])
    const [scanning, setScanning] = React.useState(false)
    const [frameFilter, setFrameFilter] = React.useState('all')
    const {
      health,
      ioRuntime,
      workspace,
      setWorkspace,
      journal,
      setJournal,
      pending,
      setPending,
      connectionStates,
      setConnectionStates,
      workspaceRef,
      inflight,
      flagInflight,
    } = useHmiState(React, post, cwd, sessionId)
    const {
      connForm,
      setConnForm,
      hmiTab,
      setHmiTab,
      moreOpen,
      setMoreOpen,
      pendingDeleteId,
      setPendingDeleteId,
      linkBusy,
      setLinkBusy,
      lastDeviceByConn,
      connColWidths,
      onStartConnResize,
      resetConnColWidth,
      totalConnTableWidth,
    } = useConnections(React, cwd)
    const {
      editingDeviceId,
      setEditingDeviceId,
      editingPointsDeviceId,
      setEditingPointsDeviceId,
      deviceDraft,
      setDeviceDraft,
      pointDraftsById,
      setPointDraftsById,
      newPointDraft,
      setNewPointDraft,
      inlineWrite,
      setInlineWrite,
      batch,
      setBatch,
      devForm,
      setDevForm,
      devDeleteId,
      setDevDeleteId,
      csvText,
      setCsvText,
      csvTarget,
      setCsvTarget,
      csvNote,
      setCsvNote,
      flagSavingByPoint,
      setFlagSavingByPoint,
      flagRequestSeq,
      colWidths,
      getColWidths,
      onStartResize,
      resetColWidth,
      totalTableWidth,
    } = usePoints(React, cwd, hmiTab)
    const { focusState, setFocusUi, agentCopied, setAgentCopied, tempWatchNote, setTempWatchNote } = useAgentFocus(
      React,
      cwd,
      workspace.focus,
      sessionId,
    )
    const { resolveWrite } = usePendingWrites(
      React,
      post,
      cwd,
      sessionId,
      setPending,
      setJournal,
      setWorkspace,
      setError,
      t,
    )
    const commandClient = createHmiCommandClient(post, cwd, sessionId)
    void health
    void tempWatchNote
    void frameFilter

    const field = (label, control) => renderField(el, t, { label, control })
    const actions = createHmiActions({
      React,
      el,
      t,
      post,
      cwd,
      sessionId,
      props,
      agentBridge,
      commandClient,
      setBusy,
      setError,
      setPorts,
      setScanning,
      setFrameFilter,
      ioRuntime,
      setWorkspace,
      setJournal,
      setPending,
      setConnectionStates,
      workspaceRef,
      inflight,
      flagInflight,
      editingPointsDeviceId,
      setEditingDeviceId,
      setEditingPointsDeviceId,
      deviceDraft,
      setDeviceDraft,
      pointDraftsById,
      setPointDraftsById,
      newPointDraft,
      setNewPointDraft,
      inlineWrite,
      setInlineWrite,
      batch,
      setBatch,
      devForm,
      setDevForm,
      setDevDeleteId,
      csvText,
      setCsvText,
      csvTarget,
      setCsvTarget,
      setCsvNote,
      flagSavingByPoint,
      setFlagSavingByPoint,
      flagRequestSeq,
      connForm,
      setConnForm,
      setHmiTab,
      setMoreOpen,
      pendingDeleteId,
      setPendingDeleteId,
      setLinkBusy,
      lastDeviceByConn,
      focusState,
      agentCopied,
      setAgentCopied,
      setTempWatchNote,
    })

    React.useEffect(() => {
      actions.scanPorts()
    }, [cwd])

    React.useEffect(() => {
      if (!cwd || !focusState.request || focusState.badgeOnly) return
      const r = focusState.request
      const pack = actions.normalizePack()
      if (r.connectionId && r.connectionId !== pack.activeConnectionId) {
        if (pack.connections.some((c) => c.id === r.connectionId)) actions.selectConnection(r.connectionId)
      } else if (r.deviceId && r.deviceId !== pack.activeDeviceId) {
        if (
          pack.devices.some(
            (d) => d.id === r.deviceId && d.connectionId === (r.connectionId || pack.activeConnectionId),
          )
        ) {
          actions.persist({ activeDeviceId: r.deviceId, version: 3 })
        }
      }
      if (r.pointId || r.frameId) setFrameFilter(r.connectionId || pack.activeConnectionId || 'all')
    }, [
      cwd,
      focusState.request?.connectionId,
      focusState.request?.deviceId,
      focusState.request?.pointId,
      focusState.request?.frameId,
      focusState.badgeOnly,
    ])

    const d = actions.derived()
    React.useEffect(() => {
      if (hmiTab !== 'all' && d.connections.length > 0 && !d.connections.some((c) => c.id === hmiTab)) {
        setHmiTab('all')
      }
    }, [hmiTab, d.connections, setHmiTab])
    const focusToast = renderFocusToast(el, t, {
      focusState,
      returnToPrevFocus: actions.returnToPrevFocus,
      setFocusUi,
    })
    const connListPanel = renderConnectionPanel(el, t, {
      focusState,
      connections: d.connections,
      cwd,
      addConnection: actions.addConnection,
      activeConnObj: d.activeConnObj,
      sim: d.sim,
      activeConnId: d.activeConnId,
      toggleSim: actions.toggleSim,
      watchEnabled: d.watchEnabled,
      linkBusy,
      points: d.points,
      toggleCollection: actions.toggleCollection,
      polling: d.polling,
      setPollingInterval: actions.setPollingInterval,
      canDevice: d.canDevice,
      connectionStates,
      selectConnection: actions.selectConnection,
      findRtuOccupier: actions.findRtuOccupier,
      linkConnection: actions.linkConnection,
      unlinkConnection: actions.unlinkConnection,
      openConnEdit: actions.openConnEdit,
      sendToAgent: actions.sendToAgent,
      pendingDeleteId,
      setPendingDeleteId,
      requestDeleteConnection: actions.requestDeleteConnection,
      connColWidths,
      onStartConnResize,
      resetConnColWidth,
      totalConnTableWidth,
    })
    const connFormPanel = renderConnectionEditor(el, t, {
      connForm,
      setConnForm,
      connectionStates,
      field,
      scanning,
      ports,
      findRtuOccupier: actions.findRtuOccupier,
      findTcpOccupier: actions.findTcpOccupier,
      scanPorts: actions.scanPorts,
      cwd,
      saveConnEdit: actions.saveConnEdit,
      React,
    })
    const devFormPanel = renderDeviceEditor(el, t, {
      field,
      devForm,
      setDevForm,
      activeConnId: d.activeConnId,
      activeConnObj: d.activeConnObj,
      cwd,
      saveDeviceForm: actions.saveDeviceForm,
    })
    const pointRowCtx = {
      valueMap: d.valueMap,
      focusState,
      editingPointsDeviceId,
      pointDraftsById,
      inlineWrite,
      setInlineWrite,
      submitWriteCell: actions.submitWriteCell,
      openWriteCell: actions.openWriteCell,
      busy,
      writeRunning: runningOf(journal, 'write'),
      patchDraft: actions.patchDraft,
      sendToAgent: actions.sendToAgent,
      flagSavingByPoint,
      persistPointFlags: actions.persistPointFlags,
      removePointRow: actions.removePointRow,
      CustomSelect,
    }
    const deviceCardsPanel = renderDeviceSection(el, t, {
      CustomSelect,
      activeConnObj: d.activeConnObj,
      activeDevices: d.activeDevices,
      points: d.points,
      cwd,
      activeConnId: d.activeConnId,
      openAddDevice: actions.openAddDevice,
      pointsOfDevice: actions.pointsOfDevice,
      busy,
      devDeleteId,
      setDevDeleteId,
      editingDeviceId,
      editingPointsDeviceId,
      pointDraftsById,
      newPointDraft,
      setNewPointDraft,
      batch,
      setBatch,
      csvTarget,
      setCsvTarget,
      csvNote,
      connectionStates,
      valueMap: d.valueMap,
      alarmStateData: d.alarmStateData,
      focusState,
      deviceDraft,
      setDeviceDraft,
      saveDeviceEdit: actions.saveDeviceEdit,
      cancelDeviceEdit: actions.cancelDeviceEdit,
      requestDeleteDevice: actions.requestDeleteDevice,
      enterDeviceEdit: actions.enterDeviceEdit,
      savePointsEdit: actions.savePointsEdit,
      cancelPointsEdit: actions.cancelPointsEdit,
      addNewPointRow: actions.addNewPointRow,
      canDevice: d.canDevice,
      connMissing: d.connMissing,
      linkConnection: actions.linkConnection,
      unlinkConnection: actions.unlinkConnection,
      linkBusy,
      readRunning: runningOf(journal, 'read'),
      readAll: actions.readAll,
      enterPointsEdit: actions.enterPointsEdit,
      exportCsv: actions.exportCsv,
      sendToAgent: actions.sendToAgent,
      confirmDeleteDevice: actions.confirmDeleteDevice,
      field,
      generateBatch: actions.generateBatch,
      importCsv: actions.importCsv,
      csvText,
      setCsvText,
      saveNewPointDraft: actions.saveNewPointDraft,
      pointRowCtx,
      colWidths,
      getColWidths,
      onStartResize,
      resetColWidth,
      totalTableWidth,
    })
    const pendingPanel = renderPendingPanel(el, t, { pending, resolveWrite })
    const tabBar = renderConnectionTabs(el, t, {
      pack: d.pack,
      pending,
      journal,
      activeConnId: d.activeConnId,
      connections: d.connections,
      connectionStates,
      hmiTab,
      setHmiTab,
      moreOpen,
      setMoreOpen,
      selectConnection: actions.selectConnection,
      findRtuOccupier: actions.findRtuOccupier,
      findTcpOccupier: actions.findTcpOccupier,
      cwd,
      addConnection: actions.addConnection,
    })
    const pageCtx = {
      cwd,
      sessionId,
      workspace,
      journal,
      pending,
      error,
      setError,
      modal,
      setModal,
      agentCopied,
      ioStatus: d.ioStatus,
      tabBar,
      focusToast,
      connListPanel,
      connFormPanel,
      devFormPanel,
      deviceCardsPanel,
      pendingPanel,
      statusBar,
      visionCollabBar,
    }
    if (hmiTab === 'all') return renderConnectionOverview(el, t, pageCtx)
    return renderConnectionWorkspace(el, t, pageCtx)
  }
}
