import { pointRuntimeStatus } from '../../domain/modbus/point-model.mjs'
import { shouldHighlightFocus } from '../common/focus-store.mjs'
import { renderBatchPanel } from './batch-add.mjs'
import { renderCsvPanel } from './csv-transfer.mjs'
import { renderNewPointRow } from './point-editor.mjs'
import { renderPointRow } from './point-row.mjs'
import { renderPointThead } from './point-table.mjs'
import { renderCancelButton, renderSaveButton } from '../components/save-cancel-buttons.mjs'

/**
 * Render one device card (header, toolbars, point table).
 * @param {(tag: string, props?: any, ...children: any) => any} el
 * @param {(key: string) => string} t
 * @param {{ device: any, ctx: any, isSimulated: boolean }} args
 */
export function renderDeviceCard(el, t, { device: d, ctx, isSimulated }) {
  const {
    CustomSelect,
    cwd,
    activeConnId,
    pointsOfDevice,
    busy,
    devDeleteId,
    setDevDeleteId,
    editingDeviceId,
    editingPointsDeviceId,
    pointDraftsById: pointDraftsByIdFromProps,
    newPointDraft,
    setNewPointDraft,
    batch,
    setBatch,
    csvTarget,
    setCsvTarget,
    csvNote,
    connectionStates,
    valueMap,
    alarmStateData,
    focusState,
    deviceDraft,
    setDeviceDraft,
    saveDeviceEdit,
    cancelDeviceEdit,
    requestDeleteDevice,
    enterDeviceEdit,
    savePointsEdit,
    cancelPointsEdit,
    addNewPointRow,
    enterPointsEdit,
    exportCsv,
    sendToAgent,
    confirmDeleteDevice,
    field,
    generateBatch,
    importCsv,
    csvText,
    setCsvText,
    saveNewPointDraft,
    pointRowCtx,
    colWidths,
    getColWidths,
    onStartResize,
    resetColWidth,
    totalTableWidth,
  } = ctx

          const devPts = pointsOfDevice(d.id)
          const devBusy = busy === d.id
          const pDel = devDeleteId?.split('|')
          const confirmDel = pDel && pDel[0] === d.id
          const editingDevice = editingDeviceId === d.id
          const editingPoints = editingPointsDeviceId === d.id
          const pointDraftsById = pointDraftsByIdFromProps || pointRowCtx?.pointDraftsById || {}
          const ptsToRender = editingPoints ? Object.values(pointDraftsById) : devPts
          const adding = !!(newPointDraft && newPointDraft.deviceId === d.id)
          const showOps = editingPoints || adding
          const batchOpen = !!(batch?.open && batch.deviceId === d.id)
          const cm = (connectionStates || []).find((x) => x.connectionId === d.connectionId)
          const isDevSim = Boolean(cm?.simulated || isSimulated)
          const linkSt = cm ? cm.status || 'disconnected' : 'disconnected'
          let devStatus = { kind: 'idle', label: isDevSim ? '仿真未启动' : '未连接' }
          if (linkSt === 'connected') {
            let alarm = false
            let comm = false
            let ok = false
            for (const p of devPts) {
              const rs = pointRuntimeStatus(p, valueMap ? valueMap[p.id] : undefined, alarmStateData, linkSt)
              if (rs.key === 'alarm') alarm = true
              else if (rs.key === 'comm-error') comm = true
              else if (rs.key === 'ok') ok = true
            }
            if (alarm) devStatus = { kind: 'err', label: '告警' }
            else if (comm) devStatus = { kind: 'err', label: '通信异常' }
            else if (ok) devStatus = { kind: 'live', label: isDevSim ? '仿真正常' : '正常' }
            else devStatus = { kind: 'live', label: isDevSim ? '已连接 (仿真)' : '已连接' }
          } else if (linkSt === 'connecting') devStatus = { kind: 'warn', label: '连接中' }
          else if (linkSt === 'disconnecting') devStatus = { kind: 'warn', label: '断开中' }
          else if (linkSt === 'error') devStatus = { kind: 'err', label: '连接异常' }
          return el(
            'div',
            {
              key: d.id,
              className:
                'dvb-panel dvb-dev-card' +
                (shouldHighlightFocus(focusState) && focusState.request.deviceId === d.id ? ' dvb-has-focus' : '') +
                (editingDevice ? ' dvb-dev-editing' : '') +
                (editingPoints ? ' dvb-points-editing' : ''),
            },
            editingDevice
              ? el(
                  'div',
                  { className: 'dvb-dev-head dvb-dev-edit-row' },
                  el('input', {
                    className: 'dvb-input',
                    style: { minWidth: '120px', flex: '1 1 140px' },
                    value: deviceDraft?.name || d.name,
                    onChange: (e) => setDeviceDraft((prev) => ({ ...prev, name: e.target.value })),
                  }),
                  el('span', { className: 'dvb-tag' }, '站号'),
                  el('input', {
                    className: 'dvb-input dvb-input-mono',
                    style: { width: '64px' },
                    type: 'number',
                    min: 1,
                    max: 247,
                    value: deviceDraft?.unitId || d.unitId,
                    onChange: (e) => setDeviceDraft((prev) => ({ ...prev, unitId: Number(e.target.value) })),
                  }),
                  renderCancelButton(el, t, {
                    size: 'sm',
                    onClick() {
                      cancelDeviceEdit()
                    },
                    text: t('csvCancel') || '取消',
                  }),
                  renderSaveButton(el, t, {
                    size: 'sm',
                    disabled: !!busy,
                    onClick() {
                      saveDeviceEdit(d)
                    },
                    text: t('devSave') || '保存',
                  }),
                  el(
                    'button',
                    {
                      type: 'button',
                      className: 'dvb-btn dvb-btn-sm dvb-btn-danger',
                      title: '删除该设备及全部点位',
                      'aria-label': '删除设备 ' + d.name,
                      onClick() {
                        requestDeleteDevice(d)
                      },
                    },
                    t('devDelete') || '删除设备',
                  ),
                )
              : el(
                  'div',
                  { className: 'dvb-dev-head' },
                  el(
                    'div',
                    { className: 'dvb-dev-head-main' },
                    el('span', { className: 'dvb-dev-title' }, d.name),
                    el('span', { className: 'dvb-tag' }, '站号 ' + d.unitId),
                    el('span', { className: 'dvb-badge dvb-status', 'data-kind': devStatus.kind }, devStatus.label),
                  ),
                  el(
                    'button',
                    {
                      type: 'button',
                      className: 'dvb-btn dvb-btn-sm',
                      disabled: !!devDeleteId || editingPoints,
                      onClick() {
                        enterDeviceEdit(d)
                      },
                    },
                    t('devEdit') || '编辑设备',
                  ),
                ),
            editingDevice
              ? null
              : editingPoints
                ? el(
                    'div',
                    { className: 'dvb-toolbar', style: { flexWrap: 'wrap' } },
                    el(
                      'button',
                      {
                        type: 'button',
                        className: 'dvb-btn dvb-btn-sm',
                        disabled: !cwd,
                        onClick() {
                          addNewPointRow(d.id)
                        },
                      },
                      t('addPoint'),
                    ),
                    el(
                      'button',
                      {
                        type: 'button',
                        className: 'dvb-btn dvb-btn-sm' + (batchOpen ? ' is-on' : ''),
                        'aria-pressed': batchOpen ? 'true' : 'false',
                        onClick() {
                          setBatch((prev) => {
                            const same = prev.open && prev.deviceId === d.id
                            return {
                              ...prev,
                              open: !same,
                              deviceId: d.id,
                              connectionId: d.connectionId || activeConnId,
                            }
                          })
                          setCsvTarget((prev) =>
                            prev.open && prev.deviceId === d.id ? { ...prev, open: false } : prev,
                          )
                        },
                      },
                      batchOpen ? '收起批量' : t('batchAdd') || '批量添加',
                    ),
                    renderCancelButton(el, t, {
                      size: 'sm',
                      onClick() {
                        cancelPointsEdit()
                      },
                      text: t('csvCancel') || '取消',
                    }),
                    renderSaveButton(el, t, {
                      size: 'sm',
                      disabled: !!busy,
                      onClick() {
                        savePointsEdit(d)
                      },
                      text: t('ptSave') || '保存',
                    }),
                  )
                : el(
                    'div',
                    { className: 'dvb-toolbar', style: { flexWrap: 'wrap' } },
                    el(
                      'button',
                      {
                        type: 'button',
                        className: 'dvb-btn dvb-btn-sm',
                        disabled: !!devDeleteId,
                        onClick() {
                          enterPointsEdit(d)
                        },
                      },
                      t('ptEdit') || '编辑点位',
                    ),
                    el(
                      'button',
                      {
                        type: 'button',
                        className:
                          'dvb-btn dvb-btn-sm' + (csvTarget?.open && csvTarget?.deviceId === d.id ? ' is-on' : ''),
                        onClick() {
                          setCsvTarget((prev) => ({
                            ...prev,
                            open: !(prev.open && prev.deviceId === d.id),
                            deviceId: d.id,
                          }))
                          setBatch((prev) => (prev.open && prev.deviceId === d.id ? { ...prev, open: false } : prev))
                        },
                      },
                      csvNote || t('csvImport'),
                    ),
                    el(
                      'button',
                      {
                        type: 'button',
                        className: 'dvb-btn dvb-btn-sm',
                        disabled: !devPts.length,
                        onClick() {
                          exportCsv(d.id)
                        },
                      },
                      t('csvExport'),
                    ),
                    el(
                      'button',
                      {
                        type: 'button',
                        className: 'dvb-btn dvb-btn-sm',
                        title: '复制设备结构化引用并让 Agent 分析',
                        'aria-label': '让 Agent 分析设备 ' + d.name,
                        onClick() {
                          sendToAgent('device', { deviceId: d.id, connectionId: d.connectionId, name: d.name })
                        },
                      },
                      'AI',
                    ),
                  ),
            confirmDel
              ? el(
                  'div',
                  { className: 'dvb-write-panel', style: { marginBottom: '6px' } },
                  el(
                    'div',
                    { className: 'dvb-hint dvb-need' },
                    '将同时删除该设备的 ' + pDel[1] + ' 个点位和 ' + pDel[2] + ' 个当前值',
                  ),
                  el(
                    'div',
                    { className: 'dvb-actions' },
                    el(
                      'button',
                      {
                        type: 'button',
                        className: 'dvb-btn dvb-btn-primary',
                        onClick() {
                          confirmDeleteDevice(d)
                        },
                      },
                      '确认删除',
                    ),
                    el(
                      'button',
                      {
                        type: 'button',
                        className: 'dvb-btn',
                        onClick() {
                          setDevDeleteId('')
                        },
                      },
                      t('csvCancel'),
                    ),
                  ),
                )
              : null,
            batch?.open && batch.deviceId === d.id
              ? renderBatchPanel(el, t, { d, field, batch, setBatch, cwd, generateBatch, CustomSelect })
              : null,
            csvTarget?.open && csvTarget.deviceId === d.id
              ? renderCsvPanel(el, t, { d, csvTarget, setCsvTarget, csvText, setCsvText, importCsv })
              : null,
            ptsToRender.length || editingPoints || (newPointDraft && newPointDraft.deviceId === d.id)
              ? (() => {
                  const devWidths = getColWidths ? getColWidths(d, activeConnId) : colWidths?.[d.id] || colWidths
                  return el(
                    'div',
                    { className: 'dvb-table-wrap' },
                    el(
                      'table',
                      {
                        className: 'dvb-table dvb-point-table',
                        style: {
                          width: totalTableWidth ? `${totalTableWidth(showOps, d, activeConnId)}px` : 'max-content',
                        },
                      },
                      renderPointThead(el, t, {
                        d,
                        editingPointsDeviceId,
                        newPointDraft,
                        colWidths: devWidths,
                        onStartResize,
                        resetColWidth,
                      }),
                      el(
                        'tbody',
                        null,
                        newPointDraft && newPointDraft.deviceId === d.id
                          ? renderNewPointRow(el, t, {
                              newPointDraft,
                              setNewPointDraft,
                              cwd,
                              saveNewPointDraft,
                              CustomSelect,
                            })
                          : null,
                        ptsToRender.map((point) =>
                          renderPointRow(el, t, { ...pointRowCtx, point, devId: d.id, showOps, CustomSelect }),
                        ),
                        editingPoints
                          ? el(
                              'tr',
                              { className: 'dvb-table-add-tr' },
                              el(
                                'td',
                                { colSpan: 12 },
                                el(
                                  'button',
                                  {
                                    type: 'button',
                                    className: 'dvb-btn-dashed',
                                    disabled: !cwd,
                                    onClick() {
                                      addNewPointRow(d.id)
                                    },
                                  },
                                  '＋ 添加一行点位',
                                ),
                              ),
                            )
                          : null,
                      ),
                    ),
                  )
                })()
              : el(
                  'div',
                  { className: 'dvb-empty' },
                  el('div', { className: 'dvb-hint' }, t('noPoints')),
                  el(
                    'button',
                    {
                      type: 'button',
                      className: 'dvb-btn dvb-btn-sm dvb-btn-primary',
                      style: { marginTop: '8px' },
                      disabled: !cwd,
                      onClick() {
                        enterPointsEdit(d)
                        addNewPointRow(d.id)
                      },
                    },
                    '＋ ' + (t('addPoint') || '添加点位'),
                  ),
                ),
          )
}
