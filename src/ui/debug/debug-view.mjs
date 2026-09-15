import { useSessionCwd } from '../common/session-scope.mjs'
import { getCustomSelect } from '../components/custom-select.mjs'
import { createKeilBuildErrorList } from './keil/keil-build-errors.mjs'
import { createKeilLogDialog } from './keil/keil-log-dialog.mjs'
import { createKeilManualPanel } from './keil/keil-manual-panel.mjs'
import { createKeilPickerDialog } from './keil/keil-picker-dialog.mjs'
import { createDebugFlashPanel } from './debug-flash-panel.mjs'
import { createDebugOutputPanel } from './debug-output-panel.mjs'
import { createDebugProjectPanel } from './debug-project-panel.mjs'
import { useDebugBuildActions } from './use-debug-build-actions.mjs'
import { useDebugFlashActions } from './use-debug-flash-actions.mjs'
import { useDebugWorkspaceState } from './use-debug-workspace-state.mjs'

export function createDebugView(React, t, post, openProject) {
  const CustomSelect = getCustomSelect(React)
  const KeilPickerDialog = createKeilPickerDialog(React, t)
  const KeilManualPanel = createKeilManualPanel(React, t)
  const KeilLogDialog = createKeilLogDialog(React, t)
  const KeilBuildErrorList = createKeilBuildErrorList(React)
  const DebugProjectPanel = createDebugProjectPanel(React, t, CustomSelect)
  const DebugOutputPanel = createDebugOutputPanel(React, t, KeilBuildErrorList)
  const DebugFlashPanel = createDebugFlashPanel(React, t, CustomSelect)

  return function DebugView(props) {
    const el = React.createElement
    const cwd = useSessionCwd(React, props)
    const sessionId = props?.sessionId || ''

    const openocdProbeRef = React.useRef(() => {})
    const workspaceState = useDebugWorkspaceState(React, post, cwd, sessionId, {
      onOpenocdBinding(opts) {
        openocdProbeRef.current(opts)
      },
    })
    const {
      health,
      workspace,
      journal,
      setJournal,
      setKeil,
      resolveManual,
      mergeState,
      persist,
      workspaceRef,
    } = workspaceState

    const flashActions = useDebugFlashActions(React, t, post, cwd, sessionId, mergeState)
    openocdProbeRef.current = flashActions.probeOpenOcd
    const { flash, setFlash, openocdFlash, probeOpenOcd, startFlash, approveFlash, cancelFlash } = flashActions

    const buildActions = useDebugBuildActions(React, t, post, cwd, sessionId, {
      health,
      workspace,
      workspaceRef,
      journal,
      setJournal,
      setKeil,
      persist,
      openProject,
    })
    const {
      targets,
      busy,
      error,
      buildOut,
      logView,
      setLogView,
      lastResult,
      copied,
      picker,
      setPicker,
      openPicker,
      chooseProject,
      build,
      openFullLog,
      copyForAgent,
      jumpToError,
      buildErrors,
      buildBusy,
      buildLabel,
      buildBlock,
      pythonReady,
      uv4Ready,
    } = buildActions

    const openManual = (workspace.manualRequests || []).filter((item) => item.status === 'pending')

    return el(
      'div',
      { className: 'dvb-page' },
      error ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, error) : null,
      el(
        'div',
        { className: 'dvb-split' },
        el(DebugProjectPanel, {
          cwd,
          workspace,
          targets,
          busy,
          pythonReady,
          uv4Ready,
          buildBusy,
          buildLabel,
          buildBlock,
          lastResult,
          copied,
          openPicker,
          openProject,
          setKeil,
          persist,
          build,
          copyForAgent,
        }),
        el(DebugOutputPanel, {
          buildErrors,
          jumpToError,
          lastResult,
          openFullLog,
          buildOut,
        }),
      ),
      el(DebugFlashPanel, {
        cwd,
        flash,
        setFlash,
        openocdFlash,
        artifactPath: workspace.keil.download || '',
        probeOpenOcd,
        startFlash,
        approveFlash,
        cancelFlash,
      }),
      el(KeilManualPanel, { openManual, resolveManual }),
      journal?.running?.length
        ? el(
            'div',
            { className: 'dvb-hint' },
            `${t('tasks')} · 运行中 ${journal.running
              .map((r) => r.summary || r.type || r.id)
              .filter(Boolean)
              .join(' / ')}`,
          )
        : null,
      el(KeilLogDialog, { logView, setLogView }),
      el(KeilPickerDialog, {
        picker,
        busy,
        openPicker,
        chooseProject,
        onClose: () => setPicker(null),
      }),
    )
  }
}
