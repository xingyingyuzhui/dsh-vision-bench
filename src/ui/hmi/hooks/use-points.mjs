import { usePointColWidths } from './use-point-col-widths.mjs'

export function usePoints(React) {
  const [editingDeviceId, setEditingDeviceId] = React.useState('')
  const [editingPointsDeviceId, setEditingPointsDeviceId] = React.useState('')
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
  const {
    colWidths,
    colWidthsByDevice,
    getColWidths,
    setColWidths,
    onStartResize,
    resetColWidth,
    totalTableWidth,
  } = usePointColWidths(React)

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

