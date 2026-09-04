import { getCustomSelect } from '../components/custom-select.mjs'
import { POLL_INTERVALS } from './hmi-ids.mjs'

/** Connection edit form panel. */
export function renderConnectionForm(el, t, ctx) {
  const {
    connForm,
    setConnForm,
    connectionStates,
    field,
    scanning,
    ports,
    findRtuOccupier,
    findTcpOccupier,
    scanPorts,
    cwd,
    saveConnEdit,
  } = ctx
  const CustomSelect = ctx.CustomSelect || getCustomSelect(ctx.React)
  const formLocked =
    !!connForm.open && connectionStates.some((x) => x.connectionId === connForm.id && x.status === 'connected')
  if (!connForm.open) return null
  return el(
    'div',
    { className: 'dvb-panel dvb-write-panel' },
    el(
      'div',
      { className: 'dvb-panel-head' },
      el('span', { className: 'dvb-panel-title' }, '编辑连接 · ' + (connForm.name || connForm.id)),
      formLocked
        ? el('span', { className: 'dvb-hint dvb-need' }, t('connEditLocked') || '连接中不可修改端点参数，请先断开')
        : null,
    ),
    el(
      'div',
      { className: 'dvb-toolbar' },
      field(
        '名称',
        el('input', {
          className: 'dvb-input',
          value: connForm.name,
          onChange: (event) => {
            setConnForm((prev) => ({ ...prev, name: event.target.value }))
          },
        }),
      ),
      field(
        t('role') || '角色',
        el(CustomSelect, {
          value: connForm.role === 'server' || connForm.role === 'slave' ? 'server' : 'client',
          options: [
            { value: 'client', label: '主机(master)' },
            { value: 'server', label: '从机(slave)' },
          ],
          onChange(val) {
            setConnForm((prev) => ({ ...prev, role: val }))
          },
        }),
      ),
      field(
        t('mode'),
        el(CustomSelect, {
          value: connForm.conn.mode || 'rtu',
          disabled: formLocked,
          options: [
            { value: 'rtu', label: 'RTU' },
            { value: 'tcp', label: 'TCP' },
          ],
          onChange(val) {
            setConnForm((prev) => ({ ...prev, conn: { ...prev.conn, mode: val } }))
          },
        }),
      ),
      connForm.role === 'server' || connForm.role === 'slave'
        ? null
        : field(
            t('watchIv') || '采集间隔',
            el(CustomSelect, {
              value: connForm.intervalMs || 1000,
              options: POLL_INTERVALS.map((ms) => ({ value: ms, label: ms + 'ms' })),
              onChange(val) {
                setConnForm((prev) => ({ ...prev, intervalMs: Number(val) }))
              },
            }),
          ),
      connForm.conn.mode === 'rtu'
        ? field(
            t('serial'),
            el(
              'div',
              { className: 'dvb-combo' },
              connForm.customPort
                ? el('input', {
                    className: 'dvb-input dvb-input-mono',
                    value: connForm.conn.port || '',
                    placeholder: '如 COM1 或 /dev/ttyUSB0',
                    spellCheck: false,
                    autoComplete: 'off',
                    disabled: formLocked,
                    onChange(event) {
                      const port = event.target.value
                      setConnForm((prev) => ({ ...prev, conn: { ...prev.conn, port } }))
                    },
                  })
                : (() => {
                    const STANDARD_COM_PORTS = Array.from({ length: 20 }, (_, i) => `COM${i + 1}`)
                    const scannedPaths = new Set(ports.map((item) => item.path))
                    const portOptions = [
                      {
                        value: '',
                        label: scanning ? t('serialScanning') || '扫描中…' : t('serialPick') || '选择串口',
                      },
                      ...ports.map((item) => {
                        const occupier = findRtuOccupier(item.path, connForm.id)
                        return {
                          value: item.path,
                          label: (item.label || item.path) + (occupier ? ' · 已被 ' + occupier + ' 占用' : ''),
                          disabled: !!occupier,
                          title: occupier ? '已被 ' + occupier + ' 占用' : '',
                        }
                      }),
                    ]
                    if (
                      connForm.conn.port &&
                      !scannedPaths.has(connForm.conn.port) &&
                      !STANDARD_COM_PORTS.includes(connForm.conn.port)
                    ) {
                      const occupier = findRtuOccupier(connForm.conn.port, connForm.id)
                      portOptions.push({
                        value: connForm.conn.port,
                        label: connForm.conn.port + (occupier ? ' · 已被 ' + occupier + ' 占用' : ''),
                        disabled: !!occupier,
                        title: occupier ? '已被 ' + occupier + ' 占用' : '',
                      })
                    }
                    STANDARD_COM_PORTS.forEach((name) => {
                      if (scannedPaths.has(name) || (connForm.conn.port && connForm.conn.port === name)) return
                      const occupier = findRtuOccupier(name, connForm.id)
                      portOptions.push({
                        value: name,
                        label: name + (occupier ? ' · 已被 ' + occupier + ' 占用' : ''),
                        disabled: !!occupier,
                        title: occupier ? '已被 ' + occupier + ' 占用' : '',
                      })
                    })
                    portOptions.push({
                      value: '__custom__',
                      label: '✎ 手动输入其他串口...',
                    })
                    return el(CustomSelect, {
                      className: 'dvb-input-mono',
                      value: connForm.conn.port || '',
                      disabled: scanning || formLocked,
                      placeholder: scanning ? t('serialScanning') || '扫描中…' : t('serialPick') || '选择串口',
                      options: portOptions,
                      onChange(val) {
                        if (val === '__custom__') {
                          setConnForm((prev) => ({ ...prev, customPort: true }))
                        } else {
                          setConnForm((prev) => ({ ...prev, conn: { ...prev.conn, port: val } }))
                        }
                      },
                    })
                  })(),
              connForm.customPort
                ? el(
                    'button',
                    {
                      type: 'button',
                      className: 'dvb-btn',
                      disabled: formLocked,
                      title: '从串口列表选择',
                      onClick() {
                        setConnForm((prev) => ({ ...prev, customPort: false }))
                      },
                    },
                    '列表选择',
                  )
                : null,
              el(
                'button',
                {
                  type: 'button',
                  className: 'dvb-btn',
                  disabled: scanning || formLocked,
                  onClick: scanPorts,
                },
                t('serialScan'),
              ),
              (() => {
                const occupier = findRtuOccupier(connForm.conn.port, connForm.id)
                return occupier
                  ? el(
                      'span',
                      { className: 'dvb-need', title: '已被 ' + occupier + ' 占用' },
                      '已被 ' + occupier + ' 占用',
                    )
                  : null
              })(),
            ),
          )
        : field(
            t('host'),
            el(
              'div',
              { className: 'dvb-combo' },
              el('input', {
                className: 'dvb-input dvb-input-mono',
                value: connForm.conn.host || '',
                placeholder:
                  connForm.role === 'server' || connForm.role === 'slave'
                    ? t('hostPhServer') || '0.0.0.0 (监听全部网卡)'
                    : t('hostPh') || '192.168.1.10',
                spellCheck: false,
                autoComplete: 'off',
                disabled: formLocked,
                onChange: (event) => {
                  const host = event.target.value
                  setConnForm((prev) => ({ ...prev, conn: { ...prev.conn, host } }))
                },
              }),
              el('input', {
                className: 'dvb-input dvb-input-mono',
                value: connForm.conn.tcpPort || 502,
                type: 'number',
                style: { width: '80px', flex: 'none' },
                disabled: formLocked,
                onChange: (event) => {
                  setConnForm((prev) => ({ ...prev, conn: { ...prev.conn, tcpPort: Number(event.target.value) } }))
                },
              }),
              (() => {
                const occupier = findTcpOccupier(connForm.conn.host, connForm.conn.tcpPort, connForm.id)
                return occupier
                  ? el(
                      'span',
                      { className: 'dvb-need', title: '已被 ' + occupier + ' 占用' },
                      '已被 ' + occupier + ' 占用',
                    )
                  : null
              })(),
            ),
          ),
      field(
        t('baudrate'),
        el('input', {
          className: 'dvb-input dvb-input-mono',
          type: 'number',
          value: connForm.conn.baudrate || 9600,
          disabled: formLocked,
          onChange: (event) => {
            setConnForm((prev) => ({ ...prev, conn: { ...prev.conn, baudrate: Number(event.target.value) } }))
          },
        }),
      ),
      field(
        t('databits'),
        el(CustomSelect, {
          value: Number(connForm.conn.bytesize) === 7 ? 7 : 8,
          disabled: formLocked,
          options: [
            { value: 8, label: '8' },
            { value: 7, label: '7' },
          ],
          onChange(val) {
            setConnForm((prev) => ({ ...prev, conn: { ...prev.conn, bytesize: Number(val) } }))
          },
        }),
      ),
      field(
        t('parityBit'),
        el(CustomSelect, {
          value: connForm.conn.parity || 'N',
          disabled: formLocked,
          options: [
            { value: 'N', label: 'N' },
            { value: 'E', label: 'E' },
            { value: 'O', label: 'O' },
          ],
          onChange(val) {
            setConnForm((prev) => ({ ...prev, conn: { ...prev.conn, parity: val } }))
          },
        }),
      ),
      field(
        t('stopbit'),
        el(CustomSelect, {
          value: Number(connForm.conn.stopbits) === 2 ? 2 : 1,
          disabled: formLocked,
          options: [
            { value: 1, label: '1' },
            { value: 2, label: '2' },
          ],
          onChange(val) {
            setConnForm((prev) => ({ ...prev, conn: { ...prev.conn, stopbits: Number(val) } }))
          },
        }),
      ),
      field(
        t('sim'),
        el(
          'div',
          { style: { display: 'flex', alignItems: 'center', height: '32px' } },
          el(
            'button',
            {
              id: 'conn-sim-switch',
              type: 'button',
              role: 'switch',
              'aria-checked': !!connForm.conn.sim ? 'true' : 'false',
              'aria-label': t('sim') || '仿真',
              className: 'dvb-setting-switch',
              'data-checked': !!connForm.conn.sim ? 'true' : 'false',
              style: {
                width: '36px',
                height: '20px',
                flex: 'none',
                margin: 0,
                border: 0,
                padding: '2px',
                borderRadius: '999px',
                backgroundColor: !!connForm.conn.sim ? '#0f1115' : '#e5e5e5',
                cursor: 'pointer',
                position: 'relative',
                boxSizing: 'border-box',
                display: 'inline-flex',
                alignItems: 'center',
                transition: 'background-color .16s ease, opacity .16s ease',
                outline: 'none',
              },
              onClick(e) {
                e.preventDefault()
                setConnForm((prev) => ({ ...prev, conn: { ...prev.conn, sim: !prev.conn.sim } }))
              },
              onKeyDown(e) {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault()
                  setConnForm((prev) => ({ ...prev, conn: { ...prev.conn, sim: !prev.conn.sim } }))
                }
              },
            },
            el('span', {
              className: 'dvb-setting-switch-thumb',
              style: {
                display: 'block',
                width: '16px',
                height: '16px',
                borderRadius: '50%',
                backgroundColor: '#ffffff',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                transform: !!connForm.conn.sim ? 'translateX(16px)' : 'translateX(0)',
                transition: 'transform .16s ease',
                pointerEvents: 'none',
              },
            }),
          ),
        ),
      ),
    ),
    el(
      'div',
      { className: 'dvb-actions' },
      el(
        'button',
        { type: 'button', className: 'dvb-btn dvb-btn-primary', disabled: !cwd, onClick: saveConnEdit },
        t('connSave') || t('save') || '保存配置',
      ),
      el(
        'button',
        {
          type: 'button',
          className: 'dvb-btn',
          onClick() {
            setConnForm((prev) => ({ ...prev, open: false }))
          },
        },
        t('csvCancel'),
      ),
    ),
  )
}
