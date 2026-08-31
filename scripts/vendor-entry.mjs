import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { cpp } from '@codemirror/lang-cpp'
import { json } from '@codemirror/lang-json'
import { defaultHighlightStyle, foldGutter, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { EditorState, StateEffect, StateField } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import { useVirtualizer } from '@tanstack/react-virtual'
import { createTable, getCoreRowModel, getSortedRowModel } from '@tanstack/table-core'
import { Virtualizer, elementScroll, observeElementOffset, observeElementRect } from '@tanstack/virtual-core'
import { BarChart, LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { GridStack } from 'gridstack'
// Build-time vendor: uPlot + TanStack + GridStack + ECharts + CodeMirror.
// Never pollutes window. react is EXTERNAL. Do not import react-arborist
// (peer react-dom + react-dnd) or useReactTable.
import uPlot from 'uplot'

echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

const codeMirror = {
  EditorState,
  StateEffect,
  StateField,
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  Decoration,
  defaultKeymap,
  history,
  historyKeymap,
  searchKeymap,
  highlightSelectionMatches,
  foldGutter,
  syntaxHighlighting,
  defaultHighlightStyle,
  cpp,
  json,
}

export {
  uPlot,
  Virtualizer,
  elementScroll,
  observeElementRect,
  observeElementOffset,
  useVirtualizer,
  createTable,
  getCoreRowModel,
  getSortedRowModel,
  GridStack,
  echarts,
  codeMirror,
}
