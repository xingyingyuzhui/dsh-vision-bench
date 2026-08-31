import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildOpenOcdArgs,
  encodeOpenOcdTclPath,
  encodeOpenOcdTclWord,
  parseOpenOcdResult,
  probeOpenOcdExecutable,
  runOpenOcdFlash,
} from '../src/infrastructure/process/openocd-runner.mjs'

const OCD_VERSION = 'Open On-Chip Debugger 0.12.0\nLicensed under GNU GPL v2\n'
const OCD_FLASH_OK = [
  'Open On-Chip Debugger 0.12.0',
  'Info : wrote 2048 bytes from file app.hex',
  'verified',
  'shutdown command invoked',
].join('\n')

const execOpenOcd =
  (flash = {}) =>
  async (_bin, args) => {
    if (args && args.includes('--version')) {
      return { exitCode: 0, stdout: '', stderr: OCD_VERSION, timedOut: false, cancelled: false }
    }
    return {
      exitCode: 0,
      stdout: OCD_FLASH_OK,
      stderr: '',
      timedOut: false,
      cancelled: false,
      ...flash,
    }
  }

test('Tcl double-quote encoding keeps braces/semicolons and escapes substitutions', () => {
  const a = encodeOpenOcdTclWord('C:\\Program Files\\OpenOCD\\bin\\openocd.exe')
  assert.equal(a.encoded, '"C:/Program Files/OpenOCD/bin/openocd.exe"')
  const b = encodeOpenOcdTclPath('C:\\Firmware Builds\\app.hex')
  assert.equal(b.encoded, '"C:/Firmware Builds/app.hex"')
  const paren = encodeOpenOcdTclPath('C:\\ws\\(board)\\app.hex')
  assert.equal(paren.encoded, '"C:/ws/(board)/app.hex"')
  const braces = encodeOpenOcdTclPath('C:\\ws\\{board}\\app.hex')
  assert.equal(braces.encoded, '"C:/ws/{board}/app.hex"')
  const dollar = encodeOpenOcdTclPath('C:\\ws\\$board\\app.hex')
  assert.equal(dollar.encoded, '"C:/ws/\\$board/app.hex"')
  const subst = encodeOpenOcdTclPath('C:\\ws\\[board]\\app.hex')
  assert.equal(subst.encoded, '"C:/ws/\\[board\\]/app.hex"')
  const semi = encodeOpenOcdTclPath('C:\\ws\\semi;colon\\app.hex')
  assert.equal(semi.encoded, '"C:/ws/semi;colon/app.hex"')
  const quoted = encodeOpenOcdTclWord('C:/ws/"board"/app.hex')
  assert.equal(quoted.encoded, '"C:/ws/\\"board\\"/app.hex"')
  assert.equal(encodeOpenOcdTclPath('C:/a\nb.hex').ok, false)
  assert.equal(encodeOpenOcdTclPath('C:/a\u0000b.hex').ok, false)
})

test('buildOpenOcdArgs uses execFile argv and quoted firmware path', () => {
  const ran = buildOpenOcdArgs({
    interfaceName: 'stlink',
    target: 'stm32f4x',
    firmware: 'C:\\Firmware Builds\\{board}\\app.hex',
  })
  assert.equal(ran.ok, true)
  assert.deepEqual(ran.args, [
    '-f',
    'interface/stlink.cfg',
    '-f',
    'target/stm32f4x.cfg',
    '-c',
    'program "C:/Firmware Builds/{board}/app.hex" verify reset exit',
  ])
  const inject = buildOpenOcdArgs({
    interfaceName: 'stlink',
    target: 'stm32f4x',
    firmware: 'C:/ws/probe[shutdown]/app.hex',
  })
  assert.equal(inject.ok, true)
  assert.equal(inject.args.at(-1), 'program "C:/ws/probe\\[shutdown\\]/app.hex" verify reset exit')
  assert.equal(inject.args.at(-1).includes('probe[shutdown]'), false)
  const execInject = buildOpenOcdArgs({
    interfaceName: 'stlink',
    target: 'stm32f4x',
    firmware: 'C:/ws/probe[exec evil]/app.hex',
  })
  assert.equal(execInject.args.at(-1), 'program "C:/ws/probe\\[exec evil\\]/app.hex" verify reset exit')
  assert.equal(execInject.args.at(-1).includes('probe[exec'), false)
})

