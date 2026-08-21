import assert from 'node:assert/strict'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { keilMap } from '../bench-actions.mjs'
import { saveBindings, saveWorkspace } from '../bench-store.mjs'
import { runVisionBench } from '../bench-tool.mjs'
import { findPython } from './python.mjs'

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
          <GroupName>User</GroupName>
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

const pythonBin = findPython()
const skipPy = pythonBin ? false : 'no Python interpreter (python3 / python / py)'

async function makeProject(root) {
  const cwd = join(root, 'board')
  await mkdir(join(cwd, 'src'), { recursive: true })
  await mkdir(join(cwd, 'inc'), { recursive: true })
  await writeFile(join(cwd, 'app.uvprojx'), UVPROJX)
  await writeFile(join(cwd, 'inc', 'app.h'), '#pragma once\nvoid setup(void);\n')
  await writeFile(join(cwd, 'src', 'main.c'), '#include "app.h"\n\nvoid setup(void)\n{\n}\n\nint main(void)\n{\n  setup();\n  return 0;\n}\n')
  await writeFile(join(cwd, 'src', 'secret.c'), Buffer.from([0, 1, 2, 3, 0, 255, 0]))
  return cwd
}

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'runtime', 'keil_project.py')

function runMap(project, cwd, extra = '') {
  const code = `
import importlib.util, json
spec = importlib.util.spec_from_file_location("kp", ${JSON.stringify(script)})
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
${extra}
print(json.dumps(mod.map_project(${JSON.stringify(project)}, "Debug", ${JSON.stringify(cwd)})))
`
  return JSON.parse(execFileSync(pythonBin, ['-c', code], { encoding: 'utf8' }))
}

test('keilMap lists groups, includes, missing and unreadable files', { skip: skipPy }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-map-'))
  try {
    const cwd = await makeProject(home)
    saveBindings(home, { python: pythonBin, uv4: '', openocd: '' })
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

test('vision_bench map returns compact file tree for the selected project', { skip: skipPy }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-map-tool-'))
  try {
    const cwd = await makeProject(home)
    saveBindings(home, { python: pythonBin, uv4: '', openocd: '' })
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

test('map does not read C/H files outside the workspace', { skip: skipPy }, async () => {
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
    const details = runMap(join(cwd, 'app.uvprojx'), cwd)
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

test('map sets truncated when file cap is hit', { skip: skipPy }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-map-cap-'))
  try {
    const cwd = await makeProject(home)
    const details = runMap(join(cwd, 'app.uvprojx'), cwd, 'mod.MAX_MAP_FILES = 1')
    assert.equal(details.truncated.files, true)
    assert.equal(details.counts.files, 1)
    assert.equal(details.limits.files, 1)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
