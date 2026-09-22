#!/usr/bin/env node
/**
 * Module-level B2 contract (same Node process / child negative).
 *
 * This is NOT a Desktop product proof. For real Desktop B2 (pack → temp profile →
 * DesktopHostProcess → Agent entry + system.ping), run:
 *   pnpm exec tsx scripts/probes/run-desktop-b2-identity.mts
 * from deepseek-harness-desktop-official/apps/desktop.
 *
 * Usage: node scripts/probes/run-b2-identity.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '../..')

async function sameProcessProbe() {
  const home = mkdtempSync(join(tmpdir(), 'dsh-vision-b2-'))
  try {
    const { createVisionCommandDispatcher } = await import(
      pathToFileURL(join(root, 'src/interfaces/http/vision-command-routes.mjs')).href
    )
    const hostClient = await import(
      pathToFileURL(join(root, 'src/infrastructure/host/vision-host-client.mjs')).href
    )
    // Second import of the agent entry's dependency path (same URL → same ESM instance).
    const agentClient = await import(
      pathToFileURL(join(root, 'src/infrastructure/host/vision-host-client.mjs')).href
    )

    const stop = hostClient.registerVisionHost(createVisionCommandDispatcher(home))
    const ping = await agentClient.pingVisionHost({ cwd: '', sessionId: 'b2-same' })
    stop()

    const identity = ping.identity
    const pass =
      ping.ok === true &&
      identity?.samePid === true &&
      identity?.sameModuleInstance === true &&
      identity?.hasHandle === true &&
      identity?.dispatchPath === 'in-process-handle' &&
      hostClient.VISION_HOST_CLIENT_INSTANCE_ID === agentClient.VISION_HOST_CLIENT_INSTANCE_ID

    return {
      case: 'same-process',
      pass,
      hostFiber: 'dsh-vision-bench',
      agentFiber: 'dsh-vision-bench-tools',
      instanceIdsEqual:
        hostClient.VISION_HOST_CLIENT_INSTANCE_ID === agentClient.VISION_HOST_CLIENT_INSTANCE_ID,
      ping: {
        ok: ping.ok,
        pid: ping.data?.pid,
        transport: ping.data?.transport,
        clientInstanceId: ping.data?.clientInstanceId,
      },
      identity,
    }
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

function childProcessNegative() {
  const childScript = `
import { pathToFileURL } from 'node:url'
const root = ${JSON.stringify(root)}
const client = await import(pathToFileURL(root + '/src/infrastructure/host/vision-host-client.mjs').href)
const ping = await client.pingVisionHost({ cwd: '', sessionId: 'b2-child' })
console.log(JSON.stringify({
  childPid: process.pid,
  hasHandle: Boolean(client.getVisionHost()),
  localInstanceId: client.VISION_HOST_CLIENT_INSTANCE_ID,
  pingOk: ping.ok === true,
  available: ping.available === true,
  errorCode: ping.errorCode || null,
  dispatchWouldBe: client.describeHostBridge().transport,
}))
`
  const ran = spawnSync(process.execPath, ['--input-type=module', '-e', childScript], {
    encoding: 'utf8',
    env: {
      ...process.env,
      VISION_BENCH_HOST_ORIGIN: 'http://127.0.0.1:1',
    },
  })
  if (ran.status !== 0) {
    return {
      case: 'child-process-negative',
      pass: false,
      error: ran.stderr || ran.stdout || `exit ${String(ran.status)}`,
    }
  }
  const line = ran.stdout.trim().split('\n').filter(Boolean).at(-1)
  const body = JSON.parse(line || '{}')
  const pass =
    body.hasHandle === false &&
    body.pingOk === false &&
    body.available === false &&
    body.childPid !== process.pid
  return { case: 'child-process-negative', pass, parentPid: process.pid, ...body }
}

async function main() {
  const same = await sameProcessProbe()
  const child = childProcessNegative()
  const report = {
    event: 'vision.probe.b2.identity',
    ok: same.pass && child.pass,
    same,
    child,
    note:
      'Module-unit B2 only. Desktop product proof: scripts/probes/run-desktop-b2-identity.mts (pack + DesktopHostProcess).',
  }
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) process.exitCode = 1
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