test('interface/target path traversal and extra Tcl is rejected', () => {
  const trav = buildOpenOcdArgs({ interfaceName: '../passwd', target: 'stm32f4x', firmware: 'a.hex' })
  assert.equal(trav.ok, false)
  const abs = buildOpenOcdArgs({ interfaceName: '/tmp/x', target: 'stm32f4x', firmware: 'a.hex' })
  assert.equal(abs.ok, false)
  const semi = buildOpenOcdArgs({
    interfaceName: 'stlink.cfg; -c shutdown',
    target: 'stm32f4x',
    firmware: 'a.hex',
  })
  assert.equal(semi.ok, false)
  const tgt = buildOpenOcdArgs({ interfaceName: 'stlink', target: 'stm32f4x; -c exit', firmware: 'a.hex' })
  assert.equal(tgt.ok, false)
})

test('probeOpenOcdExecutable requires OpenOCD identity, not exit 0', async () => {
  const ok = await probeOpenOcdExecutable('/opt/openocd', {
    runExecFile: async () => ({ exitCode: 1, stdout: '', stderr: OCD_VERSION, timedOut: false, cancelled: false }),
  })
  assert.equal(ok.ok, true)
  assert.match(ok.versionLine, /Open On-Chip Debugger/)

  const nodeish = await probeOpenOcdExecutable('/usr/bin/node', {
    runExecFile: async () => ({ exitCode: 0, stdout: 'v20.11.0\n', stderr: '', timedOut: false, cancelled: false }),
  })
  assert.equal(nodeish.ok, false)
  assert.equal(nodeish.errorCode, 'OPENOCD_IDENTITY_INVALID')

  const echoish = await probeOpenOcdExecutable('/bin/echo', {
    runExecFile: async () => ({ exitCode: 0, stdout: 'hello\n', stderr: '', timedOut: false, cancelled: false }),
  })
  assert.equal(echoish.ok, false)
  assert.equal(echoish.errorCode, 'OPENOCD_IDENTITY_INVALID')

  const timed = await probeOpenOcdExecutable('/opt/openocd', {
    runExecFile: async () => ({ exitCode: 1, timedOut: true, cancelled: false, stdout: '', stderr: '' }),
  })
  assert.equal(timed.errorCode, 'OPENOCD_PROBE_TIMEOUT')

  const missing = await probeOpenOcdExecutable('/nope', {
    runExecFile: async () => {
      throw new Error('无法启动: /nope')
    },
  })
  assert.equal(missing.errorCode, 'OPENOCD_NOT_FOUND')
})

test('parseOpenOcdResult requires identity, program evidence and shutdown', () => {
  assert.equal(parseOpenOcdResult({ cancelled: true, stdout: '', stderr: '' }).errorCode, 'FLASH_CANCELLED')
  const timeout = parseOpenOcdResult({ timedOut: true, stdout: '', stderr: 'hang' }, { timeoutMs: 80000 })
  assert.equal(timeout.errorCode, 'FLASH_TIMEOUT')
  assert.equal(timeout.error, '烧录超时（80s）')
  const fail = parseOpenOcdResult({ exitCode: 1, stdout: 'a\nerror: probe fail\n', stderr: '' })
  assert.equal(fail.errorCode, 'FLASH_FAILED')
  assert.equal(parseOpenOcdResult({ exitCode: 0, stdout: 'hello', stderr: '' }).ok, false)
  assert.equal(parseOpenOcdResult({ exitCode: 0, stdout: '', stderr: '' }).errorCode, 'FLASH_RESULT_UNVERIFIED')
  assert.equal(parseOpenOcdResult({ exitCode: 0, stdout: OCD_VERSION, stderr: '' }).ok, false)
  assert.equal(
    parseOpenOcdResult({
      exitCode: 0,
      stdout: 'Open On-Chip Debugger 0.12.0\nverified\n',
      stderr: '',
    }).ok,
    false,
  )
  const ok = parseOpenOcdResult({ exitCode: 0, stdout: OCD_FLASH_OK, stderr: '' })
  assert.equal(ok.ok, true)
  assert.equal(ok.summary, '烧录完成')
})

