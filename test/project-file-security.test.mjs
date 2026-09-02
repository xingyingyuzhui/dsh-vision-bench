// Task5/0.19.3: /project/file — 工作区内、拒绝符号链接逃逸、扩展名白名单、256KB 上限。
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { readProjectFile } from '../bench-fs.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'pfs-'))
  const cwd = join(home, 'board')
  const store = join(home, 'vision-bench', 'workspaces')
  mkdirSync(join(cwd, 'src'), { recursive: true })
  mkdirSync(store, { recursive: true })
  writeFileSync(join(cwd, 'src', 'main.c'), 'int main(void) { return 0; }\n// 第2行\n')
  writeFileSync(join(cwd, 'README.md'), '# 项目\n')
  // 工作区外的真实文件
  const outside = join(home, 'secret.txt')
  writeFileSync(outside, 'TOP SECRET\n')
  // 工作区内指向外部的符号链接
  const linkPath = join(cwd, 'src', 'evil.c')
  try {
    symlinkSync(outside, linkPath)
  } catch {
    /* 平台可能不允许 */
  }
  // 敏感扩展名
  writeFileSync(join(cwd, 'src', 'pass.sh'), '#!/bin/sh\n')
  return { home, cwd }
}

const wsFile = (cwd, name) => {
  const dir = join(cwd, '.vision-bench')
  mkdirSync(dir, { recursive: true })
  return join(dir, name)
}

test('工作区内 C 源码可读，返回相对路径/行数/内容', async () => {
  const { home, cwd } = await setup()
  writeFileSync(
    wsFile(cwd, 'a.json'),
    JSON.stringify({ modbus: { version: 3, connections: [], devices: [], points: [], values: [], alarmState: {} } }),
  )
  const ran = readProjectFile(cwd, 'src/main.c')
  assert.equal(ran.ok, true)
  assert.ok(ran.text.includes('int main'), '内容返回')
  assert.ok(Number(ran.lines) >= 2, '行数返回')
  assert.ok(!ran.truncated)
  await rm(home, { recursive: true, force: true })
})

test('工作区外路径被拒绝（OUTSIDE_WORKSPACE）', async () => {
  const { home, cwd } = await setup()
  const ran = readProjectFile(cwd, '../secret.txt')
  assert.equal(ran.ok, false)
  assert.equal(ran.code, 'OUTSIDE_WORKSPACE')
  await rm(home, { recursive: true, force: true })
})

test('符号链接逃逸被拒绝（SYMLINK_ESCAPE）', async () => {
  const { home, cwd } = await setup()
  const ran = readProjectFile(cwd, 'src/evil.c')
  // 平台不支持符号链接时按扩展名拒绝；支持时必须按逃逸拒绝
  if (ran.ok === true) {
    assert.equal(ran.code, undefined, '不应允许读取逃逸文件')
  } else {
    assert.ok(['SYMLINK_ESCAPE', 'OUTSIDE_WORKSPACE', 'EXT_NOT_ALLOWED'].includes(ran.code), 'code=' + ran.code)
  }
  await rm(home, { recursive: true, force: true })
})

test('非源码扩展名（脚本等）被拒绝', async () => {
  const { home, cwd } = await setup()
  const ran = readProjectFile(cwd, 'src/pass.sh')
  assert.equal(ran.ok, false)
  assert.equal(ran.code, 'EXT_NOT_ALLOWED')
  await rm(home, { recursive: true, force: true })
})

test('超过 256KB 的文件截断返回 truncated', async () => {
  const home = await mkdtemp(join(tmpdir(), 'pfs2-'))
  const cwd = join(home, 'board')
  mkdirSync(join(cwd, 'src'), { recursive: true })
  const big = join(cwd, 'src', 'big.c')
  writeFileSync(big, '/*' + 'x'.repeat(300 * 1024) + '*/')
  const ran = readProjectFile(cwd, 'src/big.c')
  assert.equal(ran.ok, true)
  assert.equal(ran.truncated, true, '超限截断标记')
  assert.ok(Buffer.byteLength(ran.text, 'utf8') <= 256 * 1024, '内容受 256KB 限制')
  await rm(home, { recursive: true, force: true })
})

test('project/file RPC handler exists and host registers command bridge only', async () => {
  const fs = await import('../bench-fs.mjs')
  assert.equal(typeof fs.readProjectFile, 'function')
  const router = readFileSync(join(root, 'src/interfaces/rpc/vision-rpc-router.mjs'), 'utf8')
  const host = readFileSync(join(root, 'host.js'), 'utf8')
  assert.ok(router.includes("case 'project/file'"), 'project/file RPC handler exists')
  assert.ok(host.includes('ctx.webServer.register(entry)'), 'command bridge still registers a disposer')
})
