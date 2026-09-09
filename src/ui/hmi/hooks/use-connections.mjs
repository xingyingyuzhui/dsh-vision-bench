import { getPreserveNavPreference } from '../../../../bench-settings.mjs'
import { useConnColWidths } from './use-conn-col-widths.mjs'

const LAST_HMI_TAB_STORAGE_KEY = 'dsh-vision-bench:last-hmi-tab'

export function getLastHmiTab(cwd = '') {
  if (!getPreserveNavPreference()) return 'all'
  if (typeof window === 'undefined' || !window.sessionStorage) return 'all'
  try {
    return window.sessionStorage.getItem(LAST_HMI_TAB_STORAGE_KEY + (cwd ? ':' + cwd : '')) || 'all'
  } catch {
    return 'all'
  }
}

export function setLastHmiTab(cwd = '', tab = 'all') {
  if (typeof window === 'undefined' || !window.sessionStorage) return
  try {
    const key = LAST_HMI_TAB_STORAGE_KEY + (cwd ? ':' + cwd : '')
    if (tab && tab !== 'all') {
      window.sessionStorage.setItem(key, tab)
    } else {
      window.sessionStorage.removeItem(key)
    }
  } catch {}
}

export function useConnections(React, cwd = '') {
  const [connForm, setConnForm] = React.useState({
    open: false,
    id: '',
    name: '',
    role: 'client',
    enabled: true,
    conn: {
      mode: 'rtu',
      port: '',
      baudrate: 9600,
      bytesize: 8,
      parity: 'N',
      stopbits: 1,
      host: '',
      tcpPort: 502,
      sim: false,
    },
  })
  const [hmiTab, setHmiTabState] = React.useState(() => getLastHmiTab(cwd))
  React.useEffect(() => {
    setHmiTabState(getLastHmiTab(cwd))
  }, [cwd])
  const setHmiTab = (nextTab) => {
    setHmiTabState((prev) => {
      const val = typeof nextTab === 'function' ? nextTab(prev) : nextTab
      if (getPreserveNavPreference()) {
        setLastHmiTab(cwd, val)
      }
      return val
    })
  }
  const [moreOpen, setMoreOpen] = React.useState(false)
  const [pendingDeleteId, setPendingDeleteId] = React.useState('')
  const [linkBusy, setLinkBusy] = React.useState('')
  const lastDeviceByConn = React.useRef({})
  const { connColWidths, setConnColWidths, onStartConnResize, resetConnColWidth, totalConnTableWidth } =
    useConnColWidths(React)
  return {
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
    setConnColWidths,
    onStartConnResize,
    resetConnColWidth,
    totalConnTableWidth,
  }
}
