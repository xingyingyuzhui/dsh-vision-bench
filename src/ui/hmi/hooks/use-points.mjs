import { getPreserveNavPreference } from '../../../../bench-settings.mjs'
import { usePointColWidths } from './use-point-col-widths.mjs'

const LAST_POINTS_DEV_KEY = 'dsh-vision-bench:last-editing-points-dev'

export function getLastEditingPointsDeviceId(cwd = '', hmiTab = '') {
  if (!getPreserveNavPreference()) return ''
  if (typeof window === 'undefined' || !window.sessionStorage) return ''
  try {
    return window.sessionStorage.getItem(`${LAST_POINTS_DEV_KEY}:${cwd}:${hmiTab}`) || ''
  } catch {
    return ''
  }
}

export function setLastEditingPointsDeviceId(cwd = '', hmiTab = '', devId = '') {
  if (typeof window === 'undefined' || !window.sessionStorage) return
  try {
    const key = `${LAST_POINTS_DEV_KEY}:${cwd}:${hmiTab}`
    if (devId) {
      window.sessionStorage.setItem(key, devId)
    } else {
      window.sessionStorage.removeItem(key)
    }
  } catch {}
}

export function usePoints(React, cwd = '', hmiTab = '') {
  const [editingDeviceId, setEditingDeviceId] = React.useState('')
  const [editingPointsDeviceId, setEditingPointsDeviceIdState] = React.useState(() =>
    getLastEditingPointsDeviceId(cwd, hmiTab),
  )
  React.useEffect(() => {
    setEditingPointsDeviceIdState(getLastEditingPointsDeviceId(cwd, hmiTab))
  }, [cwd, hmiTab])
  const setEditingPointsDeviceId = (nextDev) => {
    setEditingPointsDeviceIdState((prev) => {
      const val = typeof nextDev === 'function' ? nextDev(prev) : nextDev
      if (getPreserveNavPreference()) {
        setLastEditingPointsDeviceId(cwd, hmiTab, val)
      }
      return val
    })
  }
  const [deviceDraft, setDeviceDraft] = React.useState(null)
  const [pointDraftsById, setPointDraftsById] = React.useState({})
  const [newPointDraft, setNewPointDraft] = React.useState(null)
  const [inlineWrite, setInlineWrite] = React.useState(null)
  const [batch, setBatch] = React.useState({ open: false, deviceId: '', prefix: '', fc: 3, start: 0, count: 5 })
  const [devForm, setDevForm] = React.useState({ open: false, id: '', name: '', unitId: 1, connectionId: '' })
  const [devDeleteId, setDevDeleteId] = React.useState('')
  const [csvText, setCsvText] = React.useState('')
  const [csvTarget, setCsvTarget] = React.useState({ deviceId: '', open: false, mode: 'merge' })
  const [csvNote, setCsvNote] = React.useState('')
  const [flagSavingByPoint, setFlagSavingByPoint] = React.useState({})
  const flagRequestSeq = React.useRef({})
  const { colWidths, colWidthsByDevice, getColWidths, setColWidths, onStartResize, resetColWidth, totalTableWidth } =
    usePointColWidths(React)

  return {
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
    colWidthsByDevice,
    getColWidths,
    setColWidths,
    onStartResize,
    resetColWidth,
    totalTableWidth,
  }
}
