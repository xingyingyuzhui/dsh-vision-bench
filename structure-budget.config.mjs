/**
 * Structure budget for hand-maintained sources (P5-4 debt ratchet).
 *
 * Soft `warn` band requires an allowlist entry with a `max` ratchet: listed
 * files may shrink but never grow. Hard `error` (500/80) remains absolute.
 * Wildcards are rejected. Once a file drops under warn, remove it from allow.
 */
export default {
  "groups": [
    {
      "name": "production",
      "label": "人工维护生产文件",
      "dirs": [
        "src",
        "runtime",
        "scripts"
      ],
      "suffixes": [
        ".mjs",
        ".js"
      ],
      "rootPattern": "^(host|tools)\\.js$",
      "warn": 400,
      "error": 500,
      "allow": [
        {
          "file": "src/domain/modbus/visualization-model.mjs",
          "max": 490,
          "reason": "P5-4 debt ratchet; split in later P4/P6",
          "stage": "P6",
          "owner": "vision-bench"
        },
        {
          "file": "src/ui/debug/project/use-project-session.mjs",
          "max": 489,
          "reason": "P5-4 debt ratchet; split in later P4/P6",
          "stage": "P6",
          "owner": "vision-bench"
        },
        {
          "file": "src/infrastructure/debug/keil/uvsock-client.mjs",
          "max": 486,
          "reason": "P5-4 debt ratchet; split in later P4/P6",
          "stage": "P6",
          "owner": "vision-bench"
        },
        {
          "file": "src/ui/components/custom-select.mjs",
          "max": 470,
          "reason": "P5-4 debt ratchet; split in later P4/P6",
          "stage": "P6",
          "owner": "vision-bench"
        },
        {
          "file": "src/ui/monitor/frames/use-frames-page.mjs",
          "max": 464,
          "reason": "P5-4 debt ratchet; split in later P4/P6",
          "stage": "P6",
          "owner": "vision-bench"
        },
        {
          "file": "src/infrastructure/store/journal-store.mjs",
          "max": 463,
          "reason": "P5-4 debt ratchet; split in later P4/P6",
          "stage": "P6",
          "owner": "vision-bench"
        },
        {
          "file": "src/interfaces/rpc/vision-rpc-router.mjs",
          "max": 452,
          "reason": "P5-4 debt ratchet; split in later P4/P6",
          "stage": "P6",
          "owner": "vision-bench"
        },
        {
          "file": "src/application/debug/debug-launch-spec-service.mjs",
          "max": 445,
          "reason": "P5-4 debt ratchet; split in later P4/P6",
          "stage": "P6",
          "owner": "vision-bench"
        },
        {
          "file": "src/domain/program/program-model.mjs",
          "max": 445,
          "reason": "P5-4 debt ratchet; split in later P4/P6",
          "stage": "P6",
          "owner": "vision-bench"
        },
        {
          "file": "src/domain/modbus/point-model.mjs",
          "max": 437,
          "reason": "P5-4 debt ratchet; split in later P4/P6",
          "stage": "P6",
          "owner": "vision-bench"
        },
        {
          "file": "src/application/modbus/polling-service.mjs",
          "max": 431,
          "reason": "P5-4 debt ratchet; split in later P4/P6",
          "stage": "P6",
          "owner": "vision-bench"
        },
        {
          "file": "runtime/io/connection-manager.mjs",
          "max": 422,
          "reason": "P5-4 debt ratchet; split in later P4/P6",
          "stage": "P6",
          "owner": "vision-bench"
        },
        {
          "file": "src/ui/hmi/device-card-item.mjs",
          "max": 421,
          "reason": "P5-4 debt ratchet; split in later P4/P6",
          "stage": "P6",
          "owner": "vision-bench"
        },
        {
          "file": "src/ui/hmi/hmi-page.mjs",
          "max": 421,
          "reason": "P5-4 debt ratchet; split in later P4/P6",
          "stage": "P6",
          "owner": "vision-bench"
        },
        {
          "file": "src/infrastructure/keil/uv4-build-runner.mjs",
          "max": 411,
          "reason": "P5-4 debt ratchet; split in later P4/P6",
          "stage": "P6",
          "owner": "vision-bench"
        },
        {
          "file": "src/infrastructure/modbus/io-broker.mjs",
          "max": 411,
          "reason": "P5-4 debt ratchet; split in later P4/P6",
          "stage": "P6",
          "owner": "vision-bench"
        },
        {
          "file": "src/ui/monitor/alarms/alarm-page.mjs",
          "max": 407,
          "reason": "P5-4 debt ratchet; split in later P4/P6",
          "stage": "P6",
          "owner": "vision-bench"
        },
        {
          "file": "src/infrastructure/store/workspace-store.mjs",
          "max": 401,
          "reason": "P5-4 debt ratchet; split in later P4/P6",
          "stage": "P6",
          "owner": "vision-bench"
        }
      ]
    },
    {
      "name": "facade",
      "label": "根目录兼容门面",
      "rootPattern": "^bench-.*\\.mjs$",
      "suffixes": [
        ".mjs"
      ],
      "warn": 60,
      "error": 80,
      "allow": [
        {
          "file": "bench-points.mjs",
          "max": 67,
          "reason": "P5-4 debt ratchet; split in later P4/P6",
          "stage": "P5",
          "owner": "vision-bench"
        },
        {
          "file": "bench-shared.mjs",
          "max": 67,
          "reason": "P5-4 debt ratchet; split in later P4/P6",
          "stage": "P5",
          "owner": "vision-bench"
        },
        {
          "file": "bench-store.mjs",
          "max": 61,
          "reason": "P5-4 debt ratchet; split in later P4/P6",
          "stage": "P5",
          "owner": "vision-bench"
        }
      ]
    },
    {
      "name": "test",
      "label": "测试文件",
      "dirs": [
        "test"
      ],
      "suffixes": [
        ".test.mjs"
      ],
      "warn": 350,
      "error": 500,
      "allow": [
        {
          "file": "test/agent/ui.test.mjs",
          "max": 448,
          "reason": "P5-4 debt ratchet; split in later P4/P6",
          "stage": "P4",
          "owner": "vision-bench"
        },
        {
          "file": "test/ui/project-workspace-isolation.test.mjs",
          "max": 441,
          "reason": "P5-4 debt ratchet; split in later P4/P6",
          "stage": "P4",
          "owner": "vision-bench"
        },
        {
          "file": "test/flash/runner.test.mjs",
          "max": 407,
          "reason": "P5-4 debt ratchet; split in later P4/P6",
          "stage": "P4",
          "owner": "vision-bench"
        },
        {
          "file": "test/ui/vision-view-request.test.mjs",
          "max": 398,
          "reason": "P5-4 debt ratchet; split in later P4/P6",
          "stage": "P4",
          "owner": "vision-bench"
        },
        {
          "file": "test/ui/frames-feed-real-effects.test.mjs",
          "max": 387,
          "reason": "P5-4 debt ratchet; split in later P4/P6",
          "stage": "P4",
          "owner": "vision-bench"
        },
        {
          "file": "test/debug/debug-approval-service.test.mjs",
          "max": 386,
          "reason": "P5-4 debt ratchet; split in later P4/P6",
          "stage": "P4",
          "owner": "vision-bench"
        },
        {
          "file": "test/ui/frames-real-effects.test.mjs",
          "max": 381,
          "reason": "P5-4 debt ratchet; split in later P4/P6",
          "stage": "P4",
          "owner": "vision-bench"
        },
        {
          "file": "test/debug/keil-simulator-backend.test.mjs",
          "max": 368,
          "reason": "P5-4 debt ratchet; split in later P4/P6",
          "stage": "P4",
          "owner": "vision-bench"
        },
        {
          "file": "test/visualization/model.test.mjs",
          "max": 368,
          "reason": "P5-4 debt ratchet; split in later P4/P6",
          "stage": "P4",
          "owner": "vision-bench"
        }
      ]
    }
  ]
}
