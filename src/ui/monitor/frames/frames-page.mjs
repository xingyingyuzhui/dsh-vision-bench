import { hasHarnessInput } from '../../common/agent-reference.mjs'
import { renderEmptyState } from '../../components/empty-state.mjs'
import { formatErrorMessage } from '../../common/ui-format.mjs'
import { vendorUseVirtualizer, vendorVirtualizer } from '../../vendor/vendor-bridge.mjs'
import { createDataTable } from '../../components/data-table.mjs'
import { buildFrameColumns } from './frames-columns.mjs'
import { createFramesDetailDrawer } from './frames-detail-drawer.mjs'
import { createFramesFilterToolbar } from './frames-filter-toolbar.mjs'
import { createFramesToolsToolbar } from './frames-tools-toolbar.mjs'
import { useFrameColWidths } from './use-frame-col-widths.mjs'
import { useFramesPage } from './use-frames-page.mjs'

// 串口报文侧栏：只订阅上位机已连接串口的协议/原始捕获，不打开 COM。
export const FRAMES_TAB_ID = 'dsh-vision-bench:frames'

const OVERS_CAN = 10

export function framesQueryActive(page) {
  if (String(page?.search || '').trim()) return true
  const filters = page?.filters || {}
  return Boolean(filters.deviceId || filters.functionCode || filters.status || filters.source || filters.direction)
}

export function renderFramesListEmpty(el, t, queryActive) {
  return renderEmptyState(el, {
    kind: 'empty',
    className: 'dvb-frames-list-empty',
    title: queryActive ? t('framesEmptyFiltered') : t('framesEmpty'),
    detail: queryActive ? t('framesEmptyFilteredHint') : null,
  })
}

// Task2/0.18.2: official React virtualizer adapter. `useViz` is stable across
// renders (module scope), so this is a legal unconditional hook call.
// lazy: vendor only exists after the ModuleLoader factory runs (or late global install in tests)
const useViz = vendorUseVirtualizer() || (() => null)

export function createFramesPage(React, t, post, hooks) {
  // Task8/0.18.3: the virtualizer hook is injected ONCE per page factory —
  // tests pass the official adapter explicitly, production uses DvbVendor's.
  const useVizForPage = (hooks && typeof hooks.useVirtualizer === 'function' && hooks.useVirtualizer) || useViz
  const DataTable = createDataTable(React)
  const FramesToolsToolbar = createFramesToolsToolbar(React, t)
  const FramesFilterToolbar = createFramesFilterToolbar(React, t)
  const FramesDetailDrawer = createFramesDetailDrawer(React, t)
  return function FramesPage(props) {
    const el = React.createElement
    const { colWidths, onStartResize, resetColWidth, totalTableWidth } = useFrameColWidths(React)
    const page = useFramesPage(React, props, post)
    const frameColumns = buildFrameColumns(React, t, props, {
      mode: page.mode,
      devices: page.devices,
      connections: page.connections,
      encoding: page.encoding,
      colWidths,
    })

    return el(
      'div',
      { className: 'dvb-live dvb-frames-page', 'data-mode': page.mode },
      el(FramesToolsToolbar, {
        mode: page.mode,
        switchMode: page.switchMode,
        encoding: page.encoding,
        setEncoding: page.setEncoding,
        paused: page.paused,
        togglePause: page.togglePause,
        clearView: page.clearView,
        filteredLength: page.filtered.length,
        exportOpen: page.exportOpen,
        setExportOpen: page.setExportOpen,
        downloadFrames: page.downloadFrames,
        copyFrames: page.copyFrames,
        exportFrames: page.exportFrames,
      }),
      page.selectedGone
        ? el(
            'div',
            { className: 'dvb-hint' },
            el(
              'div',
              null,
              `${page.sel.port || page.sel.connectionId} ${t('framesDisconnected')}`,
            ),
            el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn',
                onClick() {
                  page.setSelection('all')
                },
              },
              t('framesPickOther'),
            ),
          )
        : null,
      el(FramesFilterToolbar, {
        mode: page.mode,
        selection: page.selection,
        setSelection: page.setSelection,
        setPendingNew: page.setPendingNew,
        portOptions: page.portOptions,
        search: page.search,
        setSearch: page.setSearch,
        filters: page.filters,
        setFilters: page.setFilters,
        devices: page.devices,
        onReset: page.resetFilters,
      }),
      page.serial.error
        ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, formatErrorMessage(page.serial.error))
        : null,
      page.error ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, formatErrorMessage(page.error)) : null,
      page.copied ? el('div', { className: 'dvb-hint' }, page.copied) : null,
      !page.filtered.length && vendorVirtualizer() === null
        ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, t('framesVirtualMissing'))
        : null,
      el(
        'div',
        { className: 'dvb-frames-split' },
        el(
          'div',
          { className: 'dvb-frames-main' },
          !page.filtered.length
            ? renderFramesListEmpty(el, t, framesQueryActive(page))
            : el(DataTable, {
            data: page.filtered,
            columns: frameColumns,
            getRowId: (f) => String(f.frameId || f.id || ''),
            virtualize: true,
            useVirtualizer: useVizForPage,
            estimateSize: page.estimateSize,
            overscan: OVERS_CAN,
            height: 'auto',
            fallbackCap: 30,
            listRef: page.listRef,
            listClassName: 'dvb-live-list dvb-frames-virtual',
            selectedId: page.selectedFrameId,
            onStartResize,
            resetColWidth,
            totalWidth: totalTableWidth(page.mode),
            onRowClick(f) {
              page.setSelectedFrameId(String(f.frameId || f.id || ''))
            },
            onVirtualizer(inst) {
              page.vizerRef.current = inst
            },
            onVirtualizerChange: page.noteScrollPosition,
            onScroll: page.onScroll,
            getRowProps(row) {
              return {
                className: `dvb-live-row${String(row.id) === String(page.selectedFrameId) ? ' is-on' : ''}`,
                'data-frameid': row.id ? String(row.id) : '',
              }
            },
          }),
        ),
        el(FramesDetailDrawer, {
          frame: page.selectedFrame,
          connections: page.connections,
          copied: page.copied,
          sendToAgent: page.sendToAgent,
          hasInput: hasHarnessInput(props),
        }),
      ),
    )
  }
}
