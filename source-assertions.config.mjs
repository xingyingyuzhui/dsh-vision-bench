/**
 * Permission list for tests that read production source (plan task P0-3).
 *
 * The gate fails when a test reads `src/**`, a root `bench-*.mjs`, `host.js`/
 * `tools.js` or `runtime/**` without an entry here, and it also fails when a
 * listed test starts reading a *new* target. That second rule is what keeps a
 * new UI source string lock from hiding inside an already allowlisted file.
 *
 * `purpose` records why the read is permitted. The plan allows five purposes;
 * `pending-refactor` is a deliberate sixth, used only for fragile source or CSS
 * string locks that P2-7 replaces with behavioural assertions. Its entry count
 * must only ever go down.
 */
export default {
  allow: [
    {
      file: 'test/alpha3-contract.test.mjs',
      purpose: 'architecture-boundary',
      reason: 'Host/Client 分层与兼容入口契约',
      targets: ['client.js', 'host.js', 'src/ui/client/client-entry.mjs', 'src/interfaces/web/vision-web-compat.mjs'],
    },
    {
      file: 'test/alpha3-remote-spike.test.mjs',
      purpose: 'architecture-boundary',
      reason: '远程传输 ADR 与 Client 入口契约',
      targets: [
        'docs/architecture/ADR-012-remote-transport.md',
        'host.js',
        'package.json',
        'src/ui/client/client-entry.mjs',
        'src/interfaces/web/vision-web-compat.mjs',
      ],
    },
    {
      file: 'test/architecture/debug-boundary.test.mjs',
      purpose: 'architecture-boundary',
      reason: '程序模型不得反向依赖 UI',
      targets: ['src/domain/program/program-model.mjs'],
    },
    {
      file: 'test/architecture/test-runner.test.mjs',
      purpose: 'architecture-boundary',
      reason: '门禁脚本不得依赖 shell glob',
      targets: ['bench-hmi.mjs', 'bench-runtime.mjs', 'package.json', 'scripts/run-tests.mjs'],
    },
    {
      file: 'test/architecture/ui-dependency-gates.test.mjs',
      purpose: 'architecture-boundary',
      reason: 'P5-1 UI 依赖方向门禁：components/patterns 不得依赖功能域，禁止直连 vendor npm',
      targets: ['host.js', 'node_modules/dependency-cruiser/bin/dependency-cruise.mjs', 'runtime/io'],
    },
    {
      file: 'test/architecture/workspace-single-writer.test.mjs',
      purpose: 'architecture-boundary',
      reason: '单写者边界与生成物契约',
      targets: ['client.js', 'src/infrastructure/persistence/atomic-json.mjs', 'src/infrastructure/persistence/workspace-migration.mjs', 'src/infrastructure/persistence/workspace-repository.mjs'],
    },
    {
      file: 'test/commands/command-router-handlers.test.mjs',
      purpose: 'architecture-boundary',
      reason: '命令路由须保持薄组合层，禁止直写 mutateConfig/modbusWrite',
      targets: ['src/application/commands/vision-command-router.mjs'],
    },
    {
      file: 'test/dependency-boundaries.test.mjs',
      purpose: 'architecture-boundary',
      reason: 'UI 不得依赖门面与设备 I/O',
      targets: ['bench-frames-view.mjs', 'bench-hmi.mjs', 'bench-live.mjs', 'bench-map.mjs', 'bench-runtime.mjs', 'bench-shared.mjs', 'bench-view.mjs', 'bench-visualization-view.mjs', 'node_modules/dependency-cruiser/bin/dependency-cruise.mjs', 'src/ui', 'src/ui/client/client-entry.mjs', 'src/ui/workspace/monitor-workspace.mjs'],
    },
    {
      file: 'test/host-contract.test.mjs',
      purpose: 'release-package',
      reason: '宿主入口与发布契约',
      targets: ['host.js', 'package.json', 'tools.js'],
    },
    {
      file: 'test/ui/cjk-literal-ratchet.test.mjs',
      purpose: 'architecture-boundary',
      reason: 'src/ui 除 i18n 外的中文字面量棘轮',
      targets: ['src/ui/'],
    },
    {
      file: 'test/ui/i18n.test.mjs',
      purpose: 'architecture-boundary',
      reason: 'i18n 数据与 Client 入口边界',
      targets: ['package.json', 'scripts/build-client.mjs', 'src/ui/client/client-entry.mjs'],
    },
    {
      file: 'test/mount-smoke.test.mjs',
      purpose: 'architecture-boundary',
      reason: '挂载冒烟：OpenOCD 探测/取消烧录须绑定真实入口',
      targets: [
        'bench-view.mjs',
        'src/ui/debug/debug-view.mjs',
        'src/ui/debug/debug-flash-panel.mjs',
        'src/ui/debug/use-debug-flash-actions.mjs',
      ],
    },
    {
      file: 'test/package-contents.test.mjs',
      purpose: 'release-package',
      reason: '发布包内容与运行时资源清单',
      targets: ['bench-guidance.mjs', 'bench-run.mjs', 'bench-visualization-model.mjs', 'bench-visualization-view.mjs', 'package.json', 'runtime/modbus_read.py', 'runtime/modbus_write.py', 'runtime/openocd_flash.py', 'runtime/serial_monitor.py', 'scripts/build-client.mjs', 'src/application/flash/flash-approval-service.mjs', 'src/application/flash/openocd-health-service.mjs', 'src/domain/flash/errors.mjs', 'src/infrastructure/files/firmware-snapshot.mjs', 'src/infrastructure/harness/preset-validate.mjs', 'src/infrastructure/store/dsh-home.mjs', 'src/ui/hmi/device-card.mjs', 'src/ui/settings/tool-status.mjs'],
    },
    {
      file: 'test/project/file-security.test.mjs',
      purpose: 'security-banned-pattern',
      reason: '路径穿越与命令注入防护',
      targets: ['host.js', 'src/interfaces/rpc/vision-rpc-router.mjs', 'src/interfaces/web/vision-web-compat.mjs'],
    },
    {
      file: 'test/release.test.mjs',
      purpose: 'release-package',
      reason: '版本与宿主入口发布契约',
      targets: ['host.js', 'package.json'],
    },
    {
      file: 'test/selfcheck.test.mjs',
      purpose: 'architecture-boundary',
      reason: 'system.ping 无副作用；自检必须走真实 Host ping',
      targets: ['src/application/commands/handlers/system-command-handler.mjs', 'src/application/system/self-check.mjs'],
    },
    {
      file: 'test/workspace/session.test.mjs',
      purpose: 'architecture-boundary',
      reason: '通知实现不得依赖 dsh-llm（发布边界）',
      targets: ['src/infrastructure/host/notify.mjs'],
    },
    {
      file: 'test/agent/tool-schema.test.mjs',
      purpose: 'release-package',
      reason: 'Agent 工具入口契约',
      targets: ['tools.js'],
    },
    {
      file: 'test/domain/trend.test.mjs',
      purpose: 'architecture-boundary',
      reason: '曲线须走 bundled vendorUPlot，禁止依赖宿主全局 uPlot',
      targets: [
        'src/ui/monitor/visualization/hooks/use-viz-charts.mjs',
        'src/ui/monitor/visualization/visualization-page.mjs',
      ],
    },
    {
      file: 'test/type-contract.test.mjs',
      purpose: 'version-contract',
      reason: 'domain 类型声明与实现一致',
      targets: ['src/domain/modbus/endpoint.mjs', 'src/domain/modbus/errors.mjs', 'src/domain/modbus/validation.mjs'],
    },
    {
      file: 'test/ui/ui-module-split.test.mjs',
      purpose: 'architecture-boundary',
      reason: 'UI 模块拆分与 vendor 入口结构契约',
      targets: ['bench-frames-view.mjs', 'bench-live.mjs', 'bench-map.mjs', 'bench-visualization-view.mjs', 'scripts/vendor-entry.mjs', 'src/ui/components/data-table.mjs', 'src/ui/components/source-editor.mjs', 'src/ui/components/viz-grid.mjs', 'src/ui/monitor/alarms/alarm-page.mjs', 'src/ui/monitor/frames/frames-page.mjs', 'src/ui/monitor/journal/journal-page.mjs', 'src/ui/monitor/visualization/renderers', 'src/ui/vendor/echarts-runtime.mjs', 'src/ui/vendor/grid-runtime.mjs', 'src/ui/vendor/table-runtime.mjs'],
    },
    {
      file: 'test/ui/view.test.mjs',
      purpose: 'architecture-boundary',
      reason: '视图注册与 RPC client 入口契约',
      targets: [
        'bench-view.mjs',
        'src/infrastructure/host/vision-rpc-client.mjs',
        'src/ui/client/client-entry.mjs',
        'src/ui/debug/debug-view.mjs',
        'src/ui/debug/debug-flash-panel.mjs',
        'src/ui/debug/debug-output-panel.mjs',
        'src/ui/debug/debug-project-panel.mjs',
        'src/ui/debug/use-debug-build-actions.mjs',
        'src/ui/debug/use-debug-flash-actions.mjs',
        'src/ui/debug/use-debug-workspace-state.mjs',
      ],
    },
    {
      file: 'test/virtual-compat.test.mjs',
      purpose: 'generated-artifact',
      reason: '生成产物与 vendor 一致性',
      targets: ['bench-styles.mjs', 'client.js', 'node_modules/@tanstack/table-core', 'node_modules/@tanstack/virtual-core', 'package-lock.json', 'package.json', 'scripts/build-client.mjs', 'scripts/vendor-entry.mjs'],
    },
    {
      file: 'test/architecture/source-assertions.test.mjs',
      purpose: 'architecture-boundary',
      reason: '门禁自测：路径字面量仅作分类与许可清单用例，不读取生产源码',
      targets: ['bench-notify.mjs', 'bench-tool.mjs', 'bench-view.mjs', 'bench-y.mjs', 'client.js', 'host.js', 'package.json', 'runtime/modbus_read.py', 'runtime/vision-io-worker.mjs', 'scripts/run-tests.mjs', 'src/types/workspace.d.ts', 'src/ui/', 'src/ui/bar.mjs', 'src/ui/foo.mjs', 'src/ui/helper.mjs', 'src/ui/hmi', 'src/ui/hmi/', 'src/ui/hmi/hmi-page.mjs', 'src/ui/x.mjs'],
    },
  ],
}
