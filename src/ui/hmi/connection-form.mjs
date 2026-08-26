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
  const formLocked =
    !!connForm.open && connectionStates.some((x) => x.connectionId === connForm.id && x.status === 'connected')
  if (!connForm.open) return null
  return el(
    'div',
    { className: 'dvb-panel dvb-write-panel' },
    el(
      'div',
      { className: 'dvb-panel-head' },
      el('span', { className: 'dvb-panel-title' }, '编辑连接 · ' + connForm.id),
      formLocked
        ? el('span', { className: 'dvb-hint dvb-need' }, t('connEditLocked') || '连接中不可修改端点参数，请先断开')
        : null,
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
        el(
          'select',
          {
            className: 'dvb-input',
            value: connForm.role === 'server' || connForm.role === 'slave' ? 'server' : 'client',
            onChange: (event) => {
              setConnForm((prev) => ({ ...prev, role: event.target.value }))
            },
          },
          el('option', { value: 'client' }, '主机(master)'),
          el('option', { value: 'server', disabled: true, title: '从机模式暂未启用' }, '从机(未启用)'),
        ),
      ),
      field(
        t('mode'),
        el(
          'select',
          {
            className: 'dvb-input',
            value: connForm.conn.mode || 'rtu',
            disabled: formLocked,
            onChange: (event) => {
              setConnForm((prev) => ({ ...prev, conn: { ...prev.conn, mode: event.target.value } }))
            },
          },
          el('option', { value: 'rtu' }, 'RTU'),
          el('option', { value: 'tcp' }, 'TCP'),
        ),
      ),
      connForm.conn.mode === 'rtu'
        ? field(
            t('serial'),
            el(
              'div',
              { className: 'dvb-combo' },
              el(
                'select',
                {
                  className: 'dvb-input dvb-input-mono',
                  value: connForm.conn.port || '',
                  disabled: scanning || formLocked,
                  onChange: (event) => {
                    setConnForm((prev) => ({ ...prev, conn: { ...prev.conn, port: event.target.value } }))
                  },
                },
                el(
                  'option',
                  { value: '' },
                  scanning ? t('serialScanning') : ports.length ? t('serialPick') : t('serialNone'),
                ),
                connForm.conn.port && !ports.some((item) => item.path === connForm.conn.port)
                  ? el('option', { value: connForm.conn.port }, connForm.conn.port + ' · ' + t('serialGone'))
                  : null,
                ports.map((item) => {
                  const occupier = findRtuOccupier(item.path, connForm.id)
                  return el(
                    'option',
                    {
                      key: item.path,
                      value: item.path,
                      disabled: !!occupier,
                      title: occupier ? '已被 ' + occupier + ' 占用' : '',
                    },
                    (item.label || item.path) + (occupier ? ' · 已被 ' + occupier + ' 占用' : ''),
                  )
                }),
              ),
              el(
                'button',
                {
                  type: 'button',
                  className: 'dvb-btn',
                  disabled: scanning,
                  title: t('serialScan'),
                  onClick: scanPorts,
                },
                t('serialScan'),
              ),
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
                placeholder: t('hostPh') || '192.168.1.10',
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
        el(
          'select',
          {
            className: 'dvb-input',
            value: String(connForm.conn.bytesize || 8),
            disabled: formLocked,
            onChange: (event) => {
              setConnForm((prev) => ({ ...prev, conn: { ...prev.conn, bytesize: Number(event.target.value) } }))
            },
          },
          el('option', { value: '8' }, '8'),
          el('option', { value: '7' }, '7'),
        ),
      ),
      field(
        t('parityBit'),
        el(
          'select',
          {
            className: 'dvb-input',
            value: connForm.conn.parity || 'N',
            disabled: formLocked,
            onChange: (event) => {
              setConnForm((prev) => ({ ...prev, conn: { ...prev.conn, parity: event.target.value } }))
            },
          },
          el('option', { value: 'N' }, 'N'),
          el('option', { value: 'E' }, 'E'),
          el('option', { value: 'O' }, 'O'),
        ),
      ),
      field(
        t('stopbit'),
        el(
          'select',
          {
            className: 'dvb-input',
            value: String(connForm.conn.stopbits || 1),
            disabled: formLocked,
            onChange: (event) => {
              setConnForm((prev) => ({ ...prev, conn: { ...prev.conn, stopbits: Number(event.target.value) } }))
            },
          },
          el('option', { value: '1' }, '1'),
          el('option', { value: '2' }, '2'),
        ),
      ),
      field(
        t('sim'),
        el(
          'label',
          { style: { display: 'flex', gap: '4px', alignItems: 'center' } },
          el('input', {
            type: 'checkbox',
            checked: !!connForm.conn.sim,
            onChange: (event) => {
              setConnForm((prev) => ({ ...prev, conn: { ...prev.conn, sim: event.target.checked } }))
            },
          }),
          t('simHint') || '仿真',
        ),
      ),
    ),
    el(
      'div',
      { className: 'dvb-actions' },
      el(
        'button',
        { type: 'button', className: 'dvb-btn dvb-btn-primary', disabled: !cwd, onClick: saveConnEdit },
        t('savePoint') || '保存',
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
