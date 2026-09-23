// TaskP2/0.20.0: 可视化组件编辑/新建抽屉 VizEditorPanel
// 现代化右侧滑出抽屉形态：组件名称、可视化类型卡片、高级图表配置、实时预览及关联点位选择。

import { toBodyPortal } from '../../../common/body-portal.mjs'
import { getCustomSelect } from '../../../components/custom-select.mjs'
import { createModalDialog } from '../../../components/modal-dialog.mjs'
import { renderPreviewChart } from '../hooks/viz-preview-chart.mjs'
import { TYPE_DEFS } from './viz-editor-constants.mjs'
import { renderChartConfigContent } from './viz-editor-chart-tabs.mjs'
import { createVizEditorFields } from './viz-editor-fields.mjs'
import { createWidgetTabRenderers } from './viz-editor-widget-tabs.mjs'
import { createVizPointPicker } from './viz-point-picker.mjs'

export function createVizEditorPanel(React, t) {
  const el = React.createElement
  const ModalDialog = createModalDialog(React, t)
  const CustomSelect = getCustomSelect(React)
  const VizPointPicker = createVizPointPicker(React, t)
  const widgets = createWidgetTabRenderers(el)

  return function VizEditorPanel({
    editor,
    setEditor,
    points = [],
    devices = [],
    connections = [],
    pointOptions = [],
    editorCheck = { ok: false, reason: '' },
    saving = false,
    vizReadOnly = false,
    onSave,
    onCancel,
  }) {
    const [activeTab, setActiveTab] = React.useState('style')
    const [previewState, setPreviewState] = React.useState('on')
    const previewRef = React.useRef(null)
    const nameRef = React.useRef(null)

    React.useEffect(() => {
      renderPreviewChart(previewRef.current, editor)
    }, [editor?.type, editor?.settings])

    React.useEffect(() => {
      const ty = editor?.type
      setActiveTab(ty === 'line' || ty === 'bar' ? 'style' : 'display')
      setPreviewState('on')
    }, [editor?.type])

    if (!editor) return null

    const switchType = (type) =>
      setEditor((p) => ({
        ...p,
        type,
        pointIds: (type === 'value' || type === 'switch') && p.pointIds?.length > 1 ? p.pointIds.slice(0, 1) : p.pointIds,
      }))

    const s = editor.settings || {}
    const setS = (k, v) => setEditor((p) => ({ ...p, settings: { ...(p.settings || {}), [k]: v } }))
    const fields = createVizEditorFields(el, CustomSelect, s, setS)

    const isLine = editor.type === 'line'
    const isChart = isLine || editor.type === 'bar'
    const isValue = editor.type === 'value'
    const isSwitch = editor.type === 'switch'

    const renderConfigContent = () => {
      if (isChart) {
        return renderChartConfigContent({
          el,
          fields,
          activeTab,
          setActiveTab,
          previewRef,
          s,
          isLine,
        })
      }
      if (isValue) {
        return widgets.configShell(
          fields,
          activeTab,
          setActiveTab,
          [
            ['display', t('vizTabDisplay')],
            ['format', t('vizTabFormat')],
            ['status', t('vizTabStatus')],
          ],
          widgets.renderValueTabContent(fields, activeTab),
          widgets.valuePreview(s, editor.name),
        )
      }
      if (isSwitch) {
        return widgets.configShell(
          fields,
          activeTab,
          setActiveTab,
          [
            ['display', t('vizTabLook')],
            ['behavior', t('vizTabBehavior')],
            ['feedback', t('vizTabFeedback')],
          ],
          widgets.renderSwitchTabContent(fields, activeTab),
          widgets.switchPreview(fields, s, editor.name, previewState, setPreviewState),
        )
      }
      return null
    }

    const modalTitle = editor.id ? t('vizEdit') : t('vizNew')

    return toBodyPortal(
      el(ModalDialog, {
        open: true,
        title: modalTitle,
        maskClassName: 'dvb-viz-modal-mask',
        dialogClassName: 'dvb-viz-modal',
        showIcon: false,
        maskClosable: !saving,
        loading: Boolean(saving),
        confirmLoading: Boolean(saving),
        confirmDisabled: !editorCheck.ok || vizReadOnly,
        cancelText: t('csvCancel'),
        confirmText: saving ? t('saving') : t('vizSave'),
        initialFocusRef: nameRef,
        onCancel,
        onConfirm: onSave,
        onClose: onCancel,
        content: el(
          'div',
          { className: 'dvb-viz-drawer-body' },
          el(
            'div',
            { className: 'dvb-viz-form-section' },
            el('label', { className: 'dvb-viz-form-label' }, t('vizName')),
            el('input', {
              ref: nameRef,
              className: 'dvb-input dvb-viz-input',
              placeholder: t('vizNamePh'),
              value: editor.name || '',
              maxLength: 40,
              onChange: (e) => setEditor((p) => ({ ...p, name: e.target.value })),
            }),
          ),
          el(
            'div',
            { className: 'dvb-viz-form-section dvb-viz-type-section' },
            el('label', { className: 'dvb-viz-form-label' }, t('vizTypeConfig')),
            el(
              'div',
              { className: 'dvb-viz-type-split' },
              el(
                'div',
                { className: 'dvb-viz-type-col' },
                TYPE_DEFS.map(([ty, title, desc]) =>
                  el(
                    'button',
                    {
                      key: ty,
                      type: 'button',
                      className: `dvb-viz-type-card${editor.type === ty ? ' is-active' : ''}`,
                      onClick: () => switchType(ty),
                    },
                    el('span', { className: 'dvb-viz-type-title' }, title),
                    el('span', { className: 'dvb-viz-type-desc' }, desc),
                  ),
                ),
                el(
                  'select',
                  {
                    value: editor.type,
                    onChange: (e) => switchType(e.target.value),
                    style: { display: 'none' },
                  },
                  TYPE_DEFS.map(([ty, title]) => el('option', { key: ty, value: ty }, title)),
                ),
              ),
              el('div', { className: 'dvb-viz-config-card' }, renderConfigContent()),
            ),
          ),
          el(VizPointPicker, {
            editor,
            setEditor,
            pointOptions,
            points,
            devices,
            connections,
          }),
          !editorCheck.ok && editorCheck.reason && el('div', { className: 'dvb-hint dvb-need' }, editorCheck.reason),
        ),
      }),
    )
  }
}
