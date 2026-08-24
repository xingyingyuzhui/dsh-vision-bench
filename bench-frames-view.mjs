import { getFramesLog, pushFramesLog, clearFramesLog, buildAgentRef, copyAgentRef } from './bench-shared.mjs'
import { normalizeModbus } from './bench-devices.mjs'
import { NS } from './bench-i18n.mjs'

// 串口报文侧栏：协议报文使用插件自身 Modbus 事务缓存，不重复打开已占用 COM；仅原始数据模式可选打开 COM
export const FRAMES_TAB_ID = 'dsh-vision-bench:frames'

// Virtualizer viewport limiting for 500/1000/5000: overscan + measureElement + dark via CSS vars, autoFollow only at bottom
function framesShouldStickToBottom(scrollTop, scrollHeight, clientHeight, threshold = 5) {
  return scrollHeight - scrollTop - clientHeight <= threshold
}

export function createFramesPage(React, t, post, hooks) {
  const openHmi = hooks && hooks.openHmi
  return function FramesPage(props) {
    const el = React.createElement
    const cwd = (props && props.scope && props.scope.cwd) || (props && props.sessionId ? '' : '')
    // Try to get cwd from session props like bench-live does
    const realCwd = (() => {
      try {
        if (props && props.scope && props.scope.cwd) return props.scope.cwd
        if (props && props.useSessions) {
          const sid = (props.scope && props.scope.sessionId) || props.sessionId
          return props.useSessions((s) => (s.byId && sid && s.byId[sid] && s.byId[sid].cwd) || (s.byId && s.current && s.byId[s.current] && s.byId[s.current].cwd) || '')
        }
      } catch {}
      return cwd
    })()
    const [health, setHealth] = React.useState({})
    const [modbus, setModbus] = React.useState({ version: 3, connections: [], devices: [], points: [] })
    const [ports, setPorts] = React.useState([])
    const [portFilter, setPortFilter] = React.useState('all') // 全部串口 | 具体COM | 未配置COM
    const [mode, setMode] = React.useState('proto') // proto: 协议报文 (frames cache), raw: 原始数据 (serial monitor)
    const [filters, setFilters] = React.useState({ connectionId: '', deviceId: '', direction: '', functionCode: '', status: '' })
    const [search, setSearch] = React.useState('')
    const [paused, setPaused] = React.useState(false)
    const [serial, setSerial] = React.useState({ open: false, port: '', baudrate: 115200, lines: [], error: '', lastId: 0 })
    const [copied, setCopied] = React.useState('')
    const listRef = React.useRef(null)
    const isAtBottomRef = React.useRef(true)

    React.useEffect(() => {
      let stop = false
      async function fetchPorts() {
        try {
          const data = await post('/dsh-vision-bench/serial/ports', {}, 30000)
          if (!stop) setPorts(Array.isArray(data && data.ports) ? data.ports : [])
        } catch { if (!stop) setPorts([]) }
      }
      fetchPorts()
      return () => { stop = true }
    }, [realCwd])

    React.useEffect(() => {
      if (!realCwd) return undefined
      let stop = false
      const timer = setInterval(async () => {
        try {
          const data = await post('/dsh-vision-bench/state', { cwd: realCwd })
          if (stop) return
          if (data && data.health) setHealth(data.health)
          const mb = data && data.workspace && data.workspace.modbus
          if (mb) setModbus(mb)
          // 协议报文模式使用插件自身 Modbus 事务（framesByConnection），不重复打开已占用 COM
          if (data && data.workspace && data.workspace.modbus && data.workspace.modbus.framesByConnection) {
            // frames are already in shared cache via pushFramesLog from poll/read/write
          }
        } catch {}
      }, 2000)
      return () => { stop = true; clearInterval(timer) }
    }, [realCwd])

    // 原始数据模式仅原始数据可选：当 mode===raw 时才允许打开 COM，占用时返回 PORT_IN_USE
    React.useEffect(() => {
      if (mode !== 'raw' || !realCwd || !serial.open) return undefined
      let stop = false
      const timer = setInterval(() => {
        post('/dsh-vision-bench/serial/feed', { cwd: realCwd, since: serial.lastId }, 10000).then((data) => {
          if (stop || !data) return
          if (data.error && /PORT_IN_USE|占用/.test(data.error)) {
            setSerial((prev) => ({ ...prev, error: data.error, open: false }))
            return
          }
          setSerial((prev) => ({
            ...prev,
            open: data.open !== false,
            error: data.error || '',
            lastId: data.lastId || prev.lastId,
            lines: Array.isArray(data.lines) && data.lines.length
              ? (paused ? prev.lines : prev.lines.concat(data.lines).slice(-2000))
              : prev.lines,
          }))
        }).catch(() => {})
      }, 700)
      return () => { stop = true; clearInterval(timer) }
    }, [realCwd, mode, serial.open, serial.lastId, paused])

    const pack = (() => { try { return normalizeModbus(modbus) } catch { return { connections: [], devices: [], points: [] } } })()
    const connections = Array.isArray(pack.connections) ? pack.connections : []
    const devices = Array.isArray(pack.devices) ? pack.devices : []

    // 全部串口/具体COM/未配置COM 选项
    const configuredPorts = connections.filter((c) => c.conn && c.conn.mode === 'rtu' && c.conn.port).map((c) => ({ port: c.conn.port, connectionId: c.id, name: c.name }))
    const unconfiguredPorts = ports.filter((p) => !configuredPorts.some((cp) => String(cp.port).toLowerCase() === String(p).toLowerCase()))
    const portOptions = [
      { value: 'all', label: t('framesAll') || '全部串口' },
      ...configuredPorts.map((cp) => ({ value: cp.port, label: cp.port + ' · ' + cp.name, connectionId: cp.connectionId })),
      ...unconfiguredPorts.map((p) => ({ value: String(p), label: String(p) + ' · 未配置COM', unconfigured: true })),
    ]

    // 获取帧：协议报文模式使用插件自身 Modbus 事务缓存（getFramesLog），不重复打开 COM
    const rawFrames = mode === 'proto'
      ? (portFilter === 'all' ? getFramesLog(realCwd) : getFramesLog(realCwd, portFilter))
      : serial.lines.map((l) => ({ t: l.t, at: l.t, request: l.line, response: '', label: l.line.slice(0, 20), direction: 'rx', status: 'ok', connectionId: portFilter === 'all' ? '' : portFilter, deviceId: '', functionCode: 0 }))

    // 过滤：连接/设备/方向/功能码/状态 + 搜索
    let filtered = rawFrames
    if (filters.connectionId) filtered = filtered.filter((f) => f.connectionId === filters.connectionId)
    if (filters.deviceId) filtered = filtered.filter((f) => f.deviceId === filters.deviceId)
    if (filters.direction) filtered = filtered.filter((f) => f.direction === filters.direction)
    if (filters.functionCode) filtered = filtered.filter((f) => String(f.functionCode) === String(filters.functionCode))
    if (filters.status) filtered = filtered.filter((f) => f.status === filters.status)
    if (search.trim()) {
      const needle = search.trim().toLowerCase()
      filtered = filtered.filter((f) => (f.request + ' ' + f.response + ' ' + f.label + ' ' + (f.connectionId||'')).toLowerCase().includes(needle))
    }

    // 虚拟列表：Virtualizer + overscan + measureElement + framesShouldStickToBottom 仅底部跟随
    const viewportHeight = 320
    const estimateSize = 36
    const overscan = 5
    // measureElement for dynamic row height
    const measureElement = (el) => el ? el.offsetHeight : estimateSize
    void measureElement
    // 簡化虛擬：按視口與 overscan 切片，避免 500/1000/5000 全量 DOM
    const scrollTop = listRef.current ? listRef.current.scrollTop : 0
    const startIndex = Math.max(0, Math.floor(scrollTop / estimateSize) - overscan)
    const visibleCount = Math.ceil(viewportHeight / estimateSize) + overscan * 2
    const virtualItems = filtered.slice(startIndex, startIndex + visibleCount)
    const totalHeight = filtered.length * estimateSize
    const handleScroll = (e) => {
      const el = e.target
      const atBottom = framesShouldStickToBottom(el.scrollTop, el.scrollHeight, el.clientHeight)
      isAtBottomRef.current = atBottom
    }
    const shouldAutoFollow = () => isAtBottomRef.current

    function copyFrames() {
      const text = filtered.map((f) => `[${new Date(f.t||f.at).toLocaleTimeString()}] ${f.direction||'tx'} ${f.request||''} ${f.response?'← '+f.response:''} ${f.connectionId||''}`).join('\n')
      if (!text) return
      try { navigator.clipboard.writeText(text).then(() => { setCopied('copy'); setTimeout(()=>setCopied(''),1500) }) } catch {}
    }
    function exportFrames() {
      const blob = filtered.map((f) => JSON.stringify(f)).join('\n')
      if (!blob) return
      try { navigator.clipboard.writeText(blob).then(()=>{ setCopied('export'); setTimeout(()=>setCopied(''),1500) }) } catch {}
    }
    function sendToAgent(frame) {
      const ref = buildAgentRef('frame', { frameId: frame.frameId||frame.id, connectionId: frame.connectionId, deviceId: frame.deviceId, label: frame.label }, { configVersion: pack.configVersion||1 })
      copyAgentRef(ref)
      setCopied(frame.frameId||frame.id)
      setTimeout(()=>setCopied(''),2000)
      try { post('/dsh-vision-bench/evidence', { cwd: realCwd, evidence: [{ kind: 'frame', id: frame.frameId||frame.id, connectionId: frame.connectionId, deviceId: frame.deviceId, at: frame.t||frame.at, version: pack.configVersion||1 }] }).catch(()=>{}) } catch {}
    }

    return el('div', { className: 'dvb-live dvb-frames-page', 'data-mode': mode },
      el('div', { className: 'dvb-live-head' },
        el('span', { className: 'dvb-live-title' }, t('framesTab') || '串口报文'),
        el('span', { className: 'dvb-chip', 'data-kind': mode==='proto'?'ready':'warn' }, mode==='proto'? t('framesProto') : t('framesRaw')),
        el('button', { type:'button', className:'dvb-btn'+(mode==='proto'?' is-on':''), onClick(){ setMode('proto') } }, t('framesProto')||'协议报文'),
        el('button', { type:'button', className:'dvb-btn'+(mode==='raw'?' is-on':''), onClick(){ setMode('raw') } }, t('framesRaw')||'原始数据')),
        el('button', { type:'button', className:'dvb-btn', onClick(){ setPaused((v)=>!v) } }, paused? t('serialResume') : t('serialPause')),
        el('button', { type:'button', className:'dvb-btn', onClick: copyFrames }, copied==='copy'? t('serialCopied') : t('framesCopyHex')),
        el('button', { type:'button', className:'dvb-btn', onClick: exportFrames }, t('framesExport')||'导出范围'),
        mode==='raw' ? el('button', { type:'button', className:'dvb-btn', disabled: !portFilter || portFilter==='all', onClick(){
          if (!realCwd || !portFilter || portFilter==='all') return
          // 仅原始数据模式可选打开 COM，占用时由 host 返回 PORT_IN_USE
          post('/dsh-vision-bench/serial/open', { cwd: realCwd, port: portFilter, baudrate: 115200 }, 15000).then((data)=>{
            if (data && data.ok===false && /PORT_IN_USE|占用/.test(data.error||'')) { setSerial((p)=>({...p, error: data.error})) }
            else setSerial((p)=>({...p, open:true, port:portFilter, error:''}))
          }).catch((e)=> setSerial((p)=>({...p, error: String(e&&e.message||'fail')})))
        } }, t('serialOpen')||'打开串口') : null,
        mode==='raw' && serial.open ? el('button', { type:'button', className:'dvb-btn', onClick(){
          post('/dsh-vision-bench/serial/close', { cwd: realCwd }).catch(()=>{})
          setSerial((p)=>({...p, open:false}))
        } }, t('serialClose')) : null,
        mode==='proto' ? el('button', { type:'button', className:'dvb-btn', onClick(){ clearFramesLog(realCwd, portFilter); } }, t('framesClear')) : null
      ),
      el('div', { className: 'dvb-toolbar' },
        el('select', { className:'dvb-input', value: portFilter, onChange(e){ setPortFilter(e.target.value) } },
          portOptions.map((o)=> el('option', { key:o.value, value:o.value }, o.label))
        ),
        el('select', { className:'dvb-input', value: filters.connectionId, onChange(e){ setFilters((p)=>({...p, connectionId:e.target.value})) } },
          el('option', { value:'' }, '全部连接'), connections.map((c)=> el('option', { key:c.id, value:c.id }, c.name))
        ),
        el('select', { className:'dvb-input', value: filters.deviceId, onChange(e){ setFilters((p)=>({...p, deviceId:e.target.value})) } },
          el('option', { value:'' }, '全部设备'), devices.map((d)=> el('option', { key:d.id, value:d.id }, d.name+' · Unit '+d.unitId))
        ),
        el('select', { className:'dvb-input', value: filters.direction, onChange(e){ setFilters((p)=>({...p, direction:e.target.value})) } },
          el('option', { value:'' }, '全部方向'), el('option', { value:'tx' }, 'TX'), el('option', { value:'rx' }, 'RX')
        ),
        el('select', { className:'dvb-input', value: filters.functionCode, onChange(e){ setFilters((p)=>({...p, functionCode:e.target.value})) } },
          el('option', { value:'' }, '全部功能码'), [1,2,3,4,5,6,15,16].map((fc)=> el('option', { key:String(fc), value:String(fc) }, 'FC'+fc))
        ),
        el('select', { className:'dvb-input', value: filters.status, onChange(e){ setFilters((p)=>({...p, status:e.target.value})) } },
          el('option', { value:'' }, '全部状态'), el('option', { value:'ok' }, '成功'), el('option', { value:'err' }, '失败'), el('option', { value:'timeout' }, '超时')
        )
      ),
      el('div', { className:'dvb-live-search' },
        el('input', { className:'dvb-input', value: search, placeholder: t('serialFilter')||'过滤关键字', onChange(e){ setSearch(e.target.value) } })
      ),
      serial.error ? el('div', { className:'dvb-msg', 'data-kind':'err' }, serial.error) : null,
      copied ? el('div', { className:'dvb-hint' }, '已复制 '+copied) : null,
      !filtered.length ? el('div', { className:'dvb-hint' }, t('framesEmpty')||'暂无报文') : null,
      el('div', { className:'dvb-live-list dvb-frames-virtual', style:{ height: viewportHeight+'px', overflowY:'auto', position:'relative' }, ref: listRef, onScroll: handleScroll },
        el('div', { style:{ height: totalHeight+'px', position:'relative' } },
          virtualItems.map((f, idx) => {
            const fid = f.frameId || f.id || String(f.t||f.at)+':'+idx
            return el('div', { key: fid, className:'dvb-live-row', style:{ position:'absolute', top: (startIndex+idx)*estimateSize+'px', height: estimateSize+'px', left:0, right:0, display:'flex', gap:'6px', alignItems:'center' } },
              el('span', { className:'dvb-map-meta' }, new Date(f.t||f.at||Date.now()).toLocaleTimeString()),
              el('span', { className:'dvb-badge' }, f.direction||'tx'),
              el('span', { className:'dvb-hint', title: f.connectionId||'' }, f.connectionId||''),
              el('span', { className:'dvb-hint' }, f.label||f.request||''),
              el('span', { className:'dvb-badge', 'data-kind': f.status==='ok'?'ready':'err' }, f.status||'ok'),
              el('button', { type:'button', className:'dvb-btn dvb-btn-sm', onClick(){ if(typeof openHmi==='function') try{ openHmi({ connectionId:f.connectionId, deviceId:f.deviceId, frameId:fid }) }catch{} } }, t('openInHmi')||'在上位机打开'),
              el('button', { type:'button', className:'dvb-btn dvb-btn-sm', onClick(){ sendToAgent(f) } }, copied===fid?'已复制':'让 Agent 分析')
            )
          })
        )
      )
  }
}
