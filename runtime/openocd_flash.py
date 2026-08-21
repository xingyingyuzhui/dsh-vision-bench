"""OpenOCD flash for dsh-vision-bench. Runs program+verify+reset in one session."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

INTERFACES = {"cmsis-dap", "stlink", "jlink", "ftdi", "dap"}
TARGETS = {
    "stm32f1x", "stm32f2x", "stm32f4x", "stm32f7x", "stm32g0x", "stm32g4x",
    "stm32h7x", "stm32l0x", "stm32l4x", "nrf51", "nrf52", "rp2040", "lpc55",
    "kinetis", "efm32", "at91samd",
}

FLASH_TIMEOUT = 120


def output_json(data: dict) -> None:
    print(json.dumps(data, ensure_ascii=False), flush=True)


def error_result(code: str, message: str) -> dict:
    return {"status": "error", "action": "download", "error": {"code": code, "message": message}}


def main() -> int:
    parser = argparse.ArgumentParser(description="OpenOCD flash")
    parser.add_argument("--openocd", required=True)
    parser.add_argument("--interface", required=True, help="interface cfg name, e.g. cmsis-dap")
    parser.add_argument("--target", required=True, help="target cfg name, e.g. stm32f1x")
    parser.add_argument("--file", required=True, help="firmware file to program")
    parser.add_argument("--adapter-serial", default="")
    parser.add_argument("--timeout", type=int, default=FLASH_TIMEOUT)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    openocd = Path(args.openocd)
    if not openocd.is_file():
        output_json(error_result("openocd_not_found", f"OpenOCD 不存在: {openocd}"))
        return 1
    firmware = Path(args.file).resolve()
    if not firmware.is_file():
        output_json(error_result("firmware_not_found", f"固件不存在: {firmware}"))
        return 1
    if args.interface not in INTERFACES:
        output_json(error_result("bad_interface", f"不支持的调试器: {args.interface}"))
        return 1
    if args.target not in TARGETS:
        output_json(error_result("bad_target", f"不支持的目标芯片: {args.target}"))
        return 1

    cmd = [
        str(openocd),
        "-f", f"interface/{args.interface}.cfg",
        "-f", f"target/{args.target}.cfg",
    ]
    if args.adapter_serial:
        cmd += ["-c", f"adapter serial {args.adapter_serial}"]
    cmd += [
        "-c", f"program {{{firmware}}} verify reset exit",
    ]

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=args.timeout,
            creationflags=0x08000000 if sys.platform == "win32" else 0,
        )
    except subprocess.TimeoutExpired:
        output_json(error_result("timeout", f"烧录超时（{args.timeout}s）"))
        return 1
    except OSError as exc:
        output_json(error_result("spawn_failed", f"无法启动 OpenOCD: {exc}"))
        return 1

    output = ((proc.stdout or "") + (proc.stderr or "")).strip()
    tail = "\n".join(output.splitlines()[-40:])
    ok = proc.returncode == 0 and "shutdown command invoked" in output
    if ok:
        output_json({
            "status": "ok",
            "action": "download",
            "summary": f"烧录成功 {args.target} ← {firmware.name}",
            "details": {
                "interface": args.interface,
                "target": args.target,
                "file": str(firmware),
                "exit_code": proc.returncode,
                "output": tail,
            },
        })
        return 0
    output_json({
        "status": "error",
        "action": "download",
        "error": {"code": "flash_failed", "message": f"烧录失败（exit {proc.returncode}）"},
        "details": {"output": tail},
    })
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
