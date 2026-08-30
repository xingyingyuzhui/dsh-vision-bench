export function useConnections(React) {
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
  const [hmiTab, setHmiTab] = React.useState('all')
  const [moreOpen, setMoreOpen] = React.useState(false)
  const [pendingDeleteId, setPendingDeleteId] = React.useState('')
  const [linkBusy, setLinkBusy] = React.useState('')
  const lastDeviceByConn = React.useRef({})
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
  }
}
