// @ts-check
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { resolveDebugLaunchSpec } from '../../src/application/debug/debug-launch-spec-service.mjs'

test('stm32 debug smoke fixture: files exist and can be resolved by launch spec service', async () => {
  const fixtureDir = join(process.cwd(), 'fixtures', 'stm32-debug-smoke')
  assert.ok(existsSync(join(fixtureDir, 'main.c')))
  assert.ok(existsSync(join(fixtureDir, 'system_stm32.c')))
  assert.ok(existsSync(join(fixtureDir, 'openocd.cfg')))
  assert.ok(existsSync(join(fixtureDir, 'stm32_smoke.axf')))

  const mainSource = readFileSync(join(fixtureDir, 'main.c'), 'utf8')
  assert.ok(mainSource.includes('update_value'))
  assert.ok(mainSource.includes('counter'))
  assert.ok(mainSource.includes('watched'))

  const resolved = await resolveDebugLaunchSpec({
    cwd: fixtureDir,
    sessionId: 'smoke_sess_1',
  })

  assert.equal(resolved.backend, 'gdb-openocd')
  assert.ok(resolved.targetSpec.artifactPath.endsWith('stm32_smoke.axf'))
  assert.ok(resolved.targetSpec.artifactSha256.length === 64)
})
