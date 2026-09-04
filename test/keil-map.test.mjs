import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { keilMap } from '../bench-actions.mjs'
import { saveBindings, saveWorkspace } from '../bench-store.mjs'
import { runVisionBench } from '../bench-tool.mjs'
import { mapProject } from '../src/application/keil/project-service.mjs'

const UVPROJX = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<Project>
  <Targets>
    <Target>
      <TargetName>Debug</TargetName>
      <TargetOption>
        <TargetArmAds>
          <Cads>
            <VariousControls>
              <IncludePath>inc;../outside</IncludePath>
              <Define>USE_STDPERIPH_DRIVER,STM32F10X_HD</Define>
            </VariousControls>
          </Cads>
        </TargetArmAds>
      </TargetOption>
      <Groups>
        <Group>
          <GroupName>Source</GroupName>
          <Files>
            <File>
              <FileName>main.c</FileName>
              <FileType>1</FileType>
              <FilePath>src/main.c</FilePath>
            </File>
            <File>
              <FileName>missing.c</FileName>
              <FileType>1</FileType>
              <FilePath>src/missing.c</FilePath>
            </File>
            <File>
              <FileName>secret.c</FileName>
              <FileType>1</FileType>
              <FilePath>src/secret.c</FilePath>
            </File>
          </Files>
        </Group>
      </Groups>
    </Target>
  </Targets>
</Project>
`

async function makeProject(root) {
  const cwd = join(root, 'board')
  await mkdir(join(cwd, 'src'), { recursive: true })
  await mkdir(join(cwd, 'inc'), { recursive: true })
  await writeFile(join(cwd, 'app.uvprojx'), UVPROJX)
  await writeFile(join(cwd, 'inc', 'app.h'), '#pragma once\nvoid setup(void);\n')
  await writeFile(
    join(cwd, 'src', 'main.c'),
    '#include "app.h"\n\nvoid setup(void)\n{\n}\n\nint main(void)\n{\n  setup();\n  return 0;\n}\n',
  )
  await writeFile(join(cwd, 'src', 'secret.c'), Buffer.from([0, 1, 2, 3, 0, 255, 0]))
  return cwd
}

test('keilMap lists groups, includes, missing and unreadable files', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-map-'))
  try {
    const cwd = await makeProject(home)
    saveBindings(home, { python: '', uv4: '', openocd: '' })
    saveWorkspace(home, cwd, { keil: { project: join(cwd, 'app.uvprojx'), target: 'Debug' } })
    const ran = await keilMap(home, cwd)
    assert.equal(ran.ok, true, ran.error)
    const details = ran.result.details
    assert.equal(details.target, 'Debug')
    assert.equal(details.counts.files, 3)
    assert.equal(details.counts.missing, 1)
    assert.equal(details.counts.unreadable, 1)
    assert.ok(details.defines.includes('STM32F10X_HD'))
    const names = details.groups[0].files.map((item) => item.name)
    assert.deepEqual(names, ['main.c', 'missing.c', 'secret.c'])
    const main = details.groups[0].files[0]
    assert.equal(main.readable, true)
    assert.equal(main.exists, true)
    assert.ok(main.functions.some((fn) => fn.name === 'main'))
    assert.ok(main.functions.some((fn) => fn.name === 'setup'))
    assert.ok(details.include_edges.some((edge) => edge.name === 'app.h' && edge.resolved))
    assert.equal(details.groups[0].files[1].exists, false)
    assert.equal(details.groups[0].files[2].readable, false)
    assert.equal(details.truncated.files, false)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('vision_bench map returns compact file tree for the selected project', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-map-tool-'))
  try {
    const cwd = await makeProject(home)
    saveBindings(home, { python: '', uv4: '', openocd: '' })
    const project = join(cwd, 'app.uvprojx')
    await runVisionBench(home, { action: 'select', path: project, target: 'Debug' }, cwd)
    const mapped = await runVisionBench(home, { action: 'map' }, cwd)
    assert.equal(mapped.ok, true, mapped.error)
    assert.equal(mapped.map.target, 'Debug')
    assert.equal(mapped.map.counts.files, 3)
    assert.ok(mapped.map.truncated)
    assert.ok(mapped.map.limits)
    assert.ok(mapped.map.groups[0].files.some((item) => item.name === 'main.c' && item.readable))
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('map does not read C/H files outside the workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dvb-map-out-'))
  try {
    const cwd = join(root, 'board')
    const outside = join(root, 'secret.c')
    await mkdir(join(cwd, 'src'), { recursive: true })
    await writeFile(outside, 'int private_key_loader(void)\n{\n  return 42;\n}\n#include "vault.h"\n')
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<Project>
  <Targets>
    <Target>
      <TargetName>Debug</TargetName>
      <Groups>
        <Group>
          <GroupName>Leak</GroupName>
          <Files>
            <File>
              <FileName>secret.c</FileName>
              <FileType>1</FileType>
              <FilePath>${outside}</FilePath>
            </File>
          </Files>
        </Group>
      </Groups>
    </Target>
  </Targets>
</Project>
`
    await writeFile(join(cwd, 'app.uvprojx'), xml)
    const details = await mapProject(join(cwd, 'app.uvprojx'), 'Debug', cwd)
    const dump = JSON.stringify(details)
    assert.equal(details.counts.files, 1)
    const file = details.groups[0].files[0]
    assert.equal(file.inside, false)
    assert.equal(file.reason, 'outside')
    assert.equal(file.functions.length, 0)
    assert.equal(file.rel.includes('/') || file.rel.includes('\\'), false)
    assert.equal(dump.includes('private_key_loader'), false)
    assert.equal(dump.includes(outside), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('map sets truncated when file cap is hit', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-map-cap-'))
  try {
    const cwd = await makeProject(home)
    const details = await mapProject(join(cwd, 'app.uvprojx'), 'Debug', cwd, { maxFiles: 1 })
    assert.equal(details.truncated.files, true)
    assert.equal(details.counts.files, 1)
    assert.equal(details.limits.files, 1)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
