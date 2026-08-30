import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  CORE_TYPECHECK_DIRS,
  checkTypecheckFiles,
  collectCoreMjs,
  findNocheckFiles,
  findUncheckedFiles,
} from '../../scripts/check-typecheck-files.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

test('core architecture layers are in tsc and do not use @ts-nocheck', () => {
  const coreFiles = collectCoreMjs(root)
  assert.ok(coreFiles.length > 0, 'expected core .mjs files')
  for (const dir of CORE_TYPECHECK_DIRS) {
    assert.ok(
      coreFiles.some(
        (file) => file.replaceAll('\\', '/').includes(`/${dir}/`) || file.replaceAll('\\', '/').endsWith(`/${dir}`),
      ),
      `missing files under ${dir}`,
    )
  }
  const nocheck = findNocheckFiles(coreFiles)
  const unchecked = findUncheckedFiles(coreFiles)
  assert.equal(nocheck.length, 0, `core @ts-nocheck still present:\n${nocheck.join('\n')}`)
  assert.equal(unchecked.length, 0, `core files missing @ts-check:\n${unchecked.join('\n')}`)
  const result = checkTypecheckFiles(root)
  assert.deepEqual(result.nocheck, [])
  assert.deepEqual(result.unchecked, [])
  assert.deepEqual(result.missing, [])
  assert.equal(result.ok, true)
})

test('typecheck gate reads source instead of trusting tsc filenames alone', () => {
  const script = readFileSync(join(root, 'scripts/check-typecheck-files.mjs'), 'utf8')
  assert.match(script, /@ts-nocheck/)
  assert.match(script, /readFileSync/)
  assert.match(script, /listFilesOnly/)
  assert.doesNotMatch(script, /required = \[\s*'config-mutation-service\.mjs'/)
})
