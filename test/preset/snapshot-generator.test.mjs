import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'gen-standard-preset-snapshot.mjs')

const FIXTURE = [
  '- insert:',
  '    - id: preset-standard',
  "      name: '@deepseek-ai/dsh-agent-preset'",
  '      config:',
  '        id: standard',
  '        order: 1',
  '        plugins:',
  '          - id: persona',
  "            name: '@deepseek-ai/dsh-persona'",
  '            config:',
  '              prefix: You are a coding agent.',
  '          - id: tool-bash',
  "            name: '@deepseek-ai/dsh-tool-bash'",
  "            disabled: !!js process.platform === 'win32'",
  '          - id: compaction',
  '            name: cordis:group',
  '            group: true',
  '            isolate:',
  '              compaction: true',
  '            config:',
  '              - id: compaction-basic',
  "                name: '@deepseek-ai/dsh-compaction-basic'",
  '',
].join('\n')

/** @param {string[]} args */
function run(args) {
  return execFileSync(process.execPath, [script, ...args], { encoding: 'utf8' })
}

test('generator emits a working snapshot module from a standard patch', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dvb-gen-'))
  const source = join(dir, 'standard.patch.yml')
  const out = join(dir, 'snapshot.mjs')
  await writeFile(source, FIXTURE)
  run(['--write', '--source', source, '--contract', '0.0.0-test', '--out', out])
  const generated = await readFile(out, 'utf8')
  assert.match(generated, /GENERATED FILE/)
  assert.match(generated, /STANDARD_PRESET_SNAPSHOT_CONTRACT = '0\.0\.0-test'/)

  const mod = await import(pathToFileURL(out).href)
  const rows = mod.buildStandardPresetChildren({ platform: 'linux' })
  assert.deepEqual(
    rows.map((/** @type {any} */ row) => row.id),
    ['persona', 'tool-bash', 'compaction'],
  )
  assert.equal(rows[1].disabled, false)
  assert.equal(mod.buildStandardPresetChildren({ platform: 'win32' })[1].disabled, true)
  assert.deepEqual(rows[2].isolate, { compaction: true })
  assert.equal(rows[2].config[0].name, '@deepseek-ai/dsh-compaction-basic')

  // --check accepts the file it just wrote and rejects drift.
  assert.match(run(['--check', '--source', source, '--contract', '0.0.0-test', '--out', out]), /matches DSH/)
  await writeFile(out, generated + '\n// tampered\n')
  assert.throws(() => run(['--check', '--source', source, '--contract', '0.0.0-test', '--out', out]), /drift/)
})

test('generator refuses unknown !!js expressions instead of flattening them', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dvb-gen-'))
  const source = join(dir, 'standard.patch.yml')
  await writeFile(
    source,
    FIXTURE.replace("disabled: !!js process.platform === 'win32'", "disabled: !!js ctx.something()"),
  )
  assert.throws(
    () => run(['--write', '--source', source, '--contract', '0.0.0-test', '--out', join(dir, 'out.mjs')]),
    /unsupported !!js disabled expression/,
  )
})

test('generator rejects patches without a standard declaration', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dvb-gen-'))
  const source = join(dir, 'standard.patch.yml')
  await writeFile(source, '- insert:\n    - id: preset-other\n      name: other\n')
  assert.throws(
    () => run(['--write', '--source', source, '--contract', '0.0.0-test', '--out', join(dir, 'out.mjs')]),
    /no standard preset children/,
  )
})

test('generator prints usage without a mode', () => {
  assert.throws(() => run([]), /usage: gen-standard-preset-snapshot/)
})
