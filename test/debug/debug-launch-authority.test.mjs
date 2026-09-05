// @ts-check
import assert from 'node:assert/strict'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { computeFileSha256, resolveDebugLaunchSpec } from '../../src/application/debug/debug-launch-spec-service.mjs'
import { DEBUG_ERRORS, DebugError } from '../../src/domain/debug/errors.mjs'

test('PR-3: LaunchSpec authority: prioritizes workspace project/target, bindings, and BuildResult', async () => {
  const testDir = join(tmpdir(), `launch_auth_${Date.now()}`)
  await mkdir(testDir, { recursive: true })
  const mockAxf = join(testDir, 'firmware.axf')
  await writeFile(mockAxf, Buffer.from('BINARY_PAYLOAD_V1'))
  const shaV1 = computeFileSha256(mockAxf)

  try {
    // 1. Mock workspace and bindings
    const mockWorkspace = {
      keil: {
        project: join(testDir, 'Project.uvprojx'),
        target: 'STM32F407_Flash',
        download: mockAxf,
        flash: {
          interface: 'stlink',
          target: 'stm32f4x',
        },
        buildResult: {
          projectPath: join(testDir, 'Project.uvprojx'),
          targetName: 'STM32F407_Flash',
          artifactPath: mockAxf,
          artifactSha256: shaV1,
          builtAt: Date.now() - 1000,
          success: true,
        },
      },
      tasks: [],
    }

    const mockBindings = {
      openocd: '/opt/custom/bin/openocd',
      gdb: '/opt/custom/bin/arm-none-eabi-gdb',
      uv4: 'C:\\Keil_v5\\UV4\\UV4.exe',
    }

    const resolved = await resolveDebugLaunchSpec(
      {
        cwd: testDir,
        sessionId: 'user-1',
        backend: 'gdb-openocd',
        targetSpec: {}, // empty: test auto-resolution authority
      },
      {
        loadWorkspace: () => mockWorkspace,
        loadBindings: () => mockBindings,
        portAllocator: async () => 4444,
      },
    )

    assert.equal(resolved.source, 'auto-resolved')
    assert.equal(resolved.resolutionMethod, 'build-result')
    assert.equal(resolved.projectPath, join(testDir, 'Project.uvprojx'))
    assert.equal(resolved.targetName, 'STM32F407_Flash')
    assert.equal(resolved.targetSpec.artifactPath, mockAxf)
    assert.equal(resolved.targetSpec.artifactSha256, shaV1)
    assert.equal(resolved.targetSpec.openocdBin, '/opt/custom/bin/openocd')
    assert.equal(resolved.targetSpec.gdbBin, '/opt/custom/bin/arm-none-eabi-gdb')
    assert.equal(resolved.targetSpec.interfaceName, 'stlink')
    assert.equal(resolved.targetSpec.target, 'stm32f4x')
    assert.equal(resolved.targetSpec.gdbPort, 4444)

    // Verify canonical domain spec shape
    assert.ok(resolved.spec)
    assert.equal(resolved.spec.backend, 'gdb-openocd')
    assert.equal(resolved.spec.workspace.cwd, testDir)
    assert.equal(resolved.spec.project.path, join(testDir, 'Project.uvprojx'))
    assert.equal(resolved.spec.project.targetName, 'STM32F407_Flash')
    assert.equal(resolved.spec.artifact.path, mockAxf)
    assert.equal(resolved.spec.artifact.sha256, shaV1)
    assert.equal(resolved.spec.tools.openocdBin, '/opt/custom/bin/openocd')
    assert.equal(resolved.spec.hardware.interfaceName, 'stlink')
    assert.equal(resolved.spec.hardware.openocdTarget, 'stm32f4x')
    assert.equal(resolved.spec.transport.gdbPort, 4444)
  } finally {
    await rm(testDir, { recursive: true, force: true }).catch(() => {})
  }
})

test('PR-3: LaunchSpec authority: detects DEBUG_ARTIFACT_DRIFT when artifact changed after build', async () => {
  const testDir = join(tmpdir(), `launch_drift_${Date.now()}`)
  await mkdir(testDir, { recursive: true })
  const mockAxf = join(testDir, 'firmware.axf')
  await writeFile(mockAxf, Buffer.from('BINARY_PAYLOAD_V1'))
  const shaV1 = computeFileSha256(mockAxf)

  // Modify file on disk to simulate drift
  await writeFile(mockAxf, Buffer.from('BINARY_PAYLOAD_MODIFIED_WITHOUT_REBUILD'))

  try {
    const mockWorkspace = {
      keil: {
        project: join(testDir, 'Project.uvprojx'),
        target: 'Debug',
        download: mockAxf,
        buildResult: {
          projectPath: join(testDir, 'Project.uvprojx'),
          targetName: 'Debug',
          artifactPath: mockAxf,
          artifactSha256: shaV1, // Stored hash represents build-time state
          builtAt: Date.now() - 5000,
          success: true,
        },
      },
    }

    await assert.rejects(
      async () => {
        await resolveDebugLaunchSpec(
          {
            cwd: testDir,
            sessionId: 'user-1',
            backend: 'gdb-openocd',
          },
          {
            loadWorkspace: () => mockWorkspace,
            loadBindings: () => ({}),
          },
        )
      },
      (err) => {
        assert.ok(err instanceof DebugError)
        assert.equal(err.code, DEBUG_ERRORS.ARTIFACT_DRIFT)
        assert.match(err.message, /固件产物已发生变更/)
        assert.equal(err.details.storedSha256, shaV1)
        assert.ok(err.details.currentSha256)
        return true
      },
    )
  } finally {
    await rm(testDir, { recursive: true, force: true }).catch(() => {})
  }
})

test('PR-3: LaunchSpec authority: rejects invalid OpenOCD interface or target using shared profile', async () => {
  await assert.rejects(
    async () => {
      await resolveDebugLaunchSpec({
        cwd: tmpdir(),
        sessionId: 'user-1',
        backend: 'gdb-openocd',
        targetSpec: {
          artifactSha256: 'mock_sha',
          interfaceName: 'dangerous; rm -rf /',
        },
      })
    },
    (err) => {
      assert.ok(err instanceof DebugError)
      assert.equal(err.code, DEBUG_ERRORS.TARGET_SPEC_INVALID)
      assert.match(err.message, /interface 不在白名单内/)
      return true
    },
  )
})