test('runOpenOcdFlash probes identity then flashes with argv only', async () => {
  const seen = []
  const ran = await runOpenOcdFlash(
    {
      openocd: 'C:\\Program Files\\OpenOCD\\bin\\openocd.exe',
      interfaceName: 'cmsis-dap',
      target: 'stm32f1x',
      firmware: 'C:\\ws\\(board)\\app.hex',
      cwd: 'C:\\ws\\(board)',
    },
    {
      runExecFile: async (bin, args) => {
        seen.push({ bin, args })
        return execOpenOcd()(bin, args)
      },
    },
  )
  assert.equal(ran.ok, true)
  assert.equal(seen.length, 2)
  assert.deepEqual(seen[0].args, ['--version'])
  assert.equal(seen[1].bin, 'C:\\Program Files\\OpenOCD\\bin\\openocd.exe')
  assert.ok(Array.isArray(seen[1].args))
  assert.match(seen[1].args.at(-1), /program "C:\/ws\/\(board\)\/app.hex" verify reset exit/)
})

test('runOpenOcdFlash rejects echo/node success and maps timeout/cancel', async () => {
  const echo = await runOpenOcdFlash(
    { openocd: '/bin/echo', interfaceName: 'stlink', target: 'stm32f4x', firmware: 'a.hex' },
    {
      runExecFile: async () => ({ exitCode: 0, stdout: 'hello', stderr: '', timedOut: false, cancelled: false }),
    },
  )
  assert.equal(echo.ok, false)
  assert.equal(echo.errorCode, 'OPENOCD_IDENTITY_INVALID')

  const emptyFlash = await runOpenOcdFlash(
    { openocd: '/opt/openocd', interfaceName: 'stlink', target: 'stm32f4x', firmware: 'a.hex' },
    { runExecFile: execOpenOcd({ stdout: '', stderr: '' }) },
  )
  assert.equal(emptyFlash.ok, false)
  assert.equal(emptyFlash.errorCode, 'FLASH_RESULT_UNVERIFIED')
  assert.notEqual(emptyFlash.summary, '烧录完成')

  const boom = await runOpenOcdFlash(
    { openocd: '/nope', interfaceName: 'stlink', target: 'stm32f4x', firmware: 'a.hex' },
    {
      runExecFile: async () => {
        throw new Error('无法启动: /nope')
      },
    },
  )
  assert.equal(boom.ok, false)
  assert.match(boom.error, /无法启动/)

  const timeout = await runOpenOcdFlash(
    { openocd: 'openocd', interfaceName: 'stlink', target: 'stm32f4x', firmware: 'a.hex', timeoutMs: 150000 },
    { runExecFile: execOpenOcd({ exitCode: 1, timedOut: true, stdout: '', stderr: '' }) },
  )
  assert.equal(timeout.timedOut, true)
  assert.equal(timeout.error, '烧录超时（150s）')

  const cancelled = await runOpenOcdFlash(
    { openocd: 'openocd', interfaceName: 'stlink', target: 'stm32f4x', firmware: 'a.hex' },
    { runExecFile: execOpenOcd({ exitCode: 1, cancelled: true, stdout: '', stderr: '' }) },
  )
  assert.equal(cancelled.cancelled, true)
})
