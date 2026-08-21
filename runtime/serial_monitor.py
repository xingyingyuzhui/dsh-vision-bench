"""Serial line monitor for dsh-vision-bench. Streams JSON lines to stdout."""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


def emit(obj: dict) -> None:
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def pid_alive(pid: int) -> bool:
    """Windows os.kill(pid, 0) would TERMINATE the target; use OpenProcess."""
    if os.name == "nt":
        import ctypes

        SYNCHRONIZE = 0x00100000
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(SYNCHRONIZE, False, int(pid))
        if not handle:
            return False
        kernel32.CloseHandle(handle)
        return True
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def watch_parent(parent_pid: int, stop: threading.Event) -> None:
    """Exit the process once the JS host disappears; otherwise the orphaned
    python would keep holding the COM port until manually killed."""
    while not stop.wait(2.0):
        if not pid_alive(parent_pid):
            os._exit(3)


def main() -> int:
    parser = argparse.ArgumentParser(description="Serial monitor")
    parser.add_argument("--port", required=True)
    parser.add_argument("--baudrate", type=int, default=115200)
    parser.add_argument("--parent", type=int, default=0, help="host pid to watch")
    args = parser.parse_args()

    stop = threading.Event()
    if args.parent > 0:
        threading.Thread(target=watch_parent, args=(args.parent, stop), daemon=True).start()

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
        while not stop.is_set():
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
        stop.set()
        close = getattr(ser, "close", None)
        if callable(close):
            close()


if __name__ == "__main__":
    raise SystemExit(main())


if __name__ == "__main__":
    raise SystemExit(main())
