// @ts-check
import assert from 'node:assert/strict'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  findFirmwareArtifacts,
  resolveDebugLaunchSpec,
} from '../../src/application/debug/debug-launch-spec-service.mjs'

test('debug launch spec: auto-detects .axf in Objects directory and computes hash', async () => {
  const testDir = join(tmpdir(), `launch_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`)
  const objectsDir = join(testDir, 'Objects')
  await mkdir(objectsDir, { recursive: true })

  const fakeFirmware = join(objectsDir, 'template.axf')
  await writeFile(fakeFirmware, Buffer.from('ARM ELF TEST HEADER'))

  try {
    const found = findFirmwareArtifacts(testDir)
    assert.equal(found.length, 1)
    assert.equal(found[0], fakeFirmware)

    const resolved = await resolveDebugLaunchSpec({
      cwd: testDir,
      sessionId: 'sess_1',
    })

    assert.equal(resolved.backend, 'gdb-openocd')
    assert.equal(resolved.source, 'auto-resolved')
    assert.equal(resolved.targetSpec.artifactPath, fakeFirmware)
    assert.ok(resolved.targetSpec.artifactSha256.length > 0)
    assert.ok(resolved.targetSpec.gdbPort > 1024)
    assert.equal(resolved.targetSpec.interfaceName, 'cmsis-dap')
    assert.equal(resolved.targetSpec.target, 'stm32f1x')
  } finally {
    await rm(testDir, { recursive: true, force: true }).catch(() => {})
  }
})

test('debug launch spec: fails with actionable error message if no firmware exists', async () => {
  const emptyDir = join(tmpdir(), `empty_proj_${Date.now()}`)
  await mkdir(emptyDir, { recursive: true })

  try {
    await assert.rejects(
      () =>
        resolveDebugLaunchSpec({
          cwd: emptyDir,
          sessionId: 'sess_1',
        }),
      /未在工作区找到固件产物/,
    )
  } finally {
    await rm(emptyDir, { recursive: true, force: true }).catch(() => {})
  }
})

test('debug launch spec: respects explicit targetSpec parameters if provided', async () => {
  const dummyFile = join(tmpdir(), `explicit_${Date.now()}.elf`)
  await writeFile(dummyFile, 'ELF HEADER')

  try {
    const resolved = await resolveDebugLaunchSpec({
      cwd: tmpdir(),
      sessionId: 'sess_1',
      backend: 'gdb-openocd',
      targetSpec: {
        artifactPath: dummyFile,
        interfaceName: 'stlink',
        target: 'stm32f4x',
        gdbPort: 3344,
        probeSerial: '066EFF52',
      },
    })

    assert.equal(resolved.source, 'explicit')
    assert.equal(resolved.targetSpec.interfaceName, 'stlink')
    assert.equal(resolved.targetSpec.target, 'stm32f4x')
    assert.equal(resolved.targetSpec.gdbPort, 3344)
    assert.equal(resolved.targetSpec.probeSerial, '066EFF52')
  } finally {
    await rm(dummyFile, { force: true }).catch(() => {})
  }
})
