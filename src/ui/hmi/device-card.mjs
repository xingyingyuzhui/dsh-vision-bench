import { pointRuntimeStatus } from '../../../bench-points.mjs'
import { shouldHighlightFocus } from '../../../bench-shared.mjs'
import { renderBatchPanel } from './batch-add.mjs'
import { renderCsvPanel } from './csv-transfer.mjs'
import { renderNewPointRow } from './point-editor.mjs'
import { renderPointRow } from './point-row.mjs'
import { renderPointThead } from './point-table.mjs'

/** Device cards panel with nested point tables. */
export function renderDeviceCards(el, t, ctx) {
  const {
    activeConnObj,
    activeDevices,
    points,
    cwd,
    activeConnId,
    openAddDevice,
    pointsOfDevice,
    busy,
    devDeleteId,
    setDevDeleteId,
    editingDeviceId,
    editingPointsDeviceId,
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
    canDevice,
    connMissing,
    readRunning,
    readAll,
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
  } = ctx

  return el(
    'div',
    { className: 'dvb-panel' },
    el(
      'div',
      { className: 'dvb-panel-head' },
      el('span', { className: 'dvb-panel-title' }, '设备 · ' + (activeConnObj ? activeConnObj.name : '')),
      el('span', { className: 'dvb-tag', title: '插件版本；改 client 后需重启 dsh web' }, 'v0.21.0'),
      el('span', { className: 'dvb-tag' }, activeDevices.length + ' 个设备 · ' + points.length + ' 个点位'),
      el(
        'button',
        {
          type: 'button',
          className: 'dvb-btn dvb-btn-primary',
          disabled: !cwd || !activeConnId,
          onClick: openAddDevice,
        },
        '＋添加设备',
      ),
    ),
    activeDevices.length
      ? el(
          'div',
          { className: 'dvb-dev-cards' },
          activeDevices.map((d) => {
            const devPts = pointsOfDevice(d.id)
            const devBusy = busy === d.id
            const pDel = devDeleteId?.split('|')
            const confirmDel = pDel && pDel[0] === d.id
            const editingDevice = editingDeviceId === d.id
            const editingPoints = editingPointsDeviceId === d.id
            const adding = !!(newPointDraft && newPointDraft.deviceId === d.id)
            const showOps = editingPoints || adding
            const batchOpen = batch.open && batch.deviceId === d.id
            const cm = connectionStates.find((x) => x.connectionId === d.connectionId)
            const linkSt = cm ? cm.status || 'disconnected' : 'disconnected'
            let devStatus = { kind: 'idle', label: '未连接' }
            if (linkSt === 'connected') {
              let alarm = false
              let comm = false
              let ok = false
              for (const p of devPts) {
                const rs = pointRuntimeStatus(p, valueMap[p.id], alarmStateData, linkSt)
                if (rs.key === 'alarm') alarm = true
                else if (rs.key === 'comm-error') comm = true
                else if (rs.key === 'ok') ok = true
              }
              if (alarm) devStatus = { kind: 'err', label: '告警' }
              else if (comm) devStatus = { kind: 'err', label: '通信异常' }
              else if (ok) devStatus = { kind: 'live', label: '正常' }
              else devStatus = { kind: 'live', label: '已连接' }
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
                    el(
                      'button',
                      {
                        type: 'button',
                        className: 'dvb-btn dvb-btn-sm dvb-btn-primary',
                        disabled: !!busy,
                        onClick() {
                          saveDeviceEdit(d)
                        },
                      },
                      t('devSave') || '保存',
                    ),
                    el(
                      'button',
                      {
                        type: 'button',
                        className: 'dvb-btn dvb-btn-sm',
                        onClick() {
                          cancelDeviceEdit()
                        },
                      },
                      t('csvCancel') || '取消',
                    ),
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
                          className: 'dvb-btn dvb-btn-sm dvb-btn-primary',
                          disabled: !!busy,
                          onClick() {
                            savePointsEdit(d)
                          },
                        },
                        t('ptSave') || '保存',
                      ),
                      el(
                        'button',
                        {
                          type: 'button',
                          className: 'dvb-btn dvb-btn-sm',
                          onClick() {
                            cancelPointsEdit()
                          },
                        },
                        t('csvCancel') || '取消',
                      ),
                    )
                  : el(
                      'div',
                      { className: 'dvb-toolbar', style: { flexWrap: 'wrap' } },
                      el(
                        'button',
                        {
                          type: 'button',
                          className: 'dvb-btn dvb-btn-sm dvb-btn-primary',
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
                              return { ...prev, open: !same, deviceId: d.id, connectionId: activeConnId }
                            })
                            setCsvTarget((prev) =>
                              prev.open && prev.deviceId === d.id ? { ...prev, open: false } : prev,
                            )
                          },
                        },
                        batchOpen ? '收起批量' : t('batchAdd') || '批量添加',
                      ),
                      el(
                        'button',
                        {
                          type: 'button',
                          className: 'dvb-btn dvb-btn-sm',
                          disabled: !cwd || !canDevice || connMissing || !devPts.length || !!busy || readRunning,
                          onClick() {
                            readAll(d.id)
                          },
                        },
                        devBusy ? t('reading') : t('readAll'),
                      ),
                      el(
                        'button',
                        {
                          type: 'button',
                          className: 'dvb-btn dvb-btn-sm',
                          disabled: !!devDeleteId || !devPts.length,
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
                            'dvb-btn dvb-btn-sm' + (csvTarget.open && csvTarget.deviceId === d.id ? ' is-on' : ''),
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
              batch.open && batch.deviceId === d.id
                ? renderBatchPanel(el, t, { d, field, batch, setBatch, cwd, generateBatch })
                : null,
              csvTarget.open && csvTarget.deviceId === d.id
                ? renderCsvPanel(el, t, { d, csvTarget, setCsvTarget, csvText, setCsvText, importCsv })
                : null,
              devPts.length || (newPointDraft && newPointDraft.deviceId === d.id)
                ? el(
                    'div',
                    { className: 'dvb-table-wrap' },
                    el(
                      'table',
                      { className: 'dvb-table dvb-point-table' },
                      renderPointThead(el, t, { d, editingPointsDeviceId, newPointDraft }),
                      el(
                        'tbody',
                        null,
                        newPointDraft && newPointDraft.deviceId === d.id
                          ? renderNewPointRow(el, t, { newPointDraft, setNewPointDraft, cwd, saveNewPointDraft })
                          : null,
                        devPts.map((point) => renderPointRow(el, t, { ...pointRowCtx, point, devId: d.id, showOps })),
                      ),
                    ),
                  )
                : el('div', { className: 'dvb-empty' }, t('noPoints')),
            )
          }),
        )
      : el(
          'div',
          { className: 'dvb-empty dvb-dev-empty' },
          el('div', { className: 'dvb-dev-empty-title' }, '连接已创建'),
          el('div', { className: 'dvb-hint' }, '下一步：添加设备'),
          el(
            'button',
            { type: 'button', className: 'dvb-btn dvb-btn-primary', disabled: !cwd, onClick: openAddDevice },
            '＋添加设备',
          ),
        ),
  )
}
