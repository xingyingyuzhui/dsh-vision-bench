// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FLASH_INTERFACES,
  LEGACY_INTERFACE_ALIASES,
  resolveOpenOcdProfile,
  validateOpenOcdInterface,
} from '../../src/domain/flash/openocd-profile.mjs'

// 本文件只覆盖 openocd-runner.test.mjs 没有覆盖的三件事：
//   1. 白名单本身的「结构性不变量」（每一项都必须是安全 cfg token）
//   2. stlink 现代 dapdirect 驱动的存在性（本次修复发现的真实回归）
//   3. 旧别名到真实 interface 的迁移路径
// 默认值回退、请求值优先、恶意 profile 失败关闭等行为由
// test/openocd-runner.test.mjs 的 'stored profile is fail-closed; empty uses defaults'
// 统一覆盖，此处不重复。

test('C4: 白名单每一项都是安全的 cfg token', () => {
  // 这是本文件里最重要的一条：它约束的是「路径穿越」这一整类问题，
  // 而不只是某个已知的坏值。任何未来新增的白名单条目都会被它兜住。
  for (const name of FLASH_INTERFACES) {
    assert.match(name, /^[a-z0-9][a-z0-9._-]*$/i, `${name} 应为安全 token`)
    assert.ok(!name.includes('/') && !name.includes('..'), `${name} 不得含路径分隔符`)
  }
})

test('C4: 暴露 stlink 的 dapdirect 驱动选项', () => {
  // stlink.cfg 用 legacy HLA；stlink-dap.cfg 用现代 `adapter driver st-link`。
  // 修复前白名单只有 stlink，现代驱动整个缺失 —— 这条钉住那个回归。
  assert.ok(FLASH_INTERFACES.includes('stlink'))
  assert.ok(FLASH_INTERFACES.includes('stlink-dap'))
})

test('C4: 白名单不含已知不存在的 interface 文件', () => {
  // 仅靠注释约束，离线无法验证上游文件是否存在 —— 这条是把「决策」写成断言，
  // 防止有人凭直觉把 ftdi / dap 加回来。
  //   `ftdi` 在上游是目录 interface/ftdi/，没有 ftdi.cfg
  //   `dap`  在 v0.11.0 / v0.12.0 都不存在
  //   `stlink-hla` 仅 master 有
  // 三者都会让 OpenOCD 直接报 `Can't find interface/<name>.cfg` 启动失败。
  assert.ok(!FLASH_INTERFACES.includes('ftdi'), 'ftdi 是目录，不应在白名单内')
  assert.ok(!FLASH_INTERFACES.includes('dap'), 'dap 不存在，不应在白名单内')
  assert.ok(!FLASH_INTERFACES.includes('stlink-hla'), 'stlink-hla 仅 master 有')
})

test('C4: 旧别名映射到真实 interface，未知值仍然拒绝', () => {
  assert.equal(validateOpenOcdInterface('dap').value, 'cmsis-dap')
  assert.equal(validateOpenOcdInterface('ftdi').value, 'ft232r')
  assert.deepEqual(Object.keys(LEGACY_INTERFACE_ALIASES).sort(), ['dap', 'ftdi'])
  // 映射目标必须真实存在于白名单，否则别名会把用户引到一个不存在的 cfg
  for (const target of Object.values(LEGACY_INTERFACE_ALIASES)) {
    assert.ok(FLASH_INTERFACES.includes(target), `${target} 必须在白名单内`)
  }
  // 负向：别名表之外的值一律拒绝（安全 token 但不在白名单）
  const unknown = validateOpenOcdInterface('nonexistent-probe')
  assert.equal(unknown.ok, false)
  assert.equal(unknown.errorCode, 'FLASH_INTERFACE_INVALID')
  // 别名解析必须能穿过公开入口生效，而不只是内部函数
  const resolved = resolveOpenOcdProfile({}, { interface: 'dap', target: 'stm32f4x' })
  assert.equal(resolved.ok, true)
  assert.equal(resolved.interfaceName, 'cmsis-dap')
})
