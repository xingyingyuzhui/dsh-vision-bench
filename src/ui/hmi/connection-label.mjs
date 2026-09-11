/** Endpoint shown after the connection name (COM / TCP / 仿真). */
export function connEndpointLabel(c) {
  const cc = c?.conn || {}
  if (cc.sim || c?.sim) return '仿真'
  if (cc.mode === 'tcp') {
    if (c.role === 'server' || c.role === 'slave') return 'Listen :' + (cc.tcpPort || 502)
    return (cc.host || 'TCP') + ':' + (cc.tcpPort || 502)
  }
  return cc.port || '—'
}

/** Secondary-tab / section title: 连接名 · COM号 */
export function connTabLabel(c) {
  if (!c) return ''
  return String(c.name || '') + ' · ' + connEndpointLabel(c)
}
