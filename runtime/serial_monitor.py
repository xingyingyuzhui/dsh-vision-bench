"""Serial line monitor for dsh-vision-bench. Streams JSON lines to stdout."""

from __future__ import annotations

import argparse
import json
import sys
import time

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


def emit(obj: dict) -> None:
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Serial monitor")
    parser.add_argument("--port", required=True)
    parser.add_argument("--baudrate", type=int, default=115200)
    args = parser.parse_args()

    try:
        import serial
    except ImportError:
        emit({"error": {"code": "pyserial_missing", "message": "未安装 pyserial。请在绑定的 Python 中执行: pip install pyserial"}})
        return 1

    try:
        ser = serial.Serial(args.port, args.baudrate, timeout=0.2)
    except Exception as exc:
        emit({"error": {"code": "serial_open_failed", "message": f"无法打开串口 {args.port}: {exc}"}})
        return 1

    buf = b""
    try:
        while True:
            try:
                data = ser.read(1024)
            except Exception as exc:
                emit({"error": {"code": "serial_read_failed", "message": str(exc)}})
                return 1
            if not data:
                continue
            buf += data
            while b"\n" in buf:
                raw, buf = buf.split(b"\n", 1)
                line = raw.decode("utf-8", "replace").rstrip("\r")
                if not line.strip():
                    continue
                emit({"t": int(time.time() * 1000), "line": line})
    except KeyboardInterrupt:
        return 0
    finally:
        close = getattr(ser, "close", None)
        if callable(close):
            close()


if __name__ == "__main__":
    raise SystemExit(main())
