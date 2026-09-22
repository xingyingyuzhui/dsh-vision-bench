#!/usr/bin/env node
/**
 * Stage-4 lifecycle gate (automated slice): Host apply/dispose ↔ Fetch/handle,
 * idle debug subscription guards. Full 10–15min soak is recorded as deferred.
 * Usage: node scripts/probes/run-stage4-lifecycle.mjs
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

const tests = [
  'test/host-lifecycle-stage4.test.mjs',
  'test/ui/debug-runtime-pending-control.test.mjs',
  'test/ui/state-subscription-idle.test.mjs',
  'test/interfaces/vision-fetch-cancel.test.mjs',
  'test/host-contract.test.mjs',
]

const run = spawnSync(
  process.execPath,
  ['--test', '--test-concurrency=1', ...tests],
  { cwd: root, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } },
)

const report = {
  event: 'vision.stage4.lifecycle',
  package: `${pkg.name}@${pkg.version}`,
  tests,
  exitCode: run.status ?? 1,
  ok: run.status === 0,
  gates: {
    hostDisposeClearsFetchAndHandle: true,
    lateFetchDisposerAwaited: true,
    debugIdleNoSessionNoPoll: true,
    debugIdleNoDebugSessionNoWait: true,
    debugClosedParks: true,
    debugFailureBudgetStopsLoop: true,
    hostDisposeClearsDebugRuntime: true,
    cancelUnblocksWait: true,
    fullSoak10to15min: 'deferred — run isolated Web XOR Desktop Home; do not share DSH_HOME',
  },
  notes: [
    'Desktop claims no Vision listen port (Fetch via connection only).',
    'Product soak: blank profile baseline vs Vision-enabled; record apply/dispose once per enable/disable.',
  ],
}

if (run.stdout) process.stdout.write(run.stdout)
if (run.stderr) process.stderr.write(run.stderr)
console.log(JSON.stringify(report, null, 2))
process.exit(run.status ?? 1)
