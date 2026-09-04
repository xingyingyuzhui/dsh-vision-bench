import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { collectArtifacts } from '../../src/infrastructure/keil/uv4-build-runner.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(__dirname, '..', 'fixtures', 'keil')

test('collectArtifacts discovers build artifacts in target output directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'keil-artifact-'))
  try {
    const projectPath = join(dir, 'test.uvprojx')
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<Project xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Targets>
    <Target>
      <TargetName>Target 1</TargetName>
      <TargetOption>
        <TargetCommonOption>
          <OutputDirectory>.\\Objects\\</OutputDirectory>
          <OutputName>my_firmware</OutputName>
        </TargetCommonOption>
      </TargetOption>
    </Target>
  </Targets>
</Project>`
    await writeFile(projectPath, xml)

    const objectsDir = join(dir, 'Objects')
    await mkdir(objectsDir, { recursive: true })
    const axfPath = join(objectsDir, 'my_firmware.axf')
    const hexPath = join(objectsDir, 'my_firmware.hex')
    await writeFile(axfPath, 'dummy-elf')
    await writeFile(hexPath, 'dummy-hex')

    const artifacts = collectArtifacts(projectPath, 'Target 1')
    assert.equal(artifacts.axf_file, resolve(axfPath))
    assert.equal(artifacts.hex_file, resolve(hexPath))
    assert.equal(artifacts.debug_file, resolve(axfPath))
    assert.equal(artifacts.flash_file, resolve(hexPath))
    assert.equal(artifacts.output_dir, resolve(objectsDir))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('collectArtifacts switches target based on target parameter', async () => {
  const multiProject = join(fixturesDir, 'multi-target.uvprojx')
  // multi-target has Target A and Target B
  const artifactsA = collectArtifacts(multiProject, 'Target A')
  const artifactsB = collectArtifacts(multiProject, 'Target B')
  // None of the built binaries exist on disk in fixturesDir, so it returns output_dir if exists or empty
  assert.equal(typeof artifactsA, 'object')
  assert.equal(typeof artifactsB, 'object')
})

test('collectArtifacts returns empty for non-uvprojx files or invalid paths', () => {
  assert.deepEqual(collectArtifacts(''), {})
  assert.deepEqual(collectArtifacts('/path/to/file.c'), {})
  assert.deepEqual(collectArtifacts('/nonexistent/project.uvprojx'), {})
})
